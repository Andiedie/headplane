import { describe, expect, test } from "vitest";

import { summarizeNetwork } from "~/server/network/snapshot";
import type { HostInfo, Machine } from "~/types";

const now = Date.parse("2026-06-01T12:00:00Z");
const regions = [
  { id: 1, code: "nyc", name: "New York" },
  { id: 2, code: "fra", name: "Frankfurt" },
];

function machine(overrides: Partial<Machine> = {}): Machine {
  return {
    id: "1",
    machineKey: "mkey:one",
    nodeKey: "nodekey:one",
    discoKey: "discokey:one",
    givenName: "workstation",
    name: "original-hostname",
    ipAddresses: ["100.64.0.1", "fd7a:115c:a1e0::1"],
    tags: [],
    lastSeen: "2026-06-01T11:59:00Z",
    expiry: null,
    online: true,
    registerMethod: "REGISTER_METHOD_AUTH_KEY",
    createdAt: "2026-01-01T00:00:00Z",
    approvedRoutes: [],
    availableRoutes: [],
    subnetRoutes: [],
    ...overrides,
  };
}

describe("summarizeNetwork", () => {
  test.each([
    [true, true],
    [false, false],
    ["true", true],
    ["false", false],
    ["", null],
    ["TRUE", null],
    [1, null],
    [0, null],
    [null, null],
    [undefined, null],
  ])("normalizes Go opt.Bool %j without treating unknown as false", (value, expected) => {
    const info = {
      NetInfo: { WorkingUDP: value, WorkingIPv6: value, MappingVariesByDestIP: value },
    } as unknown as HostInfo;
    expect(
      summarizeNetwork([machine()], { "nodekey:one": info }, regions, now).nodes[0],
    ).toMatchObject({ udp: expected, ipv6: expected, natVaries: expected });
  });

  test.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back from invalid HomeDERP %j to PreferredDERP",
    (HomeDERP) => {
      const summary = summarizeNetwork(
        [machine()],
        {
          "nodekey:one": { HomeDERP, NetInfo: { PreferredDERP: 99 } },
        },
        regions,
        now,
      );
      expect(summary.nodes[0]).toMatchObject({ homeRegion: 99, homeName: "Region 99" });
      expect(summary.counts.knownHome).toBe(1);
    },
  );

  test("counts expired and soon-expiring keys without expiring disabled or invalid dates", () => {
    const nodes = [
      machine({ expiry: "2026-06-01T11:59:59Z" }),
      machine({ expiry: "2026-06-01T12:00:00Z", online: false }),
      machine({ expiry: "2026-06-08T12:00:00Z" }),
      machine({ expiry: "2026-06-08T12:00:00.001Z", online: false }),
      machine({ expiry: "0001-01-01T00:00:00Z" }),
      machine({ expiry: "0001-01-01 00:00:00" }),
      machine({ expiry: null }),
      machine({ expiry: "invalid" }),
    ];
    const summary = summarizeNetwork(nodes, {}, regions, now);
    expect(summary.counts).toMatchObject({
      total: 8,
      online: 6,
      offline: 2,
      expired: 2,
      expiring: 1,
    });
    expect(summary.nodes.map((node) => node.expired)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(summary.nodes.slice(4).map((node) => node.expiry)).toEqual([null, null, null, null]);
  });

  test("derives pending approvals from advertised prefixes, including exit routes, per node", () => {
    const node = machine({
      approvedRoutes: ["10.0.0.0/24", "10.0.0.0/24", "172.16.0.0/16"],
      availableRoutes: ["10.0.0.0/24", "192.168.0.0/24", "192.168.0.0/24", "0.0.0.0/0", "::/0"],
    });
    const summary = summarizeNetwork(
      [node, machine({ availableRoutes: ["192.168.0.0/24"] })],
      {},
      regions,
      now,
    );
    expect(summary.nodes[0].approvedRoutes).toEqual(["10.0.0.0/24", "172.16.0.0/16"]);
    expect(summary.nodes[0].pendingRoutes).toEqual(["192.168.0.0/24", "0.0.0.0/0", "::/0"]);
    expect(summary.counts.pendingRoutes).toBe(4);
    summary.nodes[0].ipAddresses.push("100.64.0.2");
    summary.nodes[0].approvedRoutes.push("10.1.0.0/24");
    expect(node.ipAddresses).toEqual(["100.64.0.1", "fd7a:115c:a1e0::1"]);
    expect(node.approvedRoutes).toEqual(["10.0.0.0/24", "10.0.0.0/24", "172.16.0.0/16"]);
  });
  test("joins agent data by node key and validates observed DERP latencies", () => {
    const info: HostInfo = {
      HomeDERP: 2,
      OS: "linux",
      IPNVersion: "1.100.0",
      Endpoints: ["203.0.113.1:41641"],
      NetInfo: {
        PreferredDERP: 1,
        WorkingUDP: true,
        WorkingIPv6: false,
        MappingVariesByDestIP: false,
        DERPLatency: {
          "1-v4": 0.125,
          "2-v6": 0.008,
          "99-v4": 0.2,
          "1-v6": 0,
          "2-v4": -1,
          "3-v4": Number.NaN,
          "4-v6": Number.POSITIVE_INFINITY,
          "5-v4": Number.MAX_VALUE,
          "6-v4": "0.1" as unknown as number,
          "0-v4": 0.1,
          "1-v5": 0.1,
          garbage: 0.1,
          "1-v4-extra": 0.1,
        },
      },
    };
    const summary = summarizeNetwork(
      [machine()],
      { "1": { HomeDERP: 1 }, "nodekey:one": info },
      regions,
      now,
    );

    expect(summary.nodes[0]).toMatchObject({
      homeRegion: 2,
      homeName: "Frankfurt",
      os: "linux",
      version: "1.100.0",
      endpoints: ["203.0.113.1:41641"],
      udp: true,
      ipv6: false,
      natVaries: false,
      latencies: [
        { regionId: 2, regionName: "Frankfurt", family: "v6", milliseconds: 8 },
        { regionId: 1, regionName: "New York", family: "v4", milliseconds: 125 },
        { regionId: 99, regionName: "Region 99", family: "v4", milliseconds: 200 },
      ],
    });
    expect(summary.counts.knownHome).toBe(1);

    // Consumers may sort their output without mutating the cached API/agent data.
    summary.nodes[0].endpoints.push("203.0.113.2:41641");
    expect(info.Endpoints).toEqual(["203.0.113.1:41641"]);
  });
  test("keeps missing agent observations unknown while preserving API node data", () => {
    const node = machine();
    const summary = summarizeNetwork([node], {}, regions, now);

    expect(summary.nodes).toEqual([
      {
        id: "1",
        name: "workstation",
        online: true,
        expired: false,
        lastSeen: node.lastSeen,
        expiry: null,
        ipAddresses: node.ipAddresses,
        homeRegion: null,
        homeName: "Unknown",
        latencies: [],
        approvedRoutes: [],
        pendingRoutes: [],
        os: null,
        version: null,
        udp: null,
        ipv6: null,
        natVaries: null,
        endpoints: [],
      },
    ]);
    expect(summary.counts).toEqual({
      total: 1,
      online: 1,
      offline: 0,
      expired: 0,
      expiring: 0,
      pendingRoutes: 0,
      knownHome: 0,
    });
  });
});
