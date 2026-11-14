import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseDocument, stringify } from "yaml";

import { createRelayManager, type RelayConfig } from "~/server/network/relays";

import { tempDir } from "../support/temp";

const region = (id: number) => ({
  RegionID: id,
  RegionCode: `r${id}`,
  RegionName: `Region ${id}`,
  Nodes: [{ Name: `r${id}a`, RegionID: id, HostName: `derp${id}.example.com` }],
});

async function fixture() {
  const directory = await realpath(await tempDir());
  const config: RelayConfig = {
    catalog_path: join(directory, "catalog.json"),
    map_path: join(directory, "selected.json"),
  };
  const headscalePath = join(directory, "headscale.yaml");
  const catalog = { Regions: { "1": region(1), "2": region(2) } };
  const headscale = {
    derp: {
      paths: [config.map_path],
      urls: [],
      server: { enabled: false },
      auto_update_enabled: true,
      update_frequency: "5m",
    },
  };
  await writeFile(config.catalog_path, JSON.stringify(catalog));
  await writeFile(config.map_path, JSON.stringify({ Regions: { "1": region(1) } }));
  await writeFile(headscalePath, stringify(headscale));
  return {
    config,
    catalog,
    directory,
    headscale,
    headscalePath,
    manager: createRelayManager(config, headscalePath),
  };
}

describe("local relay selection", () => {
  it.each(["JSON", "YAML"])("reads native lowercase %s maps", async (format) => {
    const { manager, config } = await fixture();
    const native = {
      regions: {
        "1": {
          regionid: 1,
          regioncode: "r1",
          regionname: "Region 1",
          nodes: [{ name: "r1a", regionid: 1, hostname: "derp1.example.com" }],
        },
      },
    };
    const text =
      format === "JSON"
        ? JSON.stringify(native)
        : stringify({ regions: new Map([[1, native.regions["1"]]]) });
    await writeFile(config.catalog_path, text);
    await writeFile(config.map_path, text);
    expect(await manager.read()).toMatchObject({
      regions: [{ id: 1, code: "r1", name: "Region 1" }],
      selectedRegionId: 1,
      writable: true,
    });
  });

  it.each([
    ["map", { Regions: { "1": region(1) }, regions: { "2": region(2) } }],
    ["region", { Regions: { "1": { ...region(1), regionid: 2 } } }],
    [
      "node",
      {
        Regions: {
          "1": { ...region(1), Nodes: [{ ...region(1).Nodes[0], hostname: "other.example.com" }] },
        },
      },
    ],
    [
      "home parameters",
      { Regions: { "1": region(1) }, HomeParams: { RegionScore: {}, regionscore: {} } },
    ],
  ])("rejects case-colliding %s keys", async (_, catalog) => {
    const { manager, config } = await fixture();
    const original = await readFile(config.map_path, "utf8");
    await writeFile(config.catalog_path, JSON.stringify(catalog));
    expect(await manager.read()).toMatchObject({ writable: false });
    expect(await manager.select(1, "revision")).toMatchObject({ ok: false });
    expect(await readFile(config.map_path, "utf8")).toBe(original);
  });

  it("saves only the chosen catalog region for the next Headscale refresh", async () => {
    const { manager, config, headscalePath } = await fixture();
    const originalConfig = await readFile(headscalePath, "utf8");
    const before = await manager.read();
    expect(before).toMatchObject({
      regions: [
        { id: 1, code: "r1", name: "Region 1" },
        { id: 2, code: "r2", name: "Region 2" },
      ],
      selectedRegionId: 1,
      writable: true,
      refreshInterval: "5m",
      revision: expect.any(String),
    });
    const result = await manager.select(2, before.revision!);
    expect(result).toMatchObject({ ok: true, value: { selectedRegionId: 2 } });
    const saved = parseDocument(await readFile(config.map_path, "utf8"));
    expect(saved.toJS({ mapAsMap: true }).get("regions")?.has(2)).toBe(true);
    expect(saved.toJS()).toEqual({
      regions: {
        "2": {
          regionid: 2,
          regioncode: "r2",
          regionname: "Region 2",
          nodes: [{ name: "r2a", regionid: 2, hostname: "derp2.example.com" }],
        },
      },
    });
    const after = await manager.read();
    expect(after.revision).not.toBe(before.revision);
    expect(await readFile(headscalePath, "utf8")).toBe(originalConfig);
  });

  it.each([
    ["a different map path", { paths: ["/other/derp.json"] }],
    ["additional map paths", { paths: ["/first.json", "/second.json"] }],
    ["remote map URLs", { urls: ["https://derp.example.com/map"] }],
    ["missing URLs", { urls: undefined }],
    ["embedded relay injection", { server: { enabled: true } }],
    [
      "explicit embedded relay injection",
      { server: { enabled: true, automatically_add_embedded_derp_region: true } },
    ],
    ["disabled refresh", { auto_update_enabled: false }],
    ["missing refresh", { auto_update_enabled: undefined }],
    ["zero refresh interval", { update_frequency: "0s" }],
    ["negative refresh interval", { update_frequency: "-1m" }],
    ["invalid refresh interval", { update_frequency: "once a minute" }],
    ["overflowing refresh interval", { update_frequency: "9999999999999999h" }],
  ])("refuses %s while still displaying the catalog", async (_, overrides) => {
    const { manager, config, headscale, headscalePath } = await fixture();
    Object.assign(headscale.derp, overrides);
    await writeFile(headscalePath, stringify(headscale));
    const originalMap = await readFile(config.map_path, "utf8");
    const originalConfig = await readFile(headscalePath, "utf8");
    const state = await manager.read();
    expect(state).toMatchObject({
      writable: false,
      selectedRegionId: 1,
      regions: [{ id: 1 }, { id: 2 }],
      reason: expect.any(String),
    });
    expect(await manager.select(2, state.revision ?? "")).toMatchObject({ ok: false });
    expect(await readFile(config.map_path, "utf8")).toBe(originalMap);
    expect(await readFile(headscalePath, "utf8")).toBe(originalConfig);
  });

  it("supports Headscale's different container path and explicitly excluded embedded relay", async () => {
    const { config, headscale, headscalePath } = await fixture();
    config.headscale_path = "/etc/headscale/derp.json";
    headscale.derp.paths = [config.headscale_path];
    Object.assign(headscale.derp.server, {
      enabled: true,
      automatically_add_embedded_derp_region: false,
    });
    headscale.derp.update_frequency = "1h30m0.5s";
    await writeFile(headscalePath, stringify(headscale));
    const manager = createRelayManager(config, headscalePath);
    const state = await manager.read();
    expect(state).toMatchObject({ writable: true, refreshInterval: "1h30m0.5s" });
    expect(await manager.select(2, state.revision!)).toMatchObject({ ok: true });
  });

  it.each([
    ["mismatched region key", { Regions: { "7": region(1) } }],
    ["fractional region ID", { Regions: { "1.5": region(1.5) } }],
    ["zero region ID", { Regions: { "0": region(0) } }],
    ["empty regions", { Regions: {} }],
    ["no nodes", { Regions: { "1": { ...region(1), Nodes: [] } } }],
    ["foreign node region", { Regions: { "1": { ...region(1), Nodes: region(2).Nodes } } }],
    ["no hostname", { Regions: { "1": { ...region(1), Nodes: [{ Name: "a", RegionID: 1 }] } } }],
    [
      "invalid hostname",
      {
        Regions: {
          "1": {
            ...region(1),
            Nodes: [{ ...region(1).Nodes[0], HostName: "https://derp.example.com/" }],
          },
        },
      },
    ],
    [
      "invalid IP",
      { Regions: { "1": { ...region(1), Nodes: [{ ...region(1).Nodes[0], IPv4: "not-an-ip" }] } } },
    ],
    [
      "invalid port",
      { Regions: { "1": { ...region(1), Nodes: [{ ...region(1).Nodes[0], DERPPort: 65536 }] } } },
    ],
    [
      "STUN-only nodes",
      { Regions: { "1": { ...region(1), Nodes: [{ ...region(1).Nodes[0], STUNOnly: true }] } } },
    ],
    [
      "duplicate node names",
      { Regions: { "1": { ...region(1), Nodes: [...region(1).Nodes, ...region(1).Nodes] } } },
    ],
    ["wrong optional field type", { Regions: { "1": { ...region(1), Avoid: "false" } } }],
    ["prototype key", JSON.parse('{"Regions":{"__proto__":{}}}')],
  ])("rejects catalog with %s without changing the saved map", async (_, catalog) => {
    const { manager, config } = await fixture();
    const original = await readFile(config.map_path, "utf8");
    await writeFile(config.catalog_path, JSON.stringify(catalog));
    expect(await manager.read()).toMatchObject({ writable: false, reason: expect.any(String) });
    expect(await manager.select(1, "revision")).toMatchObject({ ok: false });
    expect(await readFile(config.map_path, "utf8")).toBe(original);
  });

  it.each([NaN, Infinity, -1, 0, 1.5, 99])(
    "rejects an unavailable or invalid selection %s",
    async (id) => {
      const { manager, config } = await fixture();
      const original = await readFile(config.map_path, "utf8");
      const state = await manager.read();
      expect(await manager.select(id, state.revision!)).toMatchObject({ ok: false });
      expect(await readFile(config.map_path, "utf8")).toBe(original);
    },
  );

  it.each(["catalog", "map", "headscale"])(
    "reports malformed %s without exposing file contents",
    async (file) => {
      const { manager, config, headscalePath } = await fixture();
      const path =
        file === "catalog" ? config.catalog_path : file === "map" ? config.map_path : headscalePath;
      await writeFile(
        path,
        file === "headscale" ? "secret: [do-not-expose\nderp: [" : '{"secret":"do-not-expose"',
      );
      const state = await manager.read();
      expect(state.writable).toBe(false);
      expect(state.reason).toEqual(expect.any(String));
      expect(JSON.stringify(state)).not.toContain("do-not-expose");
      if (file !== "catalog") expect(state.regions).toHaveLength(2);
      expect(await manager.select(2, "revision")).toMatchObject({ ok: false });
    },
  );

  it("rejects YAML aliases and duplicate keys without expanding or exposing secrets", async () => {
    const { manager, headscalePath, headscale } = await fixture();
    for (const yaml of [
      `${stringify(headscale)}secret: &secret [private]\ncopy: *secret\n`,
      `${stringify(headscale)}derp: { secret: private }\n`,
    ]) {
      await writeFile(headscalePath, yaml);
      const state = await manager.read();
      expect(state.writable).toBe(false);
      expect(state.reason).not.toContain("private");
    }
  });

  it.each(["catalog", "map"])(
    "rejects ambiguous or unsafe YAML in the %s without exposing source text",
    async (file) => {
      const { manager, config } = await fixture();
      const path = file === "catalog" ? config.catalog_path : config.map_path;
      const valid = stringify({ Regions: { "1": region(1) } });
      for (const yaml of [
        `${valid}secret: &secret [private]\ncopy: *secret\n`,
        `${valid}Regions: {}\n`,
        `${valid}secret: !private value\n`,
      ]) {
        await writeFile(path, yaml);
        const state = await manager.read();
        expect(state.writable).toBe(false);
        expect(state.reason).not.toContain("private");
      }
    },
  );

  it("rejects YAML region keys that collide after conversion to object keys", async () => {
    const { manager, config } = await fixture();
    await writeFile(
      config.catalog_path,
      `Regions:\n  1: ${JSON.stringify(region(1))}\n  "1": ${JSON.stringify(region(1))}\n`,
    );
    expect(await manager.read()).toMatchObject({ writable: false });
  });

  it("preserves supported fields and strips unknown fields and other region scores", async () => {
    const { manager, config } = await fixture();
    const selected = {
      ...region(2),
      Avoid: false,
      Latitude: 1.5,
      Longitude: -2.5,
      Nodes: [
        {
          ...region(2).Nodes[0],
          IPv4: "192.0.2.1",
          IPv6: "none",
          DERPPort: 8443,
          STUNPort: -1,
          CertName: "derp.example.com",
          CanPort80: true,
        },
      ],
    };
    await writeFile(
      config.catalog_path,
      JSON.stringify({
        OmitDefaultRegions: true,
        HomeParams: { RegionScore: { "1": 1, "2": 0.5 } },
        Regions: { "1": region(1), "2": { ...selected, Extra: "ignored" } },
        Extra: { Regions: { "3": region(3) } },
      }),
    );
    const state = await manager.read();
    expect(await manager.select(2, state.revision!)).toMatchObject({ ok: true });
    const saved = parseDocument(await readFile(config.map_path, "utf8"));
    expect(saved.toJS({ mapAsMap: true }).get("homeparams")?.get("regionscore")?.get(2)).toBe(0.5);
    expect(saved.toJS()).toEqual({
      omitdefaultregions: true,
      homeparams: { regionscore: { "2": 0.5 } },
      regions: {
        "2": {
          regionid: 2,
          regioncode: "r2",
          regionname: "Region 2",
          avoid: false,
          latitude: 1.5,
          longitude: -2.5,
          nodes: [
            {
              name: "r2a",
              regionid: 2,
              hostname: "derp2.example.com",
              ipv4: "192.0.2.1",
              ipv6: "none",
              derpport: 8443,
              stunport: -1,
              certname: "derp.example.com",
              canport80: true,
            },
          ],
        },
      },
    });
  });

  it("preserves Tailscale's SHA-256 certificate pin when selecting a relay", async () => {
    const { manager, config } = await fixture();
    const pin = `sha256-raw:${"a".repeat(64)}`;
    await writeFile(
      config.catalog_path,
      JSON.stringify({
        Regions: {
          "1": { ...region(1), Nodes: [{ ...region(1).Nodes[0], CertName: pin }] },
        },
      }),
    );
    const before = await manager.read();
    expect(before.writable).toBe(true);
    expect(await manager.select(1, before.revision!)).toMatchObject({ ok: true });
    const saved = parseDocument(await readFile(config.map_path, "utf8")).toJS();
    expect(saved.regions[1].nodes[0].certname).toBe(pin);
  });

  it.each([
    "sha256-raw:",
    `sha256-raw:${"a".repeat(63)}`,
    `sha256-raw:${"a".repeat(65)}`,
    `sha256-raw:${"g".repeat(64)}`,
    `sha256-raw:${"A".repeat(64)}`,
    `SHA256-RAW:${"a".repeat(64)}`,
  ])("rejects an unusable certificate pin %s", async (pin) => {
    const { manager, config } = await fixture();
    await writeFile(
      config.catalog_path,
      JSON.stringify({
        Regions: {
          "1": { ...region(1), Nodes: [{ ...region(1).Nodes[0], CertName: pin }] },
        },
      }),
    );
    expect(await manager.read()).toMatchObject({ writable: false });
  });

  it.each(["catalog", "map", "headscale"])(
    "rejects a stale revision after %s changes",
    async (file) => {
      const { manager, config, headscalePath } = await fixture();
      const before = await manager.read();
      const path =
        file === "catalog" ? config.catalog_path : file === "map" ? config.map_path : headscalePath;
      await writeFile(path, `${await readFile(path, "utf8")}\n`);
      const original = await readFile(config.map_path, "utf8");
      expect(await manager.select(2, before.revision!)).toMatchObject({
        ok: false,
        error: { message: expect.stringMatching(/changed|stale|reload/i) },
      });
      expect(await readFile(config.map_path, "utf8")).toBe(original);
    },
  );

  it("serializes concurrent switches so only one request can consume a revision", async () => {
    const { manager } = await fixture();
    const { revision } = await manager.read();
    const results = await Promise.all([manager.select(2, revision!), manager.select(1, revision!)]);
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(await manager.read()).toMatchObject({ selectedRegionId: 2 });
  });

  it("rejects empty or forged revisions", async () => {
    const { manager, config } = await fixture();
    const original = await readFile(config.map_path, "utf8");
    for (const revision of ["", "made-up-revision"]) {
      expect(await manager.select(2, revision)).toMatchObject({ ok: false });
    }
    expect(await readFile(config.map_path, "utf8")).toBe(original);
  });

  it("atomically replaces the map while preserving its mode and existing readers", async () => {
    const { manager, config, directory } = await fixture();
    await chmod(config.map_path, 0o640);
    const original = await readFile(config.map_path, "utf8");
    const handle = await open(config.map_path, "r");
    try {
      const { revision } = await manager.read();
      expect(await manager.select(2, revision!)).toMatchObject({ ok: true });
      expect(await handle.readFile("utf8")).toBe(original);
      expect((await stat(config.map_path)).mode & 0o777).toBe(0o640);
      expect((await readdir(directory)).sort()).toEqual([
        "catalog.json",
        "headscale.yaml",
        "selected.json",
      ]);
    } finally {
      await handle.close();
    }
  });

  it("preserves the map when its directory is not writable and recovers without restarting", async () => {
    const { manager, config, directory } = await fixture();
    const original = await readFile(config.map_path, "utf8");
    const { revision } = await manager.read();
    await chmod(directory, 0o500);
    try {
      expect(await manager.read()).toMatchObject({ writable: false });
      expect(await manager.select(2, revision!)).toMatchObject({ ok: false });
      expect(await readFile(config.map_path, "utf8")).toBe(original);
    } finally {
      await chmod(directory, 0o700);
    }
    const fresh = await manager.read();
    expect(await manager.select(2, fresh.revision!)).toMatchObject({ ok: true });
  });

  it.each(["catalog", "map", "headscale"])("refuses a symlinked %s file", async (file) => {
    const { manager, config, headscalePath } = await fixture();
    const path =
      file === "catalog" ? config.catalog_path : file === "map" ? config.map_path : headscalePath;
    const target = `${path}.real`;
    await rename(path, target);
    await symlink(target, path);
    const original = await readFile(target, "utf8");
    const state = await manager.read();
    expect(state).toMatchObject({ writable: false, reason: expect.any(String) });
    expect(await manager.select(2, state.revision ?? "")).toMatchObject({ ok: false });
    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("refuses a map reached through a symlinked parent directory", async () => {
    const { config, directory, headscale, headscalePath } = await fixture();
    const alias = join(await tempDir(), "alias");
    await symlink(directory, alias);
    config.map_path = join(alias, "selected.json");
    headscale.derp.paths = [config.map_path];
    await writeFile(headscalePath, stringify(headscale));
    const manager = createRelayManager(config, headscalePath);
    expect(await manager.read()).toMatchObject({ writable: false });
  });

  it.each(["same path", "hard link"])(
    "refuses a catalog and output that alias via %s",
    async (kind) => {
      const { config, headscale, headscalePath } = await fixture();
      const original = await readFile(config.catalog_path, "utf8");
      if (kind === "same path") {
        config.map_path = config.catalog_path;
        headscale.derp.paths = [config.map_path];
        await writeFile(headscalePath, stringify(headscale));
      } else {
        await rm(config.map_path);
        await link(config.catalog_path, config.map_path);
      }
      const manager = createRelayManager(config, headscalePath);
      const state = await manager.read();
      expect(state.writable).toBe(false);
      expect(await manager.select(2, state.revision ?? "")).toMatchObject({ ok: false });
      expect(await readFile(config.catalog_path, "utf8")).toBe(original);
    },
  );

  it.each(["catalog", "map", "headscale"])("bounds reads of oversized %s files", async (file) => {
    const { manager, config, headscalePath } = await fixture();
    const path =
      file === "catalog" ? config.catalog_path : file === "map" ? config.map_path : headscalePath;
    await writeFile(path, `${await readFile(path, "utf8")}${" ".repeat(2 * 1024 * 1024)}`);
    expect(await manager.read()).toMatchObject({
      writable: false,
      reason: expect.stringMatching(/large|limit/i),
    });
    expect(await manager.select(2, "revision")).toMatchObject({ ok: false });
  });

  it.each(["missing", "directory"])(
    "reports a %s output as read-only with the catalog visible",
    async (kind) => {
      const { manager, config } = await fixture();
      await rm(config.map_path);
      if (kind === "directory") await mkdir(config.map_path);
      expect(await manager.read()).toMatchObject({
        writable: false,
        regions: [{ id: 1 }, { id: 2 }],
      });
      expect(await manager.select(2, "revision")).toMatchObject({ ok: false });
    },
  );

  it("stays disabled without explicit relay configuration", async () => {
    const manager = createRelayManager(undefined, undefined);
    expect(await manager.read()).toMatchObject({
      regions: [],
      selectedRegionId: null,
      revision: null,
      writable: false,
      reason: expect.any(String),
    });
    expect(await manager.select(1, "anything")).toMatchObject({ ok: false });
  });
});
