export interface MetricsSource {
  id: string;
  name: string;
  url: string;
  region_id?: number;
}

export interface DerpCounters {
  connections: number | null;
  receivedBytes: number | null;
  sentBytes: number | null;
}

export interface DerpMetrics extends DerpCounters {
  id: string;
  name: string;
  regionId: number | null;
  observedAt: number;
  error?: string;
}

export interface ParsedDerpMetrics extends DerpCounters {
  error?: string;
}

const MAX_BODY_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Read only operator-configured sources. Callers must never construct sources
 * from request parameters. Source URLs and remote error details stay server-side.
 * The optional transport keeps boundary tests independent of network IO.
 */
export async function readDerpMetrics(
  source: MetricsSource,
  request: typeof fetch = fetch,
): Promise<DerpMetrics> {
  const result = (counters: ParsedDerpMetrics): DerpMetrics => ({
    id: source.id,
    name: source.name,
    regionId:
      typeof source.region_id === "number" &&
      Number.isSafeInteger(source.region_id) &&
      source.region_id > 0
        ? source.region_id
        : null,
    observedAt: Date.now(),
    ...counters,
  });
  let url: URL;
  try {
    url = new URL(source.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.includes("#")
    ) {
      return result(unknownMetrics("Invalid metrics source URL."));
    }
  } catch {
    return result(unknownMetrics("Invalid metrics source URL."));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await request(url, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      headers: { Accept: "application/json, text/plain" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return result(unknownMetrics(`Metrics endpoint returned HTTP ${response.status}.`));
    }
    if (Number(response.headers.get("content-length")) > MAX_BODY_BYTES) {
      return result(unknownMetrics("Metrics response exceeds 1 MiB."));
    }
    if (!response.body) return result(unknownMetrics("Invalid DERP metrics response."));

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BODY_BYTES) {
          return result(unknownMetrics("Metrics response exceeds 1 MiB."));
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return result(parseDerpMetrics(Buffer.concat(chunks, size).toString("utf8")));
  } catch {
    return result(
      unknownMetrics(
        controller.signal.aborted ? "Metrics request timed out." : "Metrics request failed.",
      ),
    );
  } finally {
    clearTimeout(timeout);
    // Also stop an unread response after status or size rejection.
    controller.abort();
  }
}

const metricNames = {
  connections: [
    "derp_current_connections",
    "derp_gauge_current_connections",
    "gauge_current_connections",
    "current_connections",
  ],
  receivedBytes: [
    "derp_bytes_received_total",
    "derp_bytes_received",
    "bytes_received_total",
    "bytes_received",
  ],
  sentBytes: ["derp_bytes_sent_total", "derp_bytes_sent", "bytes_sent_total", "bytes_sent"],
} as const;

const supportedNames = new Set<string>(Object.values(metricNames).flat());

/** Parse native DERP expvar or Prometheus output; only aggregate server counters. */
export function parseDerpMetrics(body: string): ParsedDerpMetrics {
  const text = body.trim();
  let result: DerpCounters;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      const root = record(parsed);
      const stats = record(Object.hasOwn(root, "derp") ? root.derp : root);
      result = {
        connections: counter(stats.gauge_current_connections),
        receivedBytes: counter(stats.bytes_received),
        sentBytes: counter(stats.bytes_sent),
      };
    } catch {
      return unknownMetrics("Invalid DERP metrics response.");
    }
  } else {
    const values = new Map<string, number | null>();
    for (const line of text.split(/\r?\n/)) {
      // Labels are opaque series identifiers; comments and unrelated metrics are ignored.
      const match =
        /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(?:[^"{}]|"(?:\\.|[^"\\])*")*\})?\s+(\S+)(?:\s+[+-]?\d+)?\s*$/.exec(
          line.trim(),
        );
      if (!match || !supportedNames.has(match[1])) continue;
      const [, name, raw] = match;
      const value = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)
        ? counter(Number(raw))
        : null;
      const previous = values.has(name) ? values.get(name)! : 0;
      values.set(name, value === null || previous === null ? null : counter(previous + value));
    }
    const select = (names: readonly string[]): number | null => {
      const name = names.find((candidate) => values.has(candidate));
      return name === undefined ? null : values.get(name)!;
    };
    result = {
      connections: select(metricNames.connections),
      receivedBytes: select(metricNames.receivedBytes),
      sentBytes: select(metricNames.sentBytes),
    };
  }
  return Object.values(result).every((value) => value === null)
    ? unknownMetrics("No supported DERP metrics found.")
    : result;
}

export interface DerpRates {
  rxBytesPerSecond: number | null;
  txBytesPerSecond: number | null;
}

/** Rates describe aggregate relay traffic between two successful observations. */
export function deriveRates(
  previous: DerpMetrics | null | undefined,
  current: DerpMetrics,
): DerpRates {
  const unknown: DerpRates = { rxBytesPerSecond: null, txBytesPerSecond: null };
  if (
    !previous ||
    previous.error ||
    current.error ||
    previous.id !== current.id ||
    previous.regionId !== current.regionId
  ) {
    return unknown;
  }
  const seconds = (current.observedAt - previous.observedAt) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return unknown;

  const rate = (before: number | null, after: number | null): number | null => {
    if (counter(before) === null || counter(after) === null || after! < before!) return null;
    return counter((after! - before!) / seconds);
  };
  return {
    rxBytesPerSecond: rate(previous.receivedBytes, current.receivedBytes),
    txBytesPerSecond: rate(previous.sentBytes, current.sentBytes),
  };
}

function unknownMetrics(error: string): ParsedDerpMetrics {
  return { connections: null, receivedBytes: null, sentBytes: null, error };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function counter(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
