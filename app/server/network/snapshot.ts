import type { HostInfo, Machine } from "~/types";
import { isNoExpiry } from "~/utils/node-info";

export interface NetworkRegion {
  id: number;
  code: string;
  name: string;
}

export interface NetworkLatency {
  regionId: number;
  regionName: string;
  family: string;
  /** Agent-reported DERP STUN latency, not throughput or an active peer path. */
  milliseconds: number;
}

export interface NetworkNode {
  id: string;
  name: string;
  online: boolean;
  expired: boolean;
  lastSeen: string;
  expiry: string | null;
  ipAddresses: string[];
  homeRegion: number | null;
  homeName: string;
  latencies: NetworkLatency[];
  approvedRoutes: string[];
  pendingRoutes: string[];
  os: string | null;
  version: string | null;
  udp: boolean | null;
  ipv6: boolean | null;
  natVaries: boolean | null;
  endpoints: string[];
}

export interface NetworkSummary {
  nodes: NetworkNode[];
  counts: {
    total: number;
    online: number;
    offline: number;
    expired: number;
    expiring: number;
    /** Number of advertised prefixes awaiting approval, counted per node. */
    pendingRoutes: number;
    knownHome: number;
  };
}

export function summarizeNetwork(
  nodes: Machine[],
  hostInfo: Record<string, HostInfo>,
  regions: NetworkRegion[],
  now = Date.now(),
): NetworkSummary {
  const regionNames = new Map(regions.map((region) => [region.id, region.name || region.code]));
  const regionName = (id: number): string => regionNames.get(id) || `Region ${id}`;
  const summarized: NetworkNode[] = nodes.map((node) => {
    const info = hostInfo[node.nodeKey];
    const netInfo = info?.NetInfo;
    const homeRegion = positiveRegion(info?.HomeDERP) ?? positiveRegion(netInfo?.PreferredDERP);
    const expiryTime = isNoExpiry(node.expiry) ? Number.NaN : Date.parse(node.expiry!);
    const expiry = Number.isFinite(expiryTime) ? node.expiry : null;
    const approvedRoutes = new Set(node.approvedRoutes);
    const latencies: NetworkLatency[] = [];
    for (const [key, seconds] of Object.entries(netInfo?.DERPLatency ?? {})) {
      const match = /^([1-9]\d*)-(v[46])$/.exec(key);
      if (!match || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
        continue;
      }
      const regionId = positiveRegion(Number(match[1]));
      const milliseconds = seconds * 1000;
      if (regionId !== null && Number.isFinite(milliseconds)) {
        latencies.push({
          regionId,
          regionName: regionName(regionId),
          family: match[2],
          milliseconds,
        });
      }
    }
    latencies.sort(
      (a, b) =>
        a.milliseconds - b.milliseconds ||
        a.regionId - b.regionId ||
        a.family.localeCompare(b.family),
    );

    return {
      id: node.id,
      name: node.givenName || node.name,
      online: node.online,
      expired: expiry !== null && expiryTime <= now,
      lastSeen: node.lastSeen,
      expiry,
      ipAddresses: [...node.ipAddresses],
      homeRegion,
      homeName: homeRegion === null ? "Unknown" : regionName(homeRegion),
      latencies,
      approvedRoutes: [...approvedRoutes],
      pendingRoutes: [...new Set(node.availableRoutes)].filter(
        (route) => !approvedRoutes.has(route),
      ),
      os: info?.OS || null,
      version: info?.IPNVersion || null,
      udp: optionalBool(netInfo?.WorkingUDP),
      ipv6: optionalBool(netInfo?.WorkingIPv6),
      natVaries: optionalBool(netInfo?.MappingVariesByDestIP),
      endpoints: [...(info?.Endpoints ?? [])],
    };
  });
  const online = summarized.filter((node) => node.online).length;

  return {
    nodes: summarized,
    counts: {
      total: summarized.length,
      online,
      offline: summarized.length - online,
      expired: summarized.filter((node) => node.expired).length,
      expiring: summarized.filter(
        (node) =>
          node.expiry !== null && !node.expired && Date.parse(node.expiry) <= now + 7 * 86_400_000,
      ).length,
      pendingRoutes: summarized.reduce((total, node) => total + node.pendingRoutes.length, 0),
      knownHome: summarized.filter((node) => node.homeRegion !== null).length,
    },
  };
}

function positiveRegion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function optionalBool(value: unknown): boolean | null {
  // Go opt.Bool can arrive as strings even though the legacy HostInfo type
  // describes booleans. Empty and unrecognized values mean unobserved.
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}
