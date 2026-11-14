import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";

import { History, Relays } from "~/routes/network/panels";
import { summarizeNetwork } from "~/server/network/snapshot";

type Data = Parameters<typeof Relays>[0]["data"];

function data(history: Data["history"]): Data {
  return {
    snapshot: summarizeNetwork([], {}, [], 0),
    observedAt: 0,
    relay: { regions: [], selectedRegionId: null, revision: null, writable: false },
    agent: { enabled: false, syncedAt: null, error: null },
    metrics: [
      {
        id: "relay-test",
        name: "Test relay",
        regionId: null,
        observedAt: 0,
        connections: 0,
        receivedBytes: 0,
        sentBytes: 0,
        rxBytesPerSecond: null,
        txBytesPerSecond: null,
      },
    ],
    history,
    historyEnabled: true,
    historyReason: null,
    collectionError: null,
    pollInterval: 30000,
    canSelectRelay: false,
  };
}

function chart(samples: [number, number | null][]) {
  const history = samples
    .map<Data["history"][number]>(([observedAt, rxBytesPerSecond], id) => ({
      id,
      observedAt,
      kind: "relay",
      entityId: "relay-test",
      payload: { rxBytesPerSecond },
    }))
    .reverse();
  const router = createMemoryRouter([
    { path: "/", element: createElement(Relays, { data: data(history) }) },
  ]);
  try {
    return renderToStaticMarkup(createElement(RouterProvider, { router }));
  } finally {
    router.dispose();
  }
}

test.each([
  [0, "0 B/s"],
  [0.25, "0.25 B/s"],
] as const)(
  "labels the actual receive peak %s without clamping it to the chart scale",
  (value, label) => {
    expect(
      chart([
        [0, value],
        [1000, value],
      ]),
    ).toContain(`peak ${label}`);
  },
);

test("Activity keeps deleted and legacy targets visible and retains relay selection details", () => {
  const markup = renderToStaticMarkup(
    createElement(History, {
      data: data([
        {
          id: 1,
          observedAt: 0,
          kind: "action",
          entityId: "87654321",
          payload: {
            intent: "delete",
            path: "/admin/machines",
            target: "87654321",
            actor: "owner",
            outcome: "success",
          },
        },
        {
          id: 2,
          observedAt: 0,
          kind: "action",
          entityId: "76543210",
          payload: {
            intent: "rename",
            path: "/admin/machines",
            actor: "owner",
            outcome: "failed",
          },
        },
        {
          id: 3,
          observedAt: 0,
          kind: "action",
          entityId: "relay-selection",
          payload: {
            region: 901,
            actor: "owner",
            outcome: "saved",
          },
        },
      ]),
    }),
  );
  expect(markup).toContain("Device 87654321");
  expect(markup).toContain("Device 76543210");
  expect(markup).toContain("Relay selection");
  expect(markup).toContain("Region 901 · saved · actor owner");
});

test("receive-rate history preserves elapsed time and breaks across unknown samples", () => {
  const markup = chart([
    [0, null],
    [1000, 2],
    [2000, 2],
    [3000, null],
    [9000, 2],
    [11000, 2],
  ]);
  const lines = [...markup.matchAll(/<polyline[^>]*points="([^"]+)"/g)].map((match) =>
    match[1].split(" ").map((point) => point.split(",").map(Number)),
  );
  expect(lines).toHaveLength(2);
  expect(lines.map((line) => line.length)).toEqual([2, 2]);
  const x = lines.flat().map(([position]) => position);
  for (const [index, timestamp] of [1000, 2000, 9000, 11000].entries()) {
    expect(x[index]).toBeCloseTo((timestamp / 11000) * 300);
  }
});
