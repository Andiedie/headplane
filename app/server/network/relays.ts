import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { access, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import * as v from "valibot";
import { isScalar, parseDocument, stringify } from "yaml";

import type { Result } from "../result";

export interface RelayConfig {
  catalog_path: string;
  map_path: string;
  headscale_path?: string;
}

export interface RelayState {
  regions: { id: number; code: string; name: string }[];
  selectedRegionId: number | null;
  revision: string | null;
  writable: boolean;
  reason?: string;
  refreshInterval?: string;
}

export interface RelayManager {
  read(): Promise<RelayState>;
  select(regionId: number, revision: string): Promise<Result<RelayState, { message: string }>>;
}

// Local Headscale files use lowercase Go/YAML field names; operator catalogs
// also commonly use the DERP protocol's JSON names. Normalize only schema
// objects, leaving region IDs and values untouched and rejecting ambiguity.
function derpObject<const Entries extends v.ObjectEntries>(entries: Entries) {
  const names = new Map(Object.keys(entries).map((key) => [key.toLowerCase(), key]));
  return v.pipe(
    v.unknown(),
    v.transform((value) => {
      if (!isRecord(value)) return value;
      const seen = new Set<string>();
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          const lower = key.toLowerCase();
          if (seen.has(lower)) throw new Error("Ambiguous DERP field");
          seen.add(lower);
          return [names.get(lower) ?? key, item];
        }),
      );
    }),
    v.object(entries),
  );
}

const regionIdSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2_147_483_647));
const textSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(256),
  v.check(
    (value) =>
      value.trim() === value &&
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
  ),
);
const hostnameSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(253),
  v.check(
    (value) =>
      isIP(value) !== 0 ||
      value
        .replace(/\.$/, "")
        .split(".")
        .every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)),
  ),
);
const portSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(65535));
const nodeSchema = derpObject({
  Name: textSchema,
  RegionID: regionIdSchema,
  HostName: hostnameSchema,
  CertName: v.optional(
    v.union([
      v.literal(""),
      hostnameSchema,
      // Tailscale compares the full certificate's SHA-256 as lowercase hex.
      v.pipe(v.string(), v.regex(/^sha256-raw:[a-f0-9]{64}$/)),
    ]),
  ),
  IPv4: v.optional(
    v.pipe(
      v.string(),
      v.check((value) => value === "" || value === "none" || isIP(value) === 4),
    ),
  ),
  IPv6: v.optional(
    v.pipe(
      v.string(),
      v.check((value) => value === "" || value === "none" || isIP(value) === 6),
    ),
  ),
  STUNPort: v.optional(v.union([v.literal(-1), portSchema])),
  STUNOnly: v.optional(v.boolean()),
  DERPPort: v.optional(portSchema),
  InsecureForTests: v.optional(v.boolean()),
  ForceHTTP: v.optional(v.boolean()),
  CanPort80: v.optional(v.boolean()),
  STUNTestIP: v.optional(
    v.pipe(
      v.string(),
      v.check((value) => value === "" || isIP(value) !== 0),
    ),
  ),
});
const regionSchema = v.pipe(
  derpObject({
    RegionID: regionIdSchema,
    RegionCode: textSchema,
    RegionName: textSchema,
    Avoid: v.optional(v.boolean()),
    Latitude: v.optional(v.pipe(v.number(), v.finite(), v.minValue(-90), v.maxValue(90))),
    Longitude: v.optional(v.pipe(v.number(), v.finite(), v.minValue(-180), v.maxValue(180))),
    Nodes: v.pipe(v.array(nodeSchema), v.minLength(1), v.maxLength(512)),
  }),
  v.check(
    (region) =>
      region.Nodes.every((node) => node.RegionID === region.RegionID) &&
      region.Nodes.some((node) => !node.STUNOnly),
  ),
);
const mapSchema = derpObject({
  Regions: v.record(v.pipe(v.string(), v.regex(/^[1-9]\d*$/)), regionSchema),
  OmitDefaultRegions: v.optional(v.boolean()),
  HomeParams: v.optional(
    derpObject({
      RegionScore: v.optional(
        v.record(
          v.pipe(v.string(), v.regex(/^[1-9]\d*$/)),
          v.pipe(v.number(), v.finite(), v.minValue(0)),
        ),
      ),
    }),
  ),
});
type DerpMap = v.InferOutput<typeof mapSchema>;

// Messages crossing this boundary never contain source text or parser diagnostics.
class RelayFileError extends Error {}

function parseMap(text: string, label: string): DerpMap {
  try {
    const document = parseDocument(text, {
      schema: "core",
      // toJS turns both numeric and quoted region keys into strings.
      uniqueKeys: (a, b) => isScalar(a) && isScalar(b) && String(a.value) === String(b.value),
      prettyErrors: false,
    });
    if (document.errors.length || document.warnings.length) throw new Error();
    const parsed = v.safeParse(mapSchema, document.toJS({ maxAliasCount: 0 }));
    if (!parsed.success) throw new Error();
    const entries = Object.entries(parsed.output.Regions);
    if (entries.length === 0 || entries.length > 4096) throw new Error();
    const names = new Set<string>();
    for (const [id, region] of entries) {
      if (id !== String(region.RegionID)) throw new Error();
      for (const node of region.Nodes) {
        if (names.has(node.Name)) throw new Error();
        names.add(node.Name);
      }
    }
    return parsed.output;
  } catch {
    throw new RelayFileError(
      `The ${label} must be a valid DERP map with matching region IDs and usable relay nodes.`,
    );
  }
}

function parseHeadscale(text: string): unknown {
  try {
    const document = parseDocument(text, { schema: "core", uniqueKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length) throw new Error();
    return document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new RelayFileError(
      "The Headscale configuration must be valid YAML without aliases or duplicate keys.",
    );
  }
}

function selectedMap(catalog: DerpMap, regionId: number): DerpMap {
  const map: DerpMap = { Regions: { [regionId]: catalog.Regions[regionId] } };
  if (catalog.OmitDefaultRegions !== undefined) map.OmitDefaultRegions = catalog.OmitDefaultRegions;
  if (catalog.HomeParams) {
    const score = catalog.HomeParams.RegionScore?.[regionId];
    map.HomeParams = { RegionScore: score === undefined ? {} : { [regionId]: score } };
  }
  return map;
}

// Headscale's derp.paths loader uses yaml.v3, including for .json filenames.
// It needs lowercase struct fields and integer keys for Regions/RegionScore;
// JSON's quoted numeric keys cannot be decoded into Go's map[int] values.
// This sees only the bounded, schema-validated map returned by selectedMap.
function nativeMap(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nativeMap);
  if (isRecord(value)) {
    return new Map(
      Object.entries(value).map(([key, item]) => [
        /^[1-9]\d*$/.test(key) ? Number(key) : key.toLowerCase(),
        nativeMap(item),
      ]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveDuration(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 128) return false;
  const duration = value.startsWith("+") ? value.slice(1) : value;
  const parts = [...duration.matchAll(/(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/g)];
  if (parts.map(([part]) => part).join("") !== duration || parts.length === 0) return false;
  const units: Record<string, bigint> = {
    ns: 1n,
    us: 1_000n,
    µs: 1_000n,
    μs: 1_000n,
    ms: 1_000_000n,
    s: 1_000_000_000n,
    m: 60_000_000_000n,
    h: 3_600_000_000_000n,
  };
  let total = 0n;
  for (const [, amount, unit] of parts) {
    const [whole, fraction = ""] = amount.split(".");
    total += BigInt(whole || "0") * units[unit];
    if (fraction) total += (BigInt(fraction) * units[unit]) / 10n ** BigInt(fraction.length);
  }
  return total > 0n && total <= 9_223_372_036_854_775_807n;
}

function readiness(
  headscale: unknown,
  path: string,
): { reason?: string; refreshInterval?: string } {
  const derp = isRecord(headscale) ? headscale.derp : undefined;
  if (!isRecord(derp)) return { reason: "Headscale must have an explicit derp configuration." };
  if (!Array.isArray(derp.paths) || derp.paths.length !== 1 || derp.paths[0] !== path) {
    return { reason: "Headscale derp.paths must contain only the configured relay map path." };
  }
  if (!Array.isArray(derp.urls) || derp.urls.length !== 0) {
    return { reason: "Headscale derp.urls must be an empty list." };
  }
  const server = derp.server;
  if (
    server !== undefined &&
    (!isRecord(server) ||
      (server.enabled !== undefined && typeof server.enabled !== "boolean") ||
      (server.enabled === true && server.automatically_add_embedded_derp_region !== false))
  ) {
    return {
      reason:
        "Headscale must disable automatically_add_embedded_derp_region when its embedded DERP server is enabled.",
    };
  }
  if (derp.auto_update_enabled !== true || !positiveDuration(derp.update_frequency)) {
    return {
      reason: "Headscale must enable derp.auto_update_enabled with a positive update_frequency.",
    };
  }
  return { refreshInterval: derp.update_frequency };
}

interface FileSnapshot {
  text: string;
  stat: Stats;
}

function identity(stat: Stats): string {
  return `${stat.dev}:${stat.ino}`;
}

function fingerprint(stat: Stats): string {
  return `${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}:${stat.nlink}`;
}

async function regularPath(path: string): Promise<Stats> {
  if (!isAbsolute(path) || (await realpath(path)) !== resolve(path)) {
    throw new RelayFileError(
      "Relay files must use absolute paths without symbolic links, including parent directories.",
    );
  }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1) {
    throw new RelayFileError(
      "Relay files must be separate regular files without symbolic or hard links.",
    );
  }
  return stat;
}

async function readBounded(path: string, label: string): Promise<FileSnapshot> {
  try {
    const before = await regularPath(path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || fingerprint(stat) !== fingerprint(before)) {
        throw new RelayFileError("Relay files changed while being read. Reload and try again.");
      }
      const limit = 2 * 1024 * 1024;
      if (stat.size > limit) throw new RelayFileError(`The ${label} exceeds the 2 MiB size limit.`);
      // One extra byte detects growth without an unbounded readFile allocation.
      const buffer = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (
        offset !== stat.size ||
        fingerprint(await file.stat()) !== fingerprint(stat) ||
        fingerprint(await regularPath(path)) !== fingerprint(stat)
      ) {
        throw new RelayFileError("Relay files changed while being read. Reload and try again.");
      }
      return { text: buffer.subarray(0, offset).toString("utf8"), stat };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof RelayFileError) throw error;
    throw new RelayFileError(
      `Unable to read the ${label}. Check that the file exists and is readable.`,
    );
  }
}

async function writableMap(path: string, stat: Stats): Promise<void> {
  try {
    const directory = await lstat(dirname(path));
    if (!(stat.mode & 0o222) || !(directory.mode & 0o222)) throw new Error();
    await access(path, constants.W_OK);
    await access(dirname(path), constants.W_OK | constants.X_OK);
  } catch {
    throw new RelayFileError(
      "The selected relay map and its directory must be writable for atomic replacement.",
    );
  }
}

function revisionFor(files: FileSnapshot[]): string {
  return createHash("sha256")
    .update(JSON.stringify(files.map((file) => [fingerprint(file.stat), file.text])))
    .digest("hex");
}

export function createRelayManager(
  configuration: RelayConfig | undefined,
  headscaleConfigPath: string | undefined,
): RelayManager {
  // Paths come only from trusted application configuration, never select input.
  const config = configuration ? { ...configuration } : undefined;
  async function inspect(): Promise<{
    state: RelayState;
    catalog?: DerpMap;
    mapFile?: FileSnapshot;
  }> {
    const state: RelayState = {
      regions: [],
      selectedRegionId: null,
      revision: null,
      writable: false,
    };
    if (!config) {
      state.reason = "Local relay selection is not configured.";
      return { state };
    }
    try {
      const catalogFile = await readBounded(config.catalog_path, "relay catalog");
      const catalog = parseMap(catalogFile.text, "relay catalog");
      state.regions = Object.values(catalog.Regions)
        .map((region) => ({
          id: region.RegionID,
          code: region.RegionCode,
          name: region.RegionName,
        }))
        .sort((a, b) => a.id - b.id);
      const mapFile = await readBounded(config.map_path, "selected relay map");
      const map = parseMap(mapFile.text, "selected relay map");
      const selected = Object.values(map.Regions);
      state.selectedRegionId = selected.length === 1 ? selected[0].RegionID : null;
      if (!headscaleConfigPath) {
        state.reason = "The Headscale configuration file is not configured.";
        return { state, catalog };
      }
      const headscaleFile = await readBounded(headscaleConfigPath, "Headscale configuration");
      const files = [catalogFile, mapFile, headscaleFile];
      if (new Set(files.map((file) => identity(file.stat))).size !== files.length) {
        throw new RelayFileError(
          "The relay catalog, selected map and Headscale configuration must be separate files.",
        );
      }
      const headscale = parseHeadscale(headscaleFile.text);
      Object.assign(state, readiness(headscale, config.headscale_path ?? config.map_path));
      state.revision = revisionFor(files);
      await writableMap(config.map_path, mapFile.stat);
      state.writable = !state.reason;
      return { state, catalog, mapFile };
    } catch (error) {
      state.reason =
        error instanceof RelayFileError
          ? error.message
          : "Unable to read the local relay configuration files.";
      return { state };
    }
  }
  // The application creates one manager; only switches share this queue.
  let pending: Promise<unknown> = Promise.resolve();
  return {
    async read() {
      return (await inspect()).state;
    },
    select(regionId, revision) {
      const operation = pending.then(() => select(regionId, revision));
      pending = operation.catch(() => {});
      return operation;
    },
  };

  async function select(
    regionId: number,
    revision: string,
  ): Promise<Result<RelayState, { message: string }>> {
    const { state, catalog, mapFile } = await inspect();
    if (!config || !state.writable || !catalog || !mapFile) {
      return {
        ok: false,
        error: { message: state.reason ?? "Local relay selection is unavailable." },
      };
    }
    if (!revision || revision !== state.revision) {
      return {
        ok: false,
        error: { message: "Relay configuration changed. Reload before selecting a region." },
      };
    }
    if (!Number.isSafeInteger(regionId) || !Object.hasOwn(catalog.Regions, regionId)) {
      return { ok: false, error: { message: "Select a valid region from the relay catalog." } };
    }
    const directory = dirname(config.map_path);
    const temporary = join(directory, `.${basename(config.map_path)}.${randomUUID()}.tmp`);
    let created = false;
    try {
      const parent = await lstat(directory);
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
      try {
        await file.writeFile(stringify(nativeMap(selectedMap(catalog, regionId))), "utf8");
        const metadata = await file.stat();
        if (metadata.uid !== mapFile.stat.uid || metadata.gid !== mapFile.stat.gid) {
          await file.chown(mapFile.stat.uid, mapFile.stat.gid);
        }
        await file.chmod(mapFile.stat.mode & 0o777);
        await file.sync();
        // Recheck the catalog, saved map and readiness immediately before publication.
        const current = await inspect();
        if (!current.state.writable || current.state.revision !== revision) {
          throw new RelayFileError(
            current.state.reason ??
              "Relay configuration changed. Reload before selecting a region.",
          );
        }
        if (
          (await realpath(directory)) !== resolve(directory) ||
          identity(await lstat(directory)) !== identity(parent) ||
          identity(await regularPath(temporary)) !== identity(metadata)
        ) {
          throw new RelayFileError("Relay file paths changed. Reload and try again.");
        }
        await rename(temporary, config.map_path);
        created = false;
      } finally {
        await file.close();
      }
      // Some filesystems do not support directory fsync. The rename has already committed.
      const dir = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
        () => undefined,
      );
      if (dir) {
        await dir.sync().catch(() => {});
        await dir.close().catch(() => {});
      }
      const saved = (await inspect()).state;
      if (saved.selectedRegionId !== regionId || !saved.revision) {
        return {
          ok: false,
          error: {
            message:
              "The relay map was saved but could not be verified. Reload the page to check the saved selection.",
          },
        };
      }
      // This confirms only the local file; Headscale loads it on its next refresh.
      return { ok: true, value: saved };
    } catch (error) {
      return {
        ok: false,
        error: {
          message:
            error instanceof RelayFileError
              ? error.message
              : "Unable to save the relay map. Check file and directory permissions, then reload and try again.",
        },
      };
    } finally {
      if (created) await unlink(temporary).catch(() => {});
    }
  }
}
