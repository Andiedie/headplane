import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import type { HeadplaneConfig } from "~/server/config/config-schema";
import type { Feature } from "~/server/feature";
import type { HeadscaleClient } from "~/server/headscale/api";
import type { AgentManager } from "~/server/hp-agent";
import type { HostInfo } from "~/types";
import log from "~/utils/log";

import { createNetworkHistory } from "./history";
import { deriveRates, readDerpMetrics } from "./metrics";
import { createRelayManager } from "./relays";
import { summarizeNetwork } from "./snapshot";

interface Options {
  config: HeadplaneConfig;
  api?: HeadscaleClient;
  agents: Feature<AgentManager>;
  db: NodeSQLiteDatabase;
}

type Metric = Awaited<ReturnType<typeof readDerpMetrics>>;
type MetricView = Metric & ReturnType<typeof deriveRates>;

export function createNetworkService({ config, api, agents, db }: Options) {
  const options = config.network;
  const historyEnabled = Boolean(options?.history?.enabled && api);
  const history = createNetworkHistory(db, {
    enabled: historyEnabled,
    retention_days: options?.history?.retention_days ?? 7,
    max_rows: options?.history?.max_rows ?? 10000,
  });
  const relays = createRelayManager(options?.relays, config.headscale.config_path);
  const metrics = new Map<string, MetricView>();
  const metricSourceIds = [...new Set(options?.metrics?.map((source) => source.id))];
  let timer: ReturnType<typeof setInterval> | undefined;
  let collecting: Promise<void> | undefined;
  let stopped = false;
  let collectionError: string | null = null;

  async function read(requestApi: HeadscaleClient) {
    const [nodes, relay] = await Promise.all([requestApi.nodes.list(), relays.read()]);
    let hosts: Record<string, HostInfo> = {};
    let agentError: string | null = null;
    if (agents.state === "enabled") {
      try {
        hosts = await agents.value.lookup(nodes.map((node) => node.nodeKey));
      } catch {
        agentError = "Device network information is unavailable.";
      }
    }
    const sync = agents.state === "enabled" ? agents.value.lastSync() : undefined;
    const observedAt = Date.now();
    // Keep frequent relay samples from hiding activity or quieter relay sources.
    const recentHistory = await Promise.all([
      history.recent("node", 60),
      history.recent("action", 60),
      ...metricSourceIds.map((id) => history.recent("relay", 60, id)),
    ]);
    return {
      snapshot: summarizeNetwork(nodes, hosts, relay.regions, observedAt),
      observedAt,
      relay,
      agent: {
        enabled: agents.state === "enabled",
        syncedAt: sync?.syncedAt?.getTime() ?? null,
        error: agentError ?? (sync?.error ? "Agent synchronization failed." : null),
      },
      metrics: [...metrics.values()],
      history: recentHistory.flat().sort((a, b) => b.observedAt - a.observedAt || b.id - a.id),
      historyEnabled,
      historyReason:
        options?.history?.enabled && !api
          ? "History requires a configured Headscale API key."
          : null,
      collectionError,
      pollInterval: options?.poll_interval ?? 30000,
    };
  }

  async function collectOnce() {
    collectionError = null;
    if (historyEnabled && api) {
      try {
        const current = await read(api);
        await history.observeNodes(
          current.snapshot.nodes.map((node) => ({
            id: node.id,
            name: node.name,
            online: node.online,
            homeRegion: node.homeRegion,
          })),
          current.observedAt,
        );
      } catch {
        collectionError = "The latest device observation failed; no offline events were inferred.";
        log.warn("server", "%s", collectionError);
      }
    }
    await Promise.all(
      (options?.metrics ?? []).map(async (source) => {
        try {
          const sample = await readDerpMetrics(source);
          const previous = metrics.get(source.id);
          const rates =
            previous && !previous.error && !sample.error
              ? deriveRates(previous, sample)
              : { rxBytesPerSecond: null, txBytesPerSecond: null };
          const current = { ...sample, ...rates };
          metrics.set(source.id, current);
          if (!sample.error) {
            await history.record("relay", source.id, { ...current }, sample.observedAt);
          }
        } catch {
          collectionError = "A relay observation could not be recorded.";
          log.warn("server", "%s", collectionError);
        }
      }),
    );
    await history.prune();
  }

  function collect() {
    if (stopped) return Promise.resolve();
    if (!collecting) {
      collecting = collectOnce()
        .catch(() => {
          collectionError = "Network observations are temporarily unavailable.";
          log.warn("server", "%s", collectionError);
        })
        .finally(() => {
          collecting = undefined;
        });
    }
    return collecting;
  }

  async function select(region: number, revision: string, actor: string) {
    const result = await relays.select(region, revision);
    try {
      await history.record("action", "relay-selection", {
        actor,
        region,
        outcome: result.ok ? "saved" : "failed",
      });
    } catch {
      // A successful configuration write must not be reported as failed
      // just because optional audit storage is unavailable.
      collectionError = "The relay operation could not be added to history.";
      log.warn("server", "%s", collectionError);
    }
    return result;
  }

  return {
    read,
    select,
    collect,
    async recordAction(event: {
      actor: string;
      intent: string;
      path: string;
      outcome: "success" | "failed";
      target?: string;
    }) {
      try {
        await history.record("action", event.target ?? event.path, { ...event });
      } catch {
        collectionError = "A dashboard operation could not be added to history.";
        log.warn("server", "%s", collectionError);
      }
    },
    start() {
      if (timer || stopped || (!historyEnabled && !options?.metrics?.length)) return;
      void collect();
      timer = setInterval(() => void collect(), options?.poll_interval ?? 30000);
      timer.unref();
    },
    async dispose() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await collecting;
    },
  };
}
