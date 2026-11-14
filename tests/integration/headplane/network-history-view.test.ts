import { expect, test } from "vitest";

import { createNetworkHistory } from "~/server/network/history";

import { createTailnet } from "../../harness/tailnet";

test("relay samples cannot hide retained device and operation history", async () => {
  await using tailnet = await createTailnet();
  const app = await tailnet.headplane({
    config: {
      network: {
        history: { enabled: true },
        metrics: [{ id: "busy", name: "Busy relay", url: `${tailnet.server.url}/debug/vars` }],
      },
    },
  });
  const history = createNetworkHistory(app.ctx.db, { enabled: true, retention_days: 7 });
  const at = Date.now() - 10_000;
  for (let i = 0; i < 121; i += 1) {
    await history.record(
      "node",
      "42",
      { name: "laptop", online: i % 2 === 0, homeRegion: null },
      at + i,
    );
    await history.record("action", "42", { intent: "rename", outcome: "success" }, at + i);
  }
  for (let i = 0; i < 121; i += 1) {
    await history.record("relay", "busy", { receivedBytes: i }, at + 1000 + i);
  }

  const current = await app.ctx.network.read(app.api);
  for (const kind of ["node", "action"] as const) {
    const events = current.history.filter((event) => event.kind === kind);
    expect(events).toHaveLength(60);
    expect(events[0].observedAt).toBe(at + 120);
    expect(events.at(-1)?.observedAt).toBe(at + 61);
  }
  const activity = current.history.filter((event) => event.kind !== "relay");
  expect(activity.slice(0, 2)).toMatchObject([
    { kind: "action", observedAt: at + 120 },
    { kind: "node", observedAt: at + 120 },
  ]);
  expect(current.history).toEqual(
    [...current.history].sort((a, b) => b.observedAt - a.observedAt || b.id - a.id),
  );
});

test("each configured relay retains a bounded chart history despite a busier source", async () => {
  await using tailnet = await createTailnet();
  const sources = Array.from({ length: 16 }, (_, i) => ({
    id: `relay-${i}`,
    name: `Relay ${i}`,
    url: `${tailnet.server.url}/debug/vars`,
  }));
  const app = await tailnet.headplane({
    config: { network: { history: { enabled: true }, metrics: sources } },
  });
  const history = createNetworkHistory(app.ctx.db, { enabled: true, retention_days: 7 });
  const at = Date.now() - 10_000;
  for (const [index, source] of sources.entries()) {
    const sampleCount = index === sources.length - 1 ? 181 : 61;
    for (let i = 0; i < sampleCount; i += 1) {
      await history.record(
        "relay",
        source.id,
        { receivedBytes: i, rxBytesPerSecond: i },
        at + index * 200 + i,
      );
    }
  }

  const current = await app.ctx.network.read(app.api);
  for (const [index, source] of sources.entries()) {
    const samples = current.history.filter(
      (event) => event.kind === "relay" && event.entityId === source.id,
    );
    expect(samples, source.id).toHaveLength(60);
    expect(samples[0].payload.receivedBytes).toBe(index === sources.length - 1 ? 180 : 60);
    expect(samples.at(-1)?.payload.receivedBytes).toBe(index === sources.length - 1 ? 121 : 1);
  }
  expect(current.history).toHaveLength(960);
});
