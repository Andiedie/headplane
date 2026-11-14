import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { expect, onTestFinished, test, vi } from "vitest";

import { createNetworkHistory } from "~/server/network/history";

import { tempDir } from "../support/temp";

function database(path = ":memory:") {
  const db = drizzle(path);
  migrate(db, { migrationsFolder: "./drizzle" });
  onTestFinished(() => {
    if (db.$client.isOpen) db.$client.close();
  });
  return db;
}

test("records typed events as JSON with millisecond timestamps in deterministic order", async () => {
  const history = createNetworkHistory(database(), { enabled: true, retention_days: 7 });
  const at = Date.now();
  await history.record("relay", "region-1", { latencyMs: 23.5, healthy: true }, at);
  await history.record("action", "region-1", { action: "relay-switch", from: 2, to: 1 }, at);
  await history.record("relay", "region-2", { latencyMs: null, healthy: false }, at - 1);

  expect(await history.recent()).toEqual([
    {
      id: 2,
      kind: "action",
      entityId: "region-1",
      observedAt: at,
      payload: { action: "relay-switch", from: 2, to: 1 },
    },
    {
      id: 1,
      kind: "relay",
      entityId: "region-1",
      observedAt: at,
      payload: { latencyMs: 23.5, healthy: true },
    },
    {
      id: 3,
      kind: "relay",
      entityId: "region-2",
      observedAt: at - 1,
      payload: { latencyMs: null, healthy: false },
    },
  ]);
  expect((await history.recent("relay")).map((row) => row.entityId)).toEqual([
    "region-1",
    "region-2",
  ]);
});

test("node observations record state changes and retain their baseline across restarts and removal", async () => {
  const path = join(await tempDir(), "history.db");
  const firstDb = database(path);
  const options = { enabled: true, retention_days: 7 };
  const first = createNetworkHistory(firstDb, options);
  const at = Date.now();
  const node = {
    id: "42",
    name: "laptop",
    online: true,
    homeRegion: null,
    nodeKey: "nodekey:must-not-be-stored",
    machineKey: "mkey:must-not-be-stored",
  };
  await first.observeNodes([node], at);
  await first.observeNodes([node], at + 1);
  const renamed = { ...node, name: "renamed" };
  await first.observeNodes([renamed], at + 2);
  await first.observeNodes([{ ...renamed, online: false }], at + 3);
  await first.observeNodes([{ ...renamed, online: false, homeRegion: 3 }], at + 4);
  firstDb.$client.close();

  const restarted = createNetworkHistory(database(path), options);
  const current = { ...renamed, online: false, homeRegion: 3 };
  await restarted.observeNodes([current], at + 5);
  await restarted.observeNodes([], at + 6);
  await restarted.observeNodes([current], at + 7);
  expect(await restarted.recent("node")).toEqual([
    {
      id: 3,
      kind: "node",
      entityId: "42",
      observedAt: at + 4,
      payload: { name: "renamed", online: false, homeRegion: 3 },
    },
    {
      id: 2,
      kind: "node",
      entityId: "42",
      observedAt: at + 3,
      payload: { name: "renamed", online: false, homeRegion: null },
    },
    {
      id: 1,
      kind: "node",
      entityId: "42",
      observedAt: at,
      payload: { name: "laptop", online: true, homeRegion: null },
    },
  ]);
});

test("disabled history does no database work, including reads and pruning", async () => {
  const path = join(await tempDir(), "history.db");
  const db = database(path);
  const at = Date.now();
  await createNetworkHistory(db, { enabled: true, retention_days: 7 }).record(
    "action",
    "relay-1",
    { action: "relay-switch" },
    at,
  );
  db.$client.close();
  const disabled = createNetworkHistory(db, { enabled: false, retention_days: 0 });
  await disabled.record("relay", "relay-1", { healthy: true });
  await disabled.observeNodes([{ id: "42", name: "laptop", online: true, homeRegion: 1 }]);
  await disabled.prune();
  expect(await disabled.recent()).toEqual([]);
  expect(
    await createNetworkHistory(database(path), { enabled: true, retention_days: 7 }).recent(),
  ).toMatchObject([{ kind: "action", entityId: "relay-1", observedAt: at }]);
});

test("retention is enforced when writing, explicitly pruning, and observing an empty network", async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const now = Date.now();
  vi.setSystemTime(now);
  const day = 24 * 60 * 60 * 1000;
  const db = database();
  const history = createNetworkHistory(db, { enabled: true, retention_days: 1 });
  await history.record("relay", "expired", {}, now - day - 1);
  expect(db.$client.prepare("SELECT count(*) AS count FROM network_history").get()).toEqual({
    count: 0,
  });
  await history.record("relay", "boundary", {}, now - day);
  await history.record("relay", "recent", {});
  await history.prune(now);
  expect((await history.recent()).map((row) => row.entityId)).toEqual(["recent", "boundary"]);
  await history.prune(now + 1);
  expect((await history.recent()).map((row) => row.entityId)).toEqual(["recent"]);
  vi.setSystemTime(now + day + 1);
  expect(await history.recent()).toEqual([]);
  await history.observeNodes([]);
  expect(db.$client.prepare("SELECT count(*) AS count FROM network_history").get()).toEqual({
    count: 0,
  });
});

test("row limits evict the oldest timestamps and break ties by insertion order", async () => {
  const db = database();
  const history = createNetworkHistory(db, { enabled: true, retention_days: 7, max_rows: 2 });
  const at = Date.now();
  await history.record("action", "first", {}, at);
  await history.record("action", "second", {}, at);
  await history.record("action", "third", {}, at);
  await history.record("relay", "late-arrival", {}, at - 1);
  expect((await history.recent()).map((row) => row.entityId)).toEqual(["third", "second"]);
  expect(db.$client.prepare("SELECT count(*) AS count FROM network_history").get()).toEqual({
    count: 2,
  });

  await history.observeNodes(
    ["a", "b", "c"].map((id) => ({ id, name: id, online: true, homeRegion: 1 })),
    at + 1,
  );
  expect((await history.recent()).map((row) => row.entityId)).toEqual(["c", "b"]);
  await createNetworkHistory(db, { enabled: true, retention_days: 7, max_rows: 1 }).prune(at);
  expect((await history.recent()).map((row) => row.entityId)).toEqual(["c"]);
});

test("recent queries always bound requested limits", async () => {
  const db = database();
  db.$client
    .prepare(`
    WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 1200)
    INSERT INTO network_history (kind, entity_id, observed_at, payload)
      SELECT 'relay', CAST(n AS TEXT), ?, '{}' FROM sequence
  `)
    .run(Date.now());
  const history = createNetworkHistory(db, { enabled: true, retention_days: 7 });
  expect(await history.recent()).toHaveLength(100);
  for (const [limit, expected] of [
    [1, 1],
    [0, 0],
    [-1, 0],
    [2.9, 2],
    [100_000, 1000],
    [Number.NaN, 100],
    [Number.POSITIVE_INFINITY, 1000],
    [Number.NEGATIVE_INFINITY, 0],
  ]) {
    expect(await history.recent("relay", limit)).toHaveLength(expected);
  }
});

test("payloads omit credential fields and node records retain only observation fields", async () => {
  const db = database();
  const history = createNetworkHistory(db, { enabled: true, retention_days: 7 });
  await history.record("action", "relay-1", {
    action: "relay-switch",
    api_key: "must-not-be-stored",
    details: { password: "must-not-be-stored", region: 3 },
    samples: [{ accessToken: "must-not-be-stored", latencyMs: 4 }],
  });
  await history.record("node", "42", {
    name: "laptop",
    online: true,
    homeRegion: 3,
    node_key: "must-not-be-stored",
    ipAddresses: ["100.64.0.1"],
  });
  expect((await history.recent("node"))[0].payload).toEqual({
    name: "laptop",
    online: true,
    homeRegion: 3,
  });
  expect((await history.recent("action"))[0].payload).toEqual({
    action: "relay-switch",
    details: { region: 3 },
    samples: [{ latencyMs: 4 }],
  });
  expect(JSON.stringify(db.$client.prepare("SELECT * FROM network_history").all())).not.toContain(
    "must-not-be-stored",
  );
});

test("unserializable or oversized payloads fail before any event is stored", async () => {
  const db = database();
  const history = createNetworkHistory(db, { enabled: true, retention_days: 7 });
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const payload of [
    { latencyMs: Number.NaN },
    { latencyMs: Number.POSITIVE_INFINITY },
    { callback: () => "not-json" },
    { count: 1n },
    { label: Symbol("not-json") },
    { toJSON: () => [] },
    { toJSON: () => null },
    { message: "x".repeat(16_385) },
    circular,
  ]) {
    await expect(history.record("relay", "relay-1", payload)).rejects.toThrow();
  }
  await expect(history.record("node", "42", { online: "yes" })).rejects.toThrow();
  expect(await history.recent()).toEqual([]);
});

test("invalid retention and row bounds cannot silently disable pruning", () => {
  const db = database();
  for (const retention_days of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => createNetworkHistory(db, { enabled: true, retention_days })).toThrow();
  }
  for (const max_rows of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      createNetworkHistory(db, { enabled: true, retention_days: 7, max_rows }),
    ).toThrow();
  }
});

test("invalid event identifiers and timestamps are rejected without writing", async () => {
  const history = createNetworkHistory(database(), { enabled: true, retention_days: 7 });
  const node = { id: "42", name: "laptop", online: true, homeRegion: null };
  for (const id of ["", "x".repeat(257), "nodekey:secret", "mkey:secret"]) {
    await expect(history.record("node", id, node)).rejects.toThrow();
    await expect(history.observeNodes([{ ...node, id }])).rejects.toThrow();
  }
  for (const at of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(history.record("relay", "relay-1", {}, at)).rejects.toThrow();
    await expect(history.observeNodes([node], at)).rejects.toThrow();
    await expect(history.prune(at)).rejects.toThrow();
  }
  expect(await history.recent()).toEqual([]);
});

test("a rejected node observation rolls back the whole batch", async () => {
  const history = createNetworkHistory(database(), { enabled: true, retention_days: 7 });
  await history.record("action", "relay-1", { action: "relay-switch" });
  await expect(
    history.observeNodes([
      { id: "42", name: "laptop", online: true, homeRegion: 1 },
      { id: "43", name: "x".repeat(16_385), online: true, homeRegion: 1 },
    ]),
  ).rejects.toThrow();
  expect((await history.recent()).map((row) => row.kind)).toEqual(["action"]);
});

test("history migration preserves existing tables and can be reapplied", async () => {
  const directory = await tempDir();
  const previousMigrations = join(directory, "migrations");
  await mkdir(previousMigrations);
  for (const name of await readdir("./drizzle")) {
    if (!name.endsWith("_network_history")) {
      await cp(join("./drizzle", name), join(previousMigrations, name), { recursive: true });
    }
  }

  const db = drizzle(join(directory, "history.db"));
  onTestFinished(() => {
    if (db.$client.isOpen) db.$client.close();
  });
  migrate(db, { migrationsFolder: previousMigrations });
  db.$client.exec(`
    INSERT INTO users (id, sub, role, caps) VALUES ('user-1', 'subject-1', 'owner', 65535);
    INSERT INTO auth_sessions (id, kind, user_id, expires_at, oidc_id_token)
      VALUES ('session-1', 'oidc', 'user-1', 2000000000, 'existing-token');
    INSERT INTO host_info (host_id, payload) VALUES ('host-1', '{"hostname":"existing"}');
  `);
  const schemaBefore = db.$client
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const contentsBefore = ["users", "auth_sessions", "host_info"].map((table) =>
    db.$client.prepare(`SELECT * FROM ${table}`).all(),
  );

  migrate(db, { migrationsFolder: "./drizzle" });
  migrate(db, { migrationsFolder: "./drizzle" });

  expect(
    db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name = 'network_history'",
      )
      .all(),
  ).toEqual([{ name: "network_history" }]);
  expect(
    db.$client
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'network_history' ORDER BY name",
      )
      .all(),
  ).toEqual(schemaBefore);
  expect(
    ["users", "auth_sessions", "host_info"].map((table) =>
      db.$client.prepare(`SELECT * FROM ${table}`).all(),
    ),
  ).toEqual(contentsBefore);
});
