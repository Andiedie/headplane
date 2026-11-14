import { ArrowRight, Clock, Server } from "lucide-react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Callout from "~/components/callout";
import Link from "~/components/link";
import { type Locale, translate } from "~/i18n";
import { en } from "~/i18n/messages/network";
import { Trans, useI18n } from "~/i18n/react";
import cn from "~/utils/cn";

import type { action, loader } from "./overview";

type Data = Awaited<ReturnType<typeof loader>>;
type NetworkNode = Data["snapshot"]["nodes"][number];

export function Overview({ data }: { data: Data }) {
  const { locale, t } = useI18n();
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
        <Stat
          label={t("network.overview.devices")}
          value={nodes.length}
          note={t("network.overview.connected", { count: online.toLocaleString(locale) })}
        />
        <Stat
          label={t("network.state.offline")}
          value={nodes.length - online}
          note={t("network.overview.connectionStatus")}
        />
        <Stat
          label={t("network.overview.pendingRoutes")}
          value={pending}
          note={t("network.overview.awaitingApproval")}
        />
        <Stat
          label={t("network.overview.expiringSoon")}
          value={expiring}
          note={t("network.overview.nextWeek")}
        />
      </div>
      {!data.agent.enabled && <Callout>{t("network.overview.enableAgent")}</Callout>}
      {data.agent.enabled && (
        <p className="text-muted text-xs">
          {t("network.overview.agentSynced", { time: time(data.agent.syncedAt, locale) })}
          {data.agent.error ? t("network.overview.agentError") : ""}
        </p>
      )}
      <section
        className="border-line rounded-lg border p-5"
        aria-label={t("network.overview.relationshipsLabel")}
      >
        <div className="mb-5">
          <h2 className="font-semibold">{t("network.overview.homeRelays")}</h2>
          <p className="text-muted mt-1 text-sm">
            {t("network.overview.relationshipsDescription")}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...groups].map(([id, members]) => (
            <div key={id} className="border-line bg-subtle rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Server className="text-accent size-4" />
                  {id === "unknown"
                    ? t("network.state.notReported")
                    : regionName(
                        members[0].homeRegion!,
                        members[0].homeName,
                        data.relay.regions,
                        locale,
                      )}
                </span>
                <span className="text-muted text-xs">
                  {t("network.overview.deviceCount", {
                    count: members.length.toLocaleString(locale),
                  })}
                </span>
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
                        {t("network.overview.approved", { routes: node.approvedRoutes.join(", ") })}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {nodes.length === 0 && (
            <p className="text-muted text-sm">{t("network.overview.noDevices")}</p>
          )}
        </div>
      </section>
      <section className="border-line overflow-hidden rounded-lg border">
        <div className="border-line border-b p-5">
          <h2 className="font-semibold">{t("network.overview.details")}</h2>
          <p className="text-muted mt-1 text-sm">{t("network.overview.detailsDescription")}</p>
        </div>
        {nodes.map((node) => (
          <Device key={node.id} node={node} regions={data.relay.regions} />
        ))}
      </section>
    </div>
  );
}

function Device({ node, regions }: { node: NetworkNode; regions: Data["relay"]["regions"] }) {
  const { locale, t } = useI18n();
  return (
    <details className="border-line border-b last:border-b-0">
      <summary className="focus-ring hover:bg-hover grid cursor-pointer gap-2 px-5 py-4 text-sm sm:grid-cols-3">
        <span className="font-medium">
          <Dot online={node.online} />
          {node.name}
          {node.expired && (
            <span className="text-warn ml-2 text-xs">{t("network.state.expired")}</span>
          )}
        </span>
        <span className="text-muted">
          {node.homeRegion === null
            ? t("network.device.homeNotReported")
            : regionName(node.homeRegion, node.homeName, regions, locale)}
        </span>
        <span className="text-muted sm:text-right">
          {t("network.device.protocols", {
            udp: bool(node.udp, locale),
            ipv6: bool(node.ipv6, locale),
          })}
        </span>
      </summary>
      <div className="bg-subtle grid gap-6 px-5 pt-3 pb-5 text-sm md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-muted">
            <Trans
              id="network.device.client"
              values={{
                value: (
                  <span className="text-fg">
                    {[node.os, node.version].filter(Boolean).join(" · ") ||
                      t("network.state.notReported")}
                  </span>
                ),
              }}
            />
          </p>
          <p className="text-muted">
            <Trans
              id="network.device.addresses"
              values={{ value: <span className="text-fg">{node.ipAddresses.join(", ")}</span> }}
            />
          </p>
          <p className="text-muted">
            <Trans
              id="network.device.nat"
              values={{ value: <span className="text-fg">{bool(node.natVaries, locale)}</span> }}
            />
          </p>
          <p className="text-muted break-all">
            <Trans
              id="network.device.endpoints"
              values={{
                value: (
                  <span className="text-fg">
                    {node.endpoints.join(", ") || t("network.state.notReported")}
                  </span>
                ),
              }}
            />
          </p>
          <p className="text-muted break-all">
            <Trans
              id="network.device.approved"
              values={{
                value: (
                  <span className="text-fg">
                    {node.approvedRoutes.join(", ") || t("network.state.none")}
                  </span>
                ),
              }}
            />
          </p>
          <p className="text-muted break-all">
            <Trans
              id="network.device.pending"
              values={{
                value: (
                  <span className="text-fg">
                    {node.pendingRoutes.join(", ") || t("network.state.none")}
                  </span>
                ),
              }}
            />
          </p>
          <Link styled to={`/machines/${node.id}`}>
            {t("network.device.manage")} <ArrowRight className="inline size-3" />
          </Link>
        </div>
        <div>
          <h3 className="mb-2 font-medium">{t("network.device.latency")}</h3>
          {node.latencies.length === 0 ? (
            <p className="text-muted">{t("network.device.noMeasurements")}</p>
          ) : (
            <ul className="space-y-1">
              {node.latencies.map((latency) => (
                <li
                  className="flex justify-between gap-3"
                  key={`${latency.regionId}-${latency.family}`}
                >
                  <span>
                    {regionName(latency.regionId, latency.regionName, regions, locale)}{" "}
                    <span className="text-muted">{latency.family}</span>
                  </span>
                  <span className="font-mono">
                    {t("network.device.latencyValue", {
                      value: latency.milliseconds.toLocaleString(locale, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      }),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted mt-3 text-xs">{t("network.device.latencyDescription")}</p>
        </div>
      </div>
    </details>
  );
}

export function Relays({ data }: { data: Data }) {
  const { locale, t } = useI18n();
  const fetcher = useFetcher<typeof action>();
  const selected = data.relay.selectedRegionId;
  const matched = data.snapshot.nodes.filter((n) => n.online && n.homeRegion === selected).length;
  const known = data.snapshot.nodes.filter((n) => n.online && n.homeRegion !== null).length;
  const result = fetcher.data;
  return (
    <div className="space-y-6">
      <section className="border-line rounded-lg border p-5">
        <h2 className="font-semibold">{t("network.relay.title")}</h2>
        <p className="text-muted mt-1 text-sm">{t("network.relay.description")}</p>
        {data.relay.reason && (
          <Callout className="mt-4">{networkMessage(data.relay.reason, locale)}</Callout>
        )}
        {result && (
          <div role="status" className="mt-4">
            <Callout variant={result.ok ? undefined : "error"}>
              {result.ok
                ? networkMessage(result.message ?? "", locale)
                : Object.entries(result.errors)
                    .map(([field, message]) =>
                      field === "region"
                        ? t("network.error.invalidRegion")
                        : field === "revision"
                          ? t("network.error.conflict")
                          : networkMessage(message, locale),
                    )
                    .join(" ")}
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
            <legend className="sr-only">{t("network.relay.choose")}</legend>
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
                      {t("network.relay.region", { code: region.code, id: region.id })}
                    </span>
                  </span>
                  {selected === region.id && (
                    <span className="text-accent ml-auto text-xs">{t("network.relay.saved")}</span>
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
              {t(fetcher.state === "idle" ? "network.relay.save" : "network.relay.saving")}
            </Button>
          </fieldset>
        </fetcher.Form>
        {!data.canSelectRelay && (
          <p className="text-muted mt-3 text-sm">{t("network.relay.readOnly")}</p>
        )}
        <div className="border-line mt-5 grid gap-4 border-t pt-5 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted text-xs">{t("network.relay.configuration")}</p>
            <p className="mt-1">
              {selected === null
                ? t("network.relay.noSingleSelection")
                : t("network.relay.selected", { id: selected })}
            </p>
          </div>
          <div>
            <p className="text-muted text-xs">{t("network.relay.loadStatus")}</p>
            <p className="mt-1">{t("network.relay.notObservable")}</p>
            <p className="text-muted mt-1 text-xs">
              {data.relay.refreshInterval
                ? t("network.relay.refreshInterval", { interval: data.relay.refreshInterval })
                : t("network.relay.refreshUnavailable")}
            </p>
          </div>
          <div>
            <p className="text-muted text-xs">{t("network.relay.reportedHome")}</p>
            <p className="mt-1">
              {selected === null
                ? t("network.relay.noComparison")
                : t("network.relay.matches", {
                    matched: matched.toLocaleString(locale),
                    known: known.toLocaleString(locale),
                  })}
            </p>
            <p className="text-muted mt-1 text-xs">{t("network.relay.matchDisclaimer")}</p>
          </div>
        </div>
      </section>
      <section className="border-line rounded-lg border p-5">
        <h2 className="font-semibold">{t("network.traffic.title")}</h2>
        <p className="text-muted mt-1 text-sm">{t("network.traffic.description")}</p>
        {data.metrics.length === 0 ? (
          <p className="text-muted mt-5 text-sm">{t("network.traffic.noSources")}</p>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {data.metrics.map((metric) => (
              <div key={metric.id} className="border-line rounded-lg border p-4">
                <h3 className="font-medium">{metric.name}</h3>
                {metric.error ? (
                  <p className="text-warn mt-2 text-sm">{networkMessage(metric.error, locale)}</p>
                ) : (
                  <>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-muted text-xs">{t("network.traffic.connections")}</p>
                        {metric.connections?.toLocaleString(locale) ?? t("network.state.unknown")}
                      </div>
                      <div>
                        <p className="text-muted text-xs">{t("network.traffic.received")}</p>
                        {bytes(metric.receivedBytes, locale)}
                      </div>
                      <div>
                        <p className="text-muted text-xs">{t("network.traffic.sent")}</p>
                        {bytes(metric.sentBytes, locale)}
                      </div>
                    </div>
                    <p className="text-muted mt-3 text-xs">
                      {t("network.traffic.rates", {
                        receive: rate(metric.rxBytesPerSecond, locale),
                        send: rate(metric.txBytesPerSecond, locale),
                      })}
                    </p>
                  </>
                )}
                <p className="text-muted mt-2 text-xs">
                  {t("network.traffic.observed", { time: time(metric.observedAt, locale) })}
                </p>
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
  const { locale, t } = useI18n();
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
    return <p className="text-muted mt-3 text-xs">{t("network.traffic.waiting")}</p>;
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
        aria-label={t("network.traffic.chartLabel", {
          start: time(samples[0].at, locale),
          end: time(samples[samples.length - 1].at, locale),
        })}
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
        {t("network.traffic.peak", { rate: rate(peak, locale) })}
      </figcaption>
    </figure>
  );
}

export function History({ data }: { data: Data }) {
  const { locale, t } = useI18n();
  const events = data.history.filter((record) => record.kind !== "relay");
  return (
    <section className="border-line rounded-lg border p-5">
      <h2 className="font-semibold">{t("network.history.title")}</h2>
      <p className="text-muted mt-1 text-sm">{t("network.history.description")}</p>
      {!data.historyEnabled ? (
        <Callout className="mt-5">
          {data.historyReason
            ? networkMessage(data.historyReason, locale)
            : t("network.history.disabled")}
        </Callout>
      ) : events.length === 0 ? (
        <p className="text-muted mt-5 text-sm">{t("network.history.empty")}</p>
      ) : (
        <ol className="mt-5 space-y-4">
          {events.map((event) => (
            <li
              key={event.id}
              className="border-line flex gap-3 border-b pb-4 text-sm last:border-b-0"
            >
              <Clock className="text-muted mt-1 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p
                  className="font-medium"
                  title={
                    event.kind === "action" && event.payload.intent
                      ? String(event.payload.intent)
                      : undefined
                  }
                >
                  {event.kind === "action"
                    ? event.payload.intent
                      ? operationIntent(String(event.payload.intent), locale)
                      : t("network.relay.title")
                    : String(event.payload.name ?? event.entityId)}
                </p>
                {event.kind === "action" && Boolean(event.payload.intent) && (
                  <p className="mt-1 break-all">
                    {operationTarget(event, data.snapshot.nodes, locale)}
                  </p>
                )}
                <p className="text-muted mt-1">
                  {event.kind === "action"
                    ? t("network.history.action", {
                        target: event.payload.intent
                          ? String(event.payload.path ?? event.entityId)
                          : t("network.state.region", {
                              id: String(event.payload.region ?? t("network.history.unknown")),
                            }),
                        outcome: operationOutcome(event.payload.outcome, locale),
                        actor: String(event.payload.actor ?? t("network.history.unknown")),
                      })
                    : t("network.history.node", {
                        state: t(
                          event.payload.online === true
                            ? "network.state.online"
                            : event.payload.online === false
                              ? "network.state.offline"
                              : "network.state.recorded",
                        ),
                        region: String(
                          event.payload.homeRegion ?? t("network.history.notReported"),
                        ),
                      })}
                </p>
              </div>
              <time
                className="text-muted shrink-0 text-xs"
                dateTime={new Date(event.observedAt).toISOString()}
              >
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "long",
                  timeZone: "UTC",
                }).format(event.observedAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
      <p className="text-muted mt-4 text-xs">{t("network.history.retention")}</p>
    </section>
  );
}

function operationTarget(event: Data["history"][number], nodes: NetworkNode[], locale: Locale) {
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
    return name
      ? translate(locale, "network.history.namedDevice", { name, id: target })
      : translate(locale, "network.history.device", { id: target });
  }
  return translate(
    locale,
    /\/users(?:\/|$)/.test(path) ? "network.history.user" : "network.history.target",
    { id: target },
  );
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  const { locale } = useI18n();
  return (
    <div className="border-line rounded-lg border p-4">
      <p className="text-muted text-xs font-medium">{label}</p>
      <p className="my-2 text-3xl font-semibold tabular-nums">{value.toLocaleString(locale)}</p>
      <p className="text-muted text-xs">{note}</p>
    </div>
  );
}
function Dot({ online }: { online: boolean }) {
  const { t } = useI18n();
  return (
    <span
      aria-label={t(online ? "network.state.online" : "network.state.offline")}
      className={cn("mr-2 inline-block size-2 rounded-full", online ? "bg-ok" : "bg-muted")}
    />
  );
}
function bool(value: boolean | null, locale: Locale) {
  return translate(
    locale,
    value === null ? "network.state.unknown" : value ? "network.state.yes" : "network.state.no",
  );
}
export function time(value: number | null, locale: Locale = "en") {
  return value === null
    ? translate(locale, "network.state.notAvailable")
    : `${new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: "UTC",
      }).format(value)} UTC`;
}
function bytes(value: number | null, locale: Locale) {
  if (value === null) return translate(locale, "network.state.unknown");
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toLocaleString(locale, { minimumFractionDigits: index ? 1 : 0, maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}
function rate(value: number | null, locale: Locale) {
  if (value !== null && value > 0 && value < 1)
    return `${value.toLocaleString(locale, { maximumSignificantDigits: 3 })} B/s`;
  return value === null ? translate(locale, "network.state.unknown") : `${bytes(value, locale)}/s`;
}

function regionName(id: number, name: string, regions: Data["relay"]["regions"], locale: Locale) {
  // Only localize synthesized fallback names; catalog names are operator data.
  return name !== `Region ${id}` || regions.some((region) => region.id === id)
    ? name
    : translate(locale, "network.state.region", { id });
}

function operationIntent(intent: string, locale: Locale) {
  const key = `network.history.intent.${intent}`;
  return Object.hasOwn(en, key) ? translate(locale, key as keyof typeof en) : intent;
}

function operationOutcome(value: unknown, locale: Locale) {
  const outcome = String(value ?? "recorded");
  switch (outcome) {
    case "saved":
      return translate(locale, "network.history.saved");
    case "success":
      return translate(locale, "network.history.success");
    case "failed":
      return translate(locale, "network.history.failed");
    case "recorded":
      return translate(locale, "network.history.recorded");
    default:
      return outcome;
  }
}

// Server diagnostics keep their existing wire values. Recognize only owned,
// exact messages (or bounded templates); leave unknown diagnostics verbatim.
const diagnosticKeys = new Map<string, keyof typeof en>(
  (Object.keys(en) as (keyof typeof en)[])
    .filter(
      (key) =>
        (key.startsWith("network.error.") || key === "network.relay.saveSuccess") &&
        !en[key].includes("{"),
    )
    .map((key) => [en[key], key]),
);

export function networkMessage(message: string, locale: Locale): string {
  const key = diagnosticKeys.get(message);
  if (key) return translate(locale, key);
  const http = /^Metrics endpoint returned HTTP ([1-5]\d{2})\.$/.exec(message);
  if (http) return translate(locale, "network.error.metricsHttp", { status: http[1] });
  const files = [
    ["relay catalog", "network.file.catalog"],
    ["selected relay map", "network.file.selectedMap"],
    ["Headscale configuration", "network.file.headscale"],
  ] as const;
  for (const [file, fileKey] of files) {
    for (const template of [
      "network.error.invalidMap",
      "network.error.fileSize",
      "network.error.readFile",
    ] as const) {
      if (message === en[template].replace("{file}", file)) {
        return translate(locale, template, { file: translate(locale, fileKey) });
      }
    }
  }
  return message;
}
