import { useFetcher } from "react-router";

import Button from "~/components/button";
import Callout from "~/components/callout";
import Link from "~/components/link";
import PageError from "~/components/page-error";
import PageHeader from "~/components/page-header";
import Section, { Row, RowList, SettingList, SettingRow } from "~/components/section";
import StatusCircle from "~/components/status-circle";
import { settingsErrorKeys } from "~/i18n/messages/settings";
import { Trans, useI18n } from "~/i18n/react";
import {
  agentsContext,
  authContext,
  headscaleContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { nodesResource } from "~/server/headscale/live-store";
import { Capabilities } from "~/server/web/roles";
import { getTSVersion } from "~/utils/host-info";
import { formatTimeDelta } from "~/utils/time";

import type { Route } from "./+types/agent";

export async function loader({ request, context }: Route.LoaderArgs) {
  const agents = context.get(agentsContext);
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);
  const headscale = context.get(headscaleContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  await auth.requireCapability(request, Capabilities.read_machines);

  if (agents.state !== "enabled") {
    return { enabled: false as const, reason: agents.reason };
  }

  // The sync status matters most when Headscale is down, so the page still
  // loads without the machine list.
  const { api } = await getRequestApi(request);
  const [isHealthy, fetched] = await Promise.all([
    headscale.health(),
    headscaleLiveStore
      .get(nodesResource, api)
      .then((snap) => snap.data)
      .catch(() => undefined),
  ]);
  const nodes = fetched ?? [];
  const sync = agents.value.lastSync();
  const selfKey = agents.value.agentNodeKey();
  const self = nodes.find((node) => node.nodeKey === selfKey);
  const others = nodes.filter((node) => node.nodeKey !== selfKey);

  const [selfInfo, updatedAt] = await Promise.all([
    agents.value.lookup(selfKey ? [selfKey] : []),
    agents.value.lastUpdated(others.map((node) => node.nodeKey)),
  ]);

  const synced = new Set(sync.syncedKeys);
  const missing = others
    .filter((node) => !synced.has(node.nodeKey))
    .map((node) => ({
      id: node.id,
      name: node.givenName,
      isOnline: node.online,
      updatedAt: updatedAt[node.nodeKey]?.toISOString() ?? null,
    }));

  return {
    enabled: true as const,
    // The layout already shows a banner when Headscale is down.
    isHeadscaleDown: !isHealthy,
    hasMachines: fetched !== undefined,
    syncedAt: sync.syncedAt?.toISOString() ?? null,
    startedAt: sync.startedAt?.toISOString() ?? null,
    intervalMs: sync.intervalMs,
    consecutiveErrors: sync.consecutiveErrors,
    error: sync.error,
    authUrl: sync.authUrl,
    self: self
      ? {
          id: self.id,
          name: self.givenName,
          isOnline: self.online,
          addresses: self.ipAddresses,
          version: selfKey && selfInfo[selfKey] ? getTSVersion(selfInfo[selfKey]) : undefined,
        }
      : undefined,
    machineCount: others.length,
    missing,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const agents = context.get(agentsContext);
  const auth = context.get(authContext);

  await auth.requireCapability(request, Capabilities.read_machines);

  if (agents.state !== "enabled") {
    return { success: false, error: agents.reason };
  }

  await agents.value.triggerSync();
  const sync = agents.value.lastSync();
  return {
    success: !sync.error,
    error: sync.error,
    authUrl: sync.authUrl,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, locale } = useI18n();
  const fetcher = useFetcher<typeof action>();
  const description = (
    <Trans
      id="settings.agent.description"
      values={{
        docs: (
          <Link external styled to="https://headplane.net/features/agent">
            {t("settings.docs")}
          </Link>
        ),
      }}
    />
  );

  if (!loaderData.enabled) {
    return (
      <>
        <PageHeader description={description} isSubpage title={t("settings.agent")} />
        <Callout title={t("settings.agent.off")}>
          {t("settings.agent.offReason", {
            reason: settingsErrorKeys[loaderData.reason]
              ? t(settingsErrorKeys[loaderData.reason])
              : loaderData.reason,
          })}
        </Callout>
      </>
    );
  }

  const { self, missing, machineCount, isHeadscaleDown, hasMachines } = loaderData;
  const unavailable = (
    <p className="text-muted py-2.5 text-sm">{t("settings.agent.unavailable")}</p>
  );
  const isPending = !loaderData.syncedAt && Boolean(loaderData.authUrl);
  const hasError = Boolean(loaderData.error);
  const intervalMinutes = Math.max(1, Math.round(loaderData.intervalMs / 60_000));

  return (
    <>
      <PageHeader
        actions={
          <fetcher.Form method="post">
            <Button pending={fetcher.state !== "idle"} type="submit">
              {t("settings.agent.syncNow")}
            </Button>
          </fetcher.Form>
        }
        description={description}
        isSubpage
        title={t("settings.agent")}
      />
      {isPending && loaderData.authUrl && (
        <Callout className="mb-6" title={t("settings.agent.pending")} variant="warning">
          <Trans
            id="settings.agent.approval"
            values={{
              link: (
                <Link external styled to={loaderData.authUrl}>
                  {t("settings.agent.approveHere")}
                </Link>
              ),
            }}
          />
        </Callout>
      )}
      {loaderData.error && !isHeadscaleDown && (
        <Callout className="mb-6" title={t("settings.agent.syncFailed")} variant="error">
          {loaderData.error}
        </Callout>
      )}
      <Section title={t("settings.agent.sync")}>
        <SettingList>
          <SettingRow label={t("settings.status")}>
            <span className="flex items-center gap-2">
              <StatusCircle isExpired={hasError} isOnline={!hasError && !isPending} />
              {hasError
                ? t(
                    loaderData.consecutiveErrors === 1
                      ? "settings.agent.failingOne"
                      : "settings.agent.failingOther",
                    { count: loaderData.consecutiveErrors.toLocaleString(locale) },
                  )
                : t(isPending ? "settings.agent.pending" : "settings.agent.healthy")}
            </span>
          </SettingRow>
          <SettingRow label={t("settings.agent.lastSynced")}>
            {loaderData.syncedAt ? (
              <span
                suppressHydrationWarning
                title={new Date(loaderData.syncedAt).toLocaleString(locale)}
              >
                {formatTimeDelta(new Date(loaderData.syncedAt), locale)}
              </span>
            ) : (
              <span className="text-muted">{t("settings.agent.never")}</span>
            )}
            <span className="text-muted">
              {t(
                intervalMinutes === 1
                  ? "settings.agent.everyMinute"
                  : "settings.agent.everyMinutes",
                { count: intervalMinutes.toLocaleString(locale) },
              )}
            </span>
          </SettingRow>
          <SettingRow label={t("settings.agent.process")}>
            {loaderData.startedAt ? (
              <span
                suppressHydrationWarning
                title={new Date(loaderData.startedAt).toLocaleString(locale)}
              >
                {t("settings.agent.started", {
                  time: formatTimeDelta(new Date(loaderData.startedAt), locale),
                })}
              </span>
            ) : (
              <span className="text-muted">{t("settings.agent.notRunning")}</span>
            )}
          </SettingRow>
        </SettingList>
      </Section>
      <Section
        description={t("settings.agent.machineDescription")}
        title={t("settings.agent.machineTitle")}
      >
        {!hasMachines ? (
          unavailable
        ) : self ? (
          <SettingList>
            <SettingRow label={t("settings.agent.machine")}>
              <span className="flex items-center gap-2">
                <StatusCircle isOnline={self.isOnline} />
                <Link styled to={`/machines/${self.id}`}>
                  {self.name}
                </Link>
              </span>
            </SettingRow>
            <SettingRow label={t("settings.agent.address")}>
              <span className="font-mono text-xs">
                {self.addresses[0] ?? t("settings.agent.none")}
              </span>
            </SettingRow>
            <SettingRow label={t("settings.agent.version")}>
              <span className="font-mono text-xs">
                {self.version ?? t("settings.agent.unknown")}
              </span>
            </SettingRow>
          </SettingList>
        ) : (
          <p className="text-muted py-2.5 text-sm">{t("settings.agent.notJoined")}</p>
        )}
      </Section>
      <Section
        description={t("settings.agent.coverageDescription")}
        title={t("settings.agent.coverage")}
      >
        {!hasMachines ? (
          unavailable
        ) : (
          <p className="py-2.5 text-sm">
            {t(machineCount === 1 ? "settings.agent.coverageOne" : "settings.agent.coverageOther", {
              synced: (machineCount - missing.length).toLocaleString(locale),
              count: machineCount.toLocaleString(locale),
            })}
          </p>
        )}
        {missing.length > 0 && (
          <RowList>
            {missing.map((node) => (
              <Row
                action={
                  <span className="text-muted text-sm whitespace-nowrap" suppressHydrationWarning>
                    {node.updatedAt
                      ? t("settings.agent.detailsFrom", {
                          time: formatTimeDelta(new Date(node.updatedAt), locale),
                        })
                      : t("settings.agent.noDetails")}
                  </span>
                }
                key={node.id}
              >
                <span className="flex items-center gap-2 text-sm">
                  <StatusCircle isOnline={node.isOnline} />
                  <Link styled to={`/machines/${node.id}`}>
                    {node.name}
                  </Link>
                </span>
              </Row>
            ))}
          </RowList>
        )}
      </Section>
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useI18n();
  return <PageError error={error} page={t("settings.agent.errorPage")} />;
}
