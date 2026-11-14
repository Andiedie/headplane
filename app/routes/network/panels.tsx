import { ArrowRight, Clock, Server } from "lucide-react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Callout from "~/components/callout";
import Link from "~/components/link";
import cn from "~/utils/cn";

import type { action, loader } from "./overview";

type Data = Awaited<ReturnType<typeof loader>>;
type NetworkNode = Data["snapshot"]["nodes"][number];

export function Overview({ data }: { data: Data }) {
  const nodes = data.snapshot.nodes;
  const online = nodes.filter((n) => n.online).length;
  const pending = nodes.filter((n) => n.pendingRoutes.length > 0).length;
  const expiring = nodes.filter(
    (n) => n.expiry && !n.expired && new Date(n.expiry).getTime() < data.observedAt + 7 * 86400000,
  ).length;
  const groups = new Map<string, NetworkNode[]>();
  for (const node of nodes) {
    const key = node.homeRegion === null ? "unknown" : String(node.homeRegion);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Devices" value={nodes.length} note={`${online} connected to Headscale`} />
        <Stat label="Offline" value={nodes.length - online} note="Control connection status" />
        <Stat label="Pending routes" value={pending} note="Devices awaiting route approval" />
        <Stat label="Expiring soon" value={expiring} note="Within the next 7 days" />
      </div>
      {!data.agent.enabled && (
        <Callout>
          Enable the built-in Headplane Agent to see reported home relays and network details. No
          additional software is needed on devices.
        </Callout>
      )}
      {data.agent.enabled && (
        <p className="text-muted text-xs">
          Agent last synchronized: {time(data.agent.syncedAt)}. Device reports may be older than
          this synchronization.{data.agent.error ? " The latest synchronization has an error." : ""}
        </p>
      )}
      <section
        className="border-line rounded-lg border p-5"
        aria-label="Reported home relay relationships"
      >
        <div className="mb-5">
          <h2 className="font-semibold">Reported home relays</h2>
          <p className="text-muted mt-1 text-sm">
            Logical relationships, not active traffic paths. Devices can communicate directly
            regardless of their home relay.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...groups].map(([id, members]) => (
            <div key={id} className="border-line bg-subtle rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Server className="text-accent size-4" />
                  {id === "unknown" ? "Not reported" : members[0].homeName}
                </span>
                <span className="text-muted text-xs">{members.length} devices</span>
              </div>
              <ul className="border-line ml-2 space-y-2 border-l pl-4">
                {members.map((node) => (
                  <li key={node.id} className="text-sm">
                    <Link styled to={`/machines/${node.id}`}>
                      <Dot online={node.online} />
                      {node.name}
                    </Link>
                    {node.approvedRoutes.length > 0 && (
                      <p className="text-muted mt-1 text-xs break-all">
                        Approved: {node.approvedRoutes.join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {nodes.length === 0 && <p className="text-muted text-sm">No devices registered.</p>}
        </div>
      </section>
      <section className="border-line overflow-hidden rounded-lg border">
        <div className="border-line border-b p-5">
          <h2 className="font-semibold">Device network details</h2>
          <p className="text-muted mt-1 text-sm">
            Expand a device for reported relay latency, candidate endpoints, and routes. Unknown
            values are not failures.
          </p>
        </div>
        {nodes.map((node) => (
          <Device key={node.id} node={node} />
        ))}
      </section>
    </div>
  );
}

function Device({ node }: { node: NetworkNode }) {
  return (
    <details className="border-line border-b last:border-b-0">
      <summary className="focus-ring hover:bg-hover grid cursor-pointer gap-2 px-5 py-4 text-sm sm:grid-cols-3">
        <span className="font-medium">
          <Dot online={node.online} />
          {node.name}
          {node.expired && <span className="text-warn ml-2 text-xs">Expired</span>}
        </span>
        <span className="text-muted">
          {node.homeRegion === null ? "Home relay not reported" : node.homeName}
        </span>
        <span className="text-muted sm:text-right">
          UDP {bool(node.udp)} · IPv6 {bool(node.ipv6)}
        </span>
      </summary>
      <div className="bg-subtle grid gap-6 px-5 pt-3 pb-5 text-sm md:grid-cols-2">
        <div className="space-y-2">
          <p>
            <span className="text-muted">Client: </span>
            {[node.os, node.version].filter(Boolean).join(" · ") || "Not reported"}
          </p>
          <p>
            <span className="text-muted">Addresses: </span>
            {node.ipAddresses.join(", ")}
          </p>
          <p>
            <span className="text-muted">NAT varies by destination: </span>
            {bool(node.natVaries)}
          </p>
          <p className="break-all">
            <span className="text-muted">Candidate endpoints: </span>
            {node.endpoints.join(", ") || "Not reported"}
          </p>
          <p className="break-all">
            <span className="text-muted">Approved routes: </span>
            {node.approvedRoutes.join(", ") || "None"}
          </p>
          <p className="break-all">
            <span className="text-muted">Pending routes: </span>
            {node.pendingRoutes.join(", ") || "None"}
          </p>
          <Link styled to={`/machines/${node.id}`}>
            Manage device <ArrowRight className="inline size-3" />
          </Link>
        </div>
        <div>
          <h3 className="mb-2 font-medium">Reported DERP latency</h3>
          {node.latencies.length === 0 ? (
            <p className="text-muted">No measurements reported.</p>
          ) : (
            <ul className="space-y-1">
              {node.latencies.map((latency) => (
                <li
                  className="flex justify-between gap-3"
                  key={`${latency.regionId}-${latency.family}`}
                >
                  <span>
                    {latency.regionName} <span className="text-muted">{latency.family}</span>
                  </span>
                  <span className="font-mono">{latency.milliseconds.toFixed(1)} ms</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted mt-3 text-xs">
            Client-reported probe results; not a live bandwidth test.
          </p>
        </div>
      </div>
    </details>
  );
}

export function Relays({ data }: { data: Data }) {
  const fetcher = useFetcher<typeof action>();
  const selected = data.relay.selectedRegionId;
  const matched = data.snapshot.nodes.filter((n) => n.online && n.homeRegion === selected).length;
  const known = data.snapshot.nodes.filter((n) => n.online && n.homeRegion !== null).length;
  const result = fetcher.data;
  return (
    <div className="space-y-6">
      <section className="border-line rounded-lg border p-5">
        <h2 className="font-semibold">Relay selection</h2>
        <p className="text-muted mt-1 text-sm">
          Publish one region in the managed DERP map. Direct connections are still preferred when
          available.
        </p>
        {data.relay.reason && <Callout className="mt-4">{data.relay.reason}</Callout>}
        {result && (
          <div role="status" className="mt-4">
            <Callout variant={result.ok ? undefined : "error"}>
              {result.ok ? result.message : Object.values(result.errors).join(" ")}
            </Callout>
          </div>
        )}
        <fetcher.Form method="post" key={data.relay.revision ?? "unconfigured"} className="mt-5">
          <input type="hidden" name="intent" value="select-relay" />
          <input type="hidden" name="revision" value={data.relay.revision ?? ""} />
          <fieldset
            disabled={!data.canSelectRelay || !data.relay.writable || fetcher.state !== "idle"}
            className="space-y-4"
          >
            <legend className="sr-only">Choose the advertised relay region</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.relay.regions.map((region) => (
                <label
                  key={region.id}
                  className="border-line bg-subtle flex cursor-pointer gap-3 rounded-lg border p-4"
                >
                  <input
                    className="accent-accent mt-1"
                    type="radio"
                    required
                    name="region"
                    value={region.id}
                    defaultChecked={selected === region.id}
                  />
                  <span>
                    <span className="block text-sm font-medium">{region.name}</span>
                    <span className="text-muted text-xs">
                      {region.code} · Region {region.id}
                    </span>
                  </span>
                  {selected === region.id && (
                    <span className="text-accent ml-auto text-xs">Saved</span>
                  )}
                </label>
              ))}
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={!data.relay.regions.length}
              pending={fetcher.state !== "idle"}
            >
              Save relay selection
            </Button>
          </fieldset>
        </fetcher.Form>
        {!data.canSelectRelay && (
          <p className="text-muted mt-3 text-sm">
            Your role can view relays but cannot change the selection.
          </p>
        )}
        <div className="border-line mt-5 grid gap-4 border-t pt-5 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted text-xs">Configuration</p>
            <p className="mt-1">
              {selected === null ? "No single region selected" : `Region ${selected} saved`}
            </p>
          </div>
          <div>
            <p className="text-muted text-xs">Headscale load status</p>
            <p className="mt-1">Not directly observable</p>
            <p className="text-muted mt-1 text-xs">
              {data.relay.refreshInterval
                ? `Configured refresh: ${data.relay.refreshInterval}`
                : "Refresh interval unavailable"}
            </p>
          </div>
          <div>
            <p className="text-muted text-xs">Reported home relay</p>
            <p className="mt-1">
              {selected === null
                ? "No selection to compare"
                : `${matched} of ${known} reporting online devices match`}
            </p>
            <p className="text-muted mt-1 text-xs">Does not confirm every device has switched.</p>
          </div>
        </div>
      </section>
      <section className="border-line rounded-lg border p-5">
        <h2 className="font-semibold">Relay traffic</h2>
        <p className="text-muted mt-1 text-sm">
          Native DERP counters only. Direct traffic is not included; sent and received bytes are
          shown separately.
        </p>
        {data.metrics.length === 0 ? (
          <p className="text-muted mt-5 text-sm">
            No native metrics sources have reported. Configure a supported DERP statistics endpoint
            to enable this section.
          </p>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {data.metrics.map((metric) => (
              <div key={metric.id} className="border-line rounded-lg border p-4">
                <h3 className="font-medium">{metric.name}</h3>
                {metric.error ? (
                  <p className="text-warn mt-2 text-sm">{metric.error}</p>
                ) : (
                  <>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-muted text-xs">Connections</p>
                        {metric.connections ?? "Unknown"}
                      </div>
                      <div>
                        <p className="text-muted text-xs">Received</p>
                        {bytes(metric.receivedBytes)}
                      </div>
                      <div>
                        <p className="text-muted text-xs">Sent</p>
                        {bytes(metric.sentBytes)}
                      </div>
                    </div>
                    <p className="text-muted mt-3 text-xs">
                      Receive {rate(metric.rxBytesPerSecond)} · Send {rate(metric.txBytesPerSecond)}
                    </p>
                  </>
                )}
                <p className="text-muted mt-2 text-xs">Observed {time(metric.observedAt)}</p>
                <TrafficHistory
                  records={data.history.filter(
                    (r) => r.kind === "relay" && r.entityId === metric.id,
                  )}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TrafficHistory({ records }: { records: Data["history"] }) {
  const samples = [...records]
    .sort((a, b) => a.observedAt - b.observedAt || a.id - b.id)
    .map((record) => {
      const value = record.payload.rxBytesPerSecond;
      return {
        at: record.observedAt,
        value: typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null,
      };
    });
  if (samples.filter((sample) => sample.value !== null).length < 2)
    return (
      <p className="text-muted mt-3 text-xs">
        Receive-rate history appears after two valid samples with history enabled.
      </p>
    );
  const peak = Math.max(...samples.map((s) => s.value ?? 0));
  const scale = peak || 1;
  const start = samples[0].at;
  const elapsed = samples[samples.length - 1].at - start || 1;
  const segments: { x: number; y: number }[][] = [[]];
  for (const sample of samples) {
    if (sample.value === null) {
      segments.push([]);
    } else {
      segments[segments.length - 1].push({
        x: ((sample.at - start) / elapsed) * 300,
        y: 48 - (sample.value / scale) * 44,
      });
    }
  }
  return (
    <figure className="mt-3">
      <svg
        viewBox="0 0 300 52"
        role="img"
        aria-label={`Received bytes per second, ${time(samples[0].at)} to ${time(samples[samples.length - 1].at)}`}
        className="text-accent h-14 w-full"
        preserveAspectRatio="none"
      >
        {segments
          .filter((segment) => segment.length > 0)
          .map((segment, index) =>
            segment.length === 1 ? (
              <circle key={index} cx={segment[0].x} cy={segment[0].y} r="1.5" fill="currentColor" />
            ) : (
              <polyline
                key={index}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                points={segment.map(({ x, y }) => `${x},${y}`).join(" ")}
              />
            ),
          )}
      </svg>
      <figcaption className="text-muted text-xs">
        Recorded receive rate · peak {rate(peak)}
      </figcaption>
    </figure>
  );
}

export function History({ data }: { data: Data }) {
  const events = data.history.filter((record) => record.kind !== "relay");
  return (
    <section className="border-line rounded-lg border p-5">
      <h2 className="font-semibold">Observation and operation history</h2>
      <p className="text-muted mt-1 text-sm">
        Observed state changes and operations made in this dashboard. Polling can miss brief
        changes; this is not a complete traffic or audit log.
      </p>
      {!data.historyEnabled ? (
        <Callout className="mt-5">
          {data.historyReason ??
            "History is disabled. Enable it explicitly to retain observations with a bounded retention period."}
        </Callout>
      ) : events.length === 0 ? (
        <p className="text-muted mt-5 text-sm">No events recorded yet.</p>
      ) : (
        <ol className="mt-5 space-y-4">
          {events.map((event) => (
            <li
              key={event.id}
              className="border-line flex gap-3 border-b pb-4 text-sm last:border-b-0"
            >
              <Clock className="text-muted mt-1 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {event.kind === "action"
                    ? event.payload.intent
                      ? String(event.payload.intent)
                      : "Relay selection"
                    : String(event.payload.name ?? event.entityId)}
                </p>
                {event.kind === "action" && Boolean(event.payload.intent) && (
                  <p className="mt-1 break-all">{operationTarget(event, data.snapshot.nodes)}</p>
                )}
                <p className="text-muted mt-1">
                  {event.kind === "action"
                    ? `${event.payload.intent ? String(event.payload.path ?? event.entityId) : `Region ${String(event.payload.region ?? "unknown")}`} · ${String(event.payload.outcome ?? "recorded")} · actor ${String(event.payload.actor ?? "unknown")}`
                    : `${event.payload.online === true ? "Online" : event.payload.online === false ? "Offline" : "State recorded"} · Home relay ${String(event.payload.homeRegion ?? "not reported")}`}
                </p>
              </div>
              <time
                className="text-muted shrink-0 text-xs"
                dateTime={new Date(event.observedAt).toISOString()}
              >
                {new Date(event.observedAt)
                  .toISOString()
                  .replace("T", " ")
                  .replace(/\.\d{3}Z$/, " UTC")}
              </time>
            </li>
          ))}
        </ol>
      )}
      <p className="text-muted mt-4 text-xs">
        Showing recent retained records. Historical data starts when recording is enabled.
      </p>
    </section>
  );
}

function operationTarget(event: Data["history"][number], nodes: NetworkNode[]) {
  const target =
    typeof event.payload.target === "string"
      ? event.payload.target
      : event.entityId !== event.payload.path
        ? event.entityId
        : null;
  if (!target) return null;
  const path = String(event.payload.path ?? "");
  if (/\/machines(?:\/|$)/.test(path)) {
    const name = nodes.find((node) => node.id === target)?.name;
    return name ? `${name} (Device ${target})` : `Device ${target}`;
  }
  return `${/\/users(?:\/|$)/.test(path) ? "User" : "Target"} ${target}`;
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="border-line rounded-lg border p-4">
      <p className="text-muted text-xs font-medium">{label}</p>
      <p className="my-2 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted text-xs">{note}</p>
    </div>
  );
}
function Dot({ online }: { online: boolean }) {
  return (
    <span
      aria-label={online ? "Online" : "Offline"}
      className={cn("mr-2 inline-block size-2 rounded-full", online ? "bg-ok" : "bg-muted")}
    />
  );
}
function bool(value: boolean | null) {
  return value === null ? "Unknown" : value ? "Yes" : "No";
}
export function time(value: number | null) {
  return value === null ? "Not available" : `${new Date(value).toISOString().slice(11, 19)} UTC`;
}
function bytes(value: number | null) {
  if (value === null) return "Unknown";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}
function rate(value: number | null) {
  if (value !== null && value > 0 && value < 1) return `${Number(value.toPrecision(3))} B/s`;
  return value === null ? "Unknown" : `${bytes(value)}/s`;
}
