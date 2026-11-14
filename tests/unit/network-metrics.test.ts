import { describe, expect, test, vi } from "vitest";

import {
  deriveRates,
  parseDerpMetrics,
  readDerpMetrics,
  type DerpMetrics,
  type MetricsSource,
} from "~/server/network/metrics";

const source: MetricsSource = {
  id: "relay-a",
  name: "Relay A",
  url: "https://relay.example/debug/vars?token=private",
  region_id: 1,
};

describe("readDerpMetrics", () => {
  test("reads a configured source using a bounded GET and returns only display-safe metadata", async () => {
    const start = Date.now();
    const result = await readDerpMetrics(source, async (url, init) => {
      expect(String(url)).toBe(source.url);
      expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('{"derp":{"gauge_current_connections":3,"bytes_sent":100}}');
    });
    expect(result).toEqual({
      id: "relay-a",
      name: "Relay A",
      regionId: 1,
      observedAt: expect.any(Number),
      connections: 3,
      receivedBytes: null,
      sentBytes: 100,
    });
    expect(result.observedAt).toBeGreaterThanOrEqual(start);
    expect(result.observedAt).toBeLessThanOrEqual(Date.now());
  });

  test.each([
    "file:///private/data",
    "ftp://relay.example/metrics",
    "/metrics",
    "not a url",
    "https://name:private@relay.example/metrics",
    "https://name@relay.example/metrics",
    "https://relay.example/metrics#private",
    "https://relay.example/metrics#",
  ])("rejects invalid source URL %s before fetching", async (url) => {
    let requests = 0;
    const result = await readDerpMetrics({ ...source, url }, async () => {
      requests++;
      return new Response("derp_current_connections 1");
    });
    expect(requests).toBe(0);
    expect(result.error).toBe("Invalid metrics source URL.");
    expect(result).toMatchObject({ connections: null, receivedBytes: null, sentBytes: null });
  });

  test("returns generic errors for failed HTTP responses and network errors", async () => {
    for (const status of [302, 401, 500]) {
      const result = await readDerpMetrics(
        source,
        async () =>
          new Response("private server body", {
            status,
            statusText: "private reason",
            headers: { location: "https://private.example/" },
          }),
      );
      expect(result.error).toBe(`Metrics endpoint returned HTTP ${status}.`);
      expect(result).toMatchObject({ connections: null, receivedBytes: null, sentBytes: null });
    }
    const result = await readDerpMetrics(source, async () => {
      throw new Error(source.url);
    });
    expect(result.error).toBe("Metrics request failed.");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  test("rejects bodies above 1 MiB with or without an honest Content-Length", async () => {
    const headerSets: HeadersInit[] = [
      {},
      { "content-length": "1" },
      { "content-length": "1048577" },
    ];
    for (const headers of headerSets) {
      const result = await readDerpMetrics(
        source,
        async () => new Response(" ".repeat(1_048_577), { headers }),
      );
      expect(result.error).toBe("Metrics response exceeds 1 MiB.");
      expect(result.receivedBytes).toBeNull();
    }
    const body = "derp_current_connections 1\n".padEnd(1_048_576, " ");
    expect((await readDerpMetrics(source, async () => new Response(body))).connections).toBe(1);
  });

  test("keeps the timeout active while reading a stalled response body", async () => {
    vi.useFakeTimers();
    try {
      const result = readDerpMetrics(
        source,
        async (_url, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"derp":'));
                init?.signal?.addEventListener(
                  "abort",
                  () => controller.error(new Error("private timeout detail")),
                  { once: true },
                );
              },
            }),
          ),
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect((await result).error).toBe("Metrics request timed out.");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

function observation(overrides: Partial<DerpMetrics> = {}): DerpMetrics {
  return {
    id: "relay-a",
    name: "Relay A",
    regionId: 1,
    observedAt: 1000,
    connections: 2,
    receivedBytes: 1000,
    sentBytes: 2000,
    ...overrides,
  };
}

describe("deriveRates", () => {
  test("derives byte rates from elapsed milliseconds with independent counter resets", () => {
    const previous = observation();
    expect(
      deriveRates(
        previous,
        observation({ observedAt: 3000, receivedBytes: 3000, sentBytes: 6000 }),
      ),
    ).toEqual({ rxBytesPerSecond: 1000, txBytesPerSecond: 2000 });
    expect(
      deriveRates(previous, observation({ observedAt: 3000, receivedBytes: 100, sentBytes: 2000 })),
    ).toEqual({ rxBytesPerSecond: null, txBytesPerSecond: 0 });
    expect(
      deriveRates(previous, observation({ observedAt: 3000, receivedBytes: null, sentBytes: 100 })),
    ).toEqual({ rxBytesPerSecond: null, txBytesPerSecond: null });
  });

  test("requires successful observations of the same source separated by positive finite time", () => {
    const current = observation({ observedAt: 3000 });
    for (const previous of [
      undefined,
      null,
      observation({ id: "relay-b" }),
      observation({ regionId: 2 }),
      observation({ observedAt: 3000 }),
      observation({ observedAt: 4000 }),
      observation({ observedAt: Number.NaN }),
      observation({ observedAt: Number.NEGATIVE_INFINITY }),
      observation({ error: "Metrics request failed." }),
    ]) {
      expect(deriveRates(previous, current)).toEqual({
        rxBytesPerSecond: null,
        txBytesPerSecond: null,
      });
    }
    expect(deriveRates(observation(), { ...current, error: "Metrics request failed." })).toEqual({
      rxBytesPerSecond: null,
      txBytesPerSecond: null,
    });
    expect(
      deriveRates(observation(), {
        ...current,
        receivedBytes: Number.POSITIVE_INFINITY,
        sentBytes: -1,
      }),
    ).toEqual({ rxBytesPerSecond: null, txBytesPerSecond: null });
  });
});

describe("parseDerpMetrics", () => {
  test("reads Prometheus gauges and counters, summing labeled series without adding aliases", () => {
    const body = `# HELP derp_current_connections Current connections
# TYPE derp_current_connections gauge
derp_current_connections 4
derp_gauge_current_connections 4
derp_bytes_received_total{family="v4"} 1.25e3
derp_bytes_received_total{family="v6"} 750 1760000000000
derp_bytes_sent_total 3e3
process_resident_memory_bytes 9999
`;
    expect(parseDerpMetrics(body)).toEqual({
      connections: 4,
      receivedBytes: 2000,
      sentBytes: 3000,
    });
    expect(
      parseDerpMetrics("gauge_current_connections 0\nbytes_received 0\nbytes_sent 12\n"),
    ).toEqual({ connections: 0, receivedBytes: 0, sentBytes: 12 });
    expect(
      parseDerpMetrics(
        "derp_gauge_current_connections 2\nderp_bytes_received 50\nderp_bytes_sent 60\n",
      ),
    ).toEqual({ connections: 2, receivedBytes: 50, sentBytes: 60 });
  });

  test("preserves invalid counters as unknown instead of coercing them or taking partial totals", () => {
    expect(
      parseDerpMetrics(
        '{"derp":{"gauge_current_connections":0,"bytes_received":"100","bytes_sent":-1}}',
      ),
    ).toEqual({ connections: 0, receivedBytes: null, sentBytes: null });
    expect(
      parseDerpMetrics(
        'derp_current_connections 1\nderp_bytes_received{family="v4"} 10\nderp_bytes_received{family="v6"} NaN\nderp_bytes_sent +Inf\n',
      ),
    ).toEqual({ connections: 1, receivedBytes: null, sentBytes: null });
    expect(
      parseDerpMetrics(
        "derp_current_connections 1\nderp_bytes_received 12garbage\nderp_bytes_sent -2\n",
      ),
    ).toEqual({ connections: 1, receivedBytes: null, sentBytes: null });
  });

  test.each([
    "",
    "not metrics",
    "<html>secret token</html>",
    "{broken secret",
    "[]",
    "null",
    '{"derp":null}',
    '{"memstats":{"Alloc":10}}',
    "# HELP unrelated metric\nprocess_resident_memory_bytes 100\n",
  ])("reports unsupported or malformed responses without echoing the body: %j", (body) => {
    const parsed = parseDerpMetrics(body);
    expect(parsed).toMatchObject({ connections: null, receivedBytes: null, sentBytes: null });
    expect(parsed.error).toMatch(
      /^(Invalid DERP metrics response|No supported DERP metrics found)\.$/,
    );
  });
  test("reads native expvar DERP counters without converting missing counters to zero", () => {
    const stats = { gauge_current_connections: 3, bytes_received: 1250, bytes_sent: 2400 };
    expect(parseDerpMetrics(JSON.stringify({ derp: stats, memstats: { Alloc: 10 } }))).toEqual({
      connections: 3,
      receivedBytes: 1250,
      sentBytes: 2400,
    });
    expect(parseDerpMetrics(JSON.stringify(stats))).toEqual({
      connections: 3,
      receivedBytes: 1250,
      sentBytes: 2400,
    });
    expect(parseDerpMetrics('{"derp":{"gauge_current_connections":0}}')).toEqual({
      connections: 0,
      receivedBytes: null,
      sentBytes: null,
    });
  });
});
