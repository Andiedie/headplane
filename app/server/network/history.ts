import { and, desc, eq, gte, lt, notInArray } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import { networkHistory } from "../db/schema";

export interface HistoryOptions {
  enabled: boolean;
  retention_days: number;
  max_rows?: number;
}

export type HistoryKind = "node" | "relay" | "action";

export interface HistoryEvent {
  id: number;
  kind: HistoryKind;
  entityId: string;
  observedAt: number;
  payload: Record<string, unknown>;
}

export interface NodeObservation {
  id: string;
  name: string;
  online: boolean;
  homeRegion: number | null;
}

export interface NetworkHistory {
  record(
    kind: HistoryKind,
    entityId: string,
    payload: Record<string, unknown>,
    observedAt?: number,
  ): Promise<void>;
  observeNodes(nodes: NodeObservation[], at?: number): Promise<void>;
  recent(kind?: HistoryKind, limit?: number, entityId?: string): Promise<HistoryEvent[]>;
  prune(now?: number): Promise<void>;
}

function validateTimestamp(at: number) {
  if (!Number.isSafeInteger(at) || at < 0) {
    throw new RangeError("History timestamps must be non-negative integer milliseconds");
  }
}

function validateEntityId(id: string) {
  if (!id || id.length > 256 || /^(?:nodekey:|mkey:|machinekey:|tskey-)/i.test(id)) {
    throw new TypeError("History entityId must be a stable identifier, not a key");
  }
}

function observationPayload(payload: Record<string, unknown>) {
  const { name, online, homeRegion } = payload;
  if (
    typeof name !== "string" ||
    typeof online !== "boolean" ||
    (homeRegion !== null &&
      (typeof homeRegion !== "number" || !Number.isSafeInteger(homeRegion) || homeRegion < 0))
  ) {
    throw new TypeError("Invalid node observation");
  }
  return { name, online, homeRegion };
}

function cleanPayload(
  kind: HistoryKind,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  // Callers still supply allowlisted data; this also strips common credential
  // fields if an object is accidentally passed through from an API response.
  const sensitive =
    /password|secret|token|authorization|cookie|credential|apikey|authkey|privatekey|nodekey|machinekey/i;
  const encoded = JSON.stringify(
    kind === "node" ? observationPayload(payload) : payload,
    (key, value) => {
      if (sensitive.test(key.replace(/[_-]/g, ""))) return undefined;
      if (
        ["bigint", "function", "symbol"].includes(typeof value) ||
        (typeof value === "number" && !Number.isFinite(value))
      ) {
        throw new TypeError("History payload must contain JSON data");
      }
      return value;
    },
  );
  if (Buffer.byteLength(encoded, "utf8") > 16_384) {
    throw new RangeError("History payload exceeds 16 KiB");
  }
  const cleaned = JSON.parse(encoded);
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
    throw new TypeError("History payload must be a JSON object");
  }
  return cleaned;
}

export function createNetworkHistory(
  db: NodeSQLiteDatabase,
  options: HistoryOptions,
): NetworkHistory {
  if (!options.enabled) {
    return {
      async record() {},
      async observeNodes() {},
      async recent() {
        return [];
      },
      async prune() {},
    };
  }

  const retentionMs = options.retention_days * 24 * 60 * 60 * 1000;
  const maxRows = options.max_rows ?? 10_000;
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
    throw new RangeError("History retention_days must be positive and finite");
  }
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0) {
    throw new RangeError("History max_rows must be a positive safe integer");
  }

  function pruneRows(store: Pick<NodeSQLiteDatabase, "delete" | "select">, now: number) {
    store
      .delete(networkHistory)
      .where(lt(networkHistory.observed_at, now - retentionMs))
      .run();
    store
      .delete(networkHistory)
      .where(
        notInArray(
          networkHistory.id,
          store
            .select({ id: networkHistory.id })
            .from(networkHistory)
            .orderBy(desc(networkHistory.observed_at), desc(networkHistory.id))
            .limit(maxRows),
        ),
      )
      .run();
  }

  return {
    async prune(now = Date.now()) {
      validateTimestamp(now);
      db.transaction((tx) => pruneRows(tx, now));
    },
    async record(
      kind: HistoryKind,
      entityId: string,
      payload: Record<string, unknown>,
      observedAt = Date.now(),
    ): Promise<void> {
      validateTimestamp(observedAt);
      validateEntityId(entityId);
      const cleaned = cleanPayload(kind, payload);
      db.transaction((tx) => {
        tx.insert(networkHistory)
          .values({ kind, entity_id: entityId, observed_at: observedAt, payload: cleaned })
          .run();
        pruneRows(tx, Date.now());
      });
    },
    async observeNodes(nodes: NodeObservation[], at = Date.now()): Promise<void> {
      validateTimestamp(at);
      db.transaction((tx) => {
        for (const node of nodes) {
          validateEntityId(node.id);
          // Read the retained baseline, including after a restart. No per-node cache
          // means removed nodes cannot accumulate in memory.
          const previous = tx
            .select({ payload: networkHistory.payload })
            .from(networkHistory)
            .where(and(eq(networkHistory.kind, "node"), eq(networkHistory.entity_id, node.id)))
            .orderBy(desc(networkHistory.observed_at), desc(networkHistory.id))
            .get();
          if (
            previous?.payload.online === node.online &&
            previous.payload.homeRegion === node.homeRegion
          ) {
            continue;
          }
          tx.insert(networkHistory)
            .values({
              kind: "node",
              entity_id: node.id,
              observed_at: at,
              payload: cleanPayload("node", {
                name: node.name,
                online: node.online,
                homeRegion: node.homeRegion,
              }),
            })
            .run();
        }
        pruneRows(tx, Date.now());
      });
    },
    async recent(kind?: HistoryKind, limit = 100, entityId?: string): Promise<HistoryEvent[]> {
      const boundedLimit = Number.isNaN(limit)
        ? 100
        : Math.min(1000, Math.max(0, Math.trunc(limit)));
      return db
        .select({
          id: networkHistory.id,
          kind: networkHistory.kind,
          entityId: networkHistory.entity_id,
          observedAt: networkHistory.observed_at,
          payload: networkHistory.payload,
        })
        .from(networkHistory)
        .where(
          and(
            gte(networkHistory.observed_at, Date.now() - retentionMs),
            kind ? eq(networkHistory.kind, kind) : undefined,
            entityId !== undefined ? eq(networkHistory.entity_id, entityId) : undefined,
          ),
        )
        .orderBy(desc(networkHistory.observed_at), desc(networkHistory.id))
        .limit(boundedLimit)
        .all();
    },
  };
}
