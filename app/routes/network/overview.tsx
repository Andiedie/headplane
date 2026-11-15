import { Activity, Globe, RefreshCw, Server } from "lucide-react";
import { useEffect } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import * as v from "valibot";

import Button from "~/components/button";
import Callout from "~/components/callout";
import PageError from "~/components/page-error";
import PageHeader from "~/components/page-header";
import { useI18n } from "~/i18n/react";
import { appConfigContext, authContext, networkContext, requestApiContext } from "~/server/context";
import { ActionError, createAction } from "~/server/web/actions";
import { isUserPrincipal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";
import cn from "~/utils/cn";
import { ok } from "~/utils/form";

import type { Route } from "./+types/overview";
import { History, networkMessage, Overview, Relays, time } from "./panels";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const principal = await auth.requireCapability(request, Capabilities.read_network);
  const { api } = await context.get(requestApiContext)(request);
  return {
    ...(await context.get(networkContext).read(api)),
    canSelectRelay: auth.can(principal, Capabilities.write_network),
  };
}

export const action = createAction({
  audit: false, // Relay selections retain their region-specific result.
  capability: Capabilities.write_network,
  async setup({ request, context }) {
    const principal = await context.get(authContext).require(request);
    const origin = request.headers.get("Origin");
    // TLS may terminate before this server. Only configured URLs are trusted;
    // arbitrary forwarded headers must not authorize cross-origin writes.
    const requestUrl = new URL(request.url);
    const publicUrl = new URL(context.get(appConfigContext).server.base_url ?? request.url);
    // The HTTP runtime aligns same-host Origin schemes with its local transport.
    const matchesAlignedOrigin = requestUrl.host === publicUrl.host && origin === requestUrl.origin;
    if (origin && origin !== publicUrl.origin && !matchesAlignedOrigin) {
      throw new ActionError("The request must originate from this dashboard.", 403);
    }
    return { principal, network: context.get(networkContext) };
  },
  intents: {
    "select-relay": {
      fields: {
        region: v.pipe(
          v.string(),
          v.regex(/^[1-9]\d{0,9}$/),
          v.transform(Number),
          v.maxValue(2_147_483_647),
        ),
        revision: v.pipe(v.string(), v.nonEmpty()),
      },
      async handler({ region, revision }, { principal, network }) {
        const actor = isUserPrincipal(principal) ? principal.user.id : "api-key-session";
        const result = await network.select(region, revision, actor);
        if (!result.ok) throw new ActionError(result.error.message);
        return ok(
          "Selection saved. Waiting for Headscale's scheduled map refresh; clients may reconnect.",
        );
      },
    },
  },
});

const views = [
  { id: "overview", label: "network.page.overview", icon: Globe },
  { id: "relays", label: "network.page.relays", icon: Server },
  { id: "activity", label: "network.page.activity", icon: Activity },
] as const;

export default function NetworkPage({ loaderData: data }: Route.ComponentProps) {
  const { locale, t } = useI18n();
  const [search, setSearch] = useSearchParams();
  const view = views.find((item) => item.id === search.get("view"))?.id ?? "overview";
  const revalidator = useRevalidator();
  const { revalidate } = revalidator;
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void revalidate();
      },
      Math.max(5000, data.pollInterval),
    );
    return () => clearInterval(timer);
  }, [data.pollInterval, revalidate]);

  return (
    <>
      <PageHeader
        title={t("network.page.title")}
        description={t("network.page.description")}
        actions={
          <Button onClick={() => void revalidate()} pending={revalidator.state !== "idle"}>
            <RefreshCw className="size-3.5" />
            {t("network.page.refresh")}
          </Button>
        }
      />
      <div className="border-line mb-6 flex flex-wrap items-center gap-1 border-b">
        {views.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={view === id ? "page" : undefined}
            className={cn(
              "focus-ring flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium",
              view === id ? "border-accent text-fg" : "text-muted border-transparent hover:text-fg",
            )}
            onClick={() => setSearch(id === "overview" ? {} : { view: id })}
          >
            <Icon className="size-4" />
            {t(label)}
          </button>
        ))}
        <span className="text-muted ml-auto py-3 text-xs">
          {t("network.page.refreshed", { time: time(data.observedAt, locale) })}
        </span>
      </div>
      {data.collectionError && (
        <Callout className="mb-4" variant="warning">
          {networkMessage(data.collectionError, locale)}
        </Callout>
      )}
      {view === "overview" && <Overview data={data} />}
      {view === "relays" && <Relays data={data} />}
      {view === "activity" && <History data={data} />}
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useI18n();
  return <PageError error={error} page={t("network.page.title")} />;
}
