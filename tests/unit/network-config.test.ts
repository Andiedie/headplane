import { type } from "arktype";
import { dump } from "js-yaml";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { headplaneConfig } from "~/server/config/config-schema";
import { loadConfig, loadConfigEnv, loadConfigFile } from "~/server/config/load";

import { tempFile } from "../support/temp";

const base = {
  server: { cookie_secret: "12345678901234567890123456789012" },
  headscale: { url: "http://127.0.0.1:8080" },
};

describe("optional network configuration", () => {
  test("keeps network options instead of silently dropping an operator's settings", () => {
    const result = headplaneConfig({
      ...base,
      network: {
        poll_interval: 5000,
        history: { enabled: true, retention_days: 7 },
        relays: { catalog_path: "/data/regions.json", map_path: "/data/selected.json" },
      },
    });
    expect(result).not.toBeInstanceOf(type.errors);
    expect(result).toMatchObject({
      network: {
        poll_interval: 5000,
        history: { enabled: true, retention_days: 7 },
        relays: { map_path: "/data/selected.json" },
      },
    });
  });

  test.each([
    { poll_interval: 0 },
    { history: { enabled: true, retention_days: -1 } },
    { metrics: [{ id: "bad", name: "bad", url: "file:///etc/passwd" }] },
    { metrics: [{ id: "bad", name: "bad", url: "https://user@example.test/metrics" }] },
  ])("rejects invalid observation configuration %j", (network) => {
    expect(headplaneConfig({ ...base, network })).toBeInstanceOf(type.errors);
  });
});

describe("network configuration loading", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("HEADPLANE_")) {
        vi.stubEnv(key, undefined);
      }
    }
  });

  afterEach(() => vi.unstubAllEnvs());

  test.each([
    { key: "ENABLED", value: "false", expected: { enabled: false } },
    { key: "RETENTION_DAYS", value: "14", expected: { retention_days: 14 } },
    { key: "MAX_ROWS", value: "20000", expected: { max_rows: 20000 } },
  ])("overrides history $key without replacing sibling file settings", async (override) => {
    const history = { enabled: true, retention_days: 30, max_rows: 50000 };
    const path = await tempFile(
      "config.yaml",
      dump({ ...base, network: { poll_interval: 5000, history } }),
    );
    vi.stubEnv(`HEADPLANE_NETWORK__HISTORY__${override.key}`, override.value);

    const config = await loadConfig(path);

    expect(config.network).toEqual({
      poll_interval: 5000,
      history: { ...history, ...override.expected },
    });
  });

  test.each([
    {
      key: "HEADSCALE_PATH",
      value: "/headscale/selected.yaml",
      file: { catalog_path: "/data/catalog.json", map_path: "/data/selected.yaml" },
    },
    {
      key: "CATALOG_PATH",
      value: "/data/catalog.json",
      file: { map_path: "/data/selected.yaml", headscale_path: "/headscale/selected.yaml" },
    },
    {
      key: "MAP_PATH",
      value: "/data/selected.yaml",
      file: { catalog_path: "/data/catalog.json", headscale_path: "/headscale/selected.yaml" },
    },
  ])("merges a relay $key override with the remaining file settings", async (override) => {
    const path = await tempFile(
      "config.yaml",
      dump({ ...base, network: { relays: override.file } }),
    );
    vi.stubEnv(`HEADPLANE_NETWORK__RELAYS__${override.key}`, override.value);

    const config = await loadConfig(path);

    expect(config.network?.relays).toEqual({
      catalog_path: "/data/catalog.json",
      map_path: "/data/selected.yaml",
      headscale_path: "/headscale/selected.yaml",
    });
  });

  test("fills omitted defaults only after merging file and environment fragments", async () => {
    const network = { history: { enabled: true } };
    const path = await tempFile("config.yaml", dump({ ...base, network }));
    vi.stubEnv("HEADPLANE_NETWORK__HISTORY__RETENTION_DAYS", "14");

    expect((await loadConfigFile(path))?.network).toEqual(network);
    expect((await loadConfigEnv())?.network).toEqual({ history: { retention_days: 14 } });
    expect((await loadConfig(path)).network).toEqual({
      poll_interval: 30000,
      history: { enabled: true, retention_days: 14, max_rows: 10000 },
    });
  });

  test.each([
    { missing: "catalog_path", relays: { map_path: "/data/selected.yaml" } },
    { missing: "map_path", relays: { catalog_path: "/data/catalog.json" } },
  ])("rejects a relay config still missing $missing after merging", async ({ missing, relays }) => {
    const path = await tempFile("config.yaml", dump({ ...base, network: { relays } }));
    vi.stubEnv("HEADPLANE_NETWORK__RELAYS__HEADSCALE_PATH", "/headscale/selected.yaml");

    expect((await loadConfigFile(path))?.network?.relays).toEqual(relays);
    await expect(loadConfig(path)).rejects.toMatchObject({
      code: "INVALID_REQUIRED_FIELDS",
      message: expect.stringContaining(`network.relays.${missing} must be a string (was missing)`),
    });
  });

  test("keeps distinct metrics sources in the same region", async () => {
    const metrics = [
      { id: "relay-a", name: "Relay A", url: "http://relay-a.test/metrics", region_id: 901 },
      { id: "relay-b", name: "Relay B", url: "http://relay-b.test/metrics", region_id: 901 },
    ];
    const path = await tempFile("config.yaml", dump({ ...base, network: { metrics } }));

    expect((await loadConfig(path)).network?.metrics).toEqual(metrics);
  });

  test.each([undefined, 901])(
    "rejects duplicate metrics IDs during full validation with region_id %s",
    async (regionId) => {
      const metrics = [
        { id: "relay", name: "Relay A", url: "http://relay-a.test/metrics", region_id: regionId },
        { id: "relay", name: "Relay B", url: "http://relay-b.test/metrics", region_id: regionId },
      ];
      const path = await tempFile("config.yaml", dump({ ...base, network: { metrics } }));

      const fragment = await loadConfigFile(path);
      expect(fragment?.network?.metrics).toEqual(metrics);
      await expect(loadConfig(path)).rejects.toMatchObject({
        code: "INVALID_REQUIRED_FIELDS",
        message: expect.stringMatching(/network\.metrics.*unique.*IDs/),
      });
    },
  );
});
