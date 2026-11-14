import { Construction, Eye, FileX, FlaskConical, Pencil, Shield, TagsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Suspense, lazy, useMemo, useState } from "react";
import { isRouteErrorResponse, useFetcher } from "react-router";

import Button from "~/components/button";
import Callout from "~/components/callout";
import Code from "~/components/code";
import Link from "~/components/link";
import PageError, { ErrorState } from "~/components/page-error";
import PageHeader from "~/components/page-header";
import { Tabs, TabsList, TabsPanel, TabsTab } from "~/components/tabs";
import { Trans, useI18n } from "~/i18n/react";
import { isApiError } from "~/server/headscale/api/error-client";
import {
  parsePolicy,
  policyDestinations,
  policySources,
  serializePolicy,
  type Policy,
} from "~/utils/acl-policy";
import type { ActionResult } from "~/utils/form";
import { toastClientAction } from "~/utils/toast";

import type { Route } from "./+types/overview";
import { aclAction } from "./acl-action";
import { aclLoader } from "./acl-loader";
import Fallback from "./components/fallback";
import { usePolicyDiagnostic } from "./components/policy-diagnostics";
import RulesEditor from "./components/rules-editor";
import TagsGroupsEditor from "./components/tags-groups-editor";

const LazyEditor = lazy(() =>
  import("./components/cm.client").then((m) => ({ default: m.Editor })),
);
const LazyDiffer = lazy(() =>
  import("./components/cm.client").then((m) => ({ default: m.Differ })),
);

export const loader = aclLoader;
export const action = aclAction;
export const clientAction = toastClientAction;

export default function Page({
  loaderData: { access, writable, canEditGrants, policy, users, tagUsage },
}: Route.ComponentProps) {
  const { t } = useI18n();
  const diagnostic = usePolicyDiagnostic();
  const [codePolicy, setCodePolicy] = useState(policy);
  const [savedPolicy, setSavedPolicy] = useState(policy);
  if (savedPolicy !== policy) {
    setSavedPolicy(policy);
    setCodePolicy(policy);
  }

  const fetcher = useFetcher<ActionResult>();
  const disabled = !access || !writable; // Disable if no permission or not writable

  const parsed = useMemo(() => parsePolicy(codePolicy), [codePolicy]);
  const sources = useMemo(
    () => (parsed.ok ? policySources(parsed.policy, users) : []),
    [parsed, users],
  );
  const destinations = useMemo(
    () => (parsed.ok ? policyDestinations(parsed.policy, users) : []),
    [parsed, users],
  );

  // The structured editors round-trip through the policy text, so the file
  // editor, the diff view and Save all work off one source of truth.
  function applyPolicy(next: Policy) {
    setCodePolicy(serializePolicy(next));
  }

  function structuredPanel(render: (value: Policy) => ReactNode) {
    if (!parsed.ok) {
      return (
        <div className="p-4">
          <Callout className="my-4 max-w-2xl" title={t("policy.visual.parseTitle")} variant="error">
            <Trans
              id="policy.visual.parseDescription"
              values={{
                error: diagnostic(parsed.error),
                editFile: <Code>{t("policy.tabs.editFile")}</Code>,
              }}
            />
          </Callout>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4 p-4">
        {parsed.hasComments ? (
          <Callout
            className="my-4 max-w-2xl"
            title={t("policy.visual.commentsTitle")}
            variant="warning"
          >
            {t("policy.visual.commentsDescription")}
          </Callout>
        ) : null}
        {render(parsed.policy)}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        description={
          <Trans
            id="policy.description"
            values={{
              guide: (
                <Link external styled to="https://tailscale.com/kb/1018/acls">
                  {t("policy.aclGuide")}
                </Link>
              ),
              docs: (
                <Link external styled to="https://headscale.net/stable/ref/acls/">
                  {t("policy.headscaleDocs")}
                </Link>
              ),
            }}
          />
        }
        title={t("policy.title")}
      />
      {!access ? (
        <Callout className="my-4 max-w-2xl" title={t("policy.restricted.title")} variant="warning">
          {t("policy.restricted.description")}
        </Callout>
      ) : !writable ? (
        <Callout className="my-4 max-w-2xl" title={t("policy.readOnly.title")} variant="error">
          <Trans
            id="policy.readOnly.description"
            values={{
              file: <Code>file</Code>,
              mode: <Code>policy.mode</Code>,
              database: <Code>database</Code>,
            }}
          />
        </Callout>
      ) : undefined}
      {fetcher.data?.ok === false && (
        <Callout className="my-4 max-w-2xl" title={t("policy.saveError")} variant="error">
          {fetcher.data.errors.form ?? fetcher.data.errors.policy}
        </Callout>
      )}
      <Tabs className="mb-4" label={t("policy.editor.label")} defaultValue="rules">
        <TabsList>
          <TabsTab value="rules">
            <div className="flex items-center gap-2">
              <Shield className="p-1" />
              <span>{t("policy.tabs.rules")}</span>
            </div>
          </TabsTab>
          <TabsTab value="tags">
            <div className="flex items-center gap-2">
              <TagsIcon className="p-1" />
              <span>{t("policy.tabs.tagsGroups")}</span>
            </div>
          </TabsTab>
          <TabsTab value="edit">
            <div className="flex items-center gap-2">
              <Pencil className="p-1" />
              <span>{t("policy.tabs.editFile")}</span>
            </div>
          </TabsTab>
          <TabsTab value="diff">
            <div className="flex items-center gap-2">
              <Eye className="p-1" />
              <span>{t("policy.tabs.diff")}</span>
            </div>
          </TabsTab>
          <TabsTab value="preview">
            <div className="flex items-center gap-2">
              <FlaskConical className="p-1" />
              <span>{t("policy.tabs.preview")}</span>
            </div>
          </TabsTab>
        </TabsList>
        <TabsPanel value="rules">
          {structuredPanel((value) => (
            <RulesEditor
              canEditGrants={canEditGrants}
              destinations={destinations}
              isDisabled={disabled}
              onChange={applyPolicy}
              policy={value}
              sources={sources}
            />
          ))}
        </TabsPanel>
        <TabsPanel value="tags">
          {structuredPanel((value) => (
            <TagsGroupsEditor
              isDisabled={disabled}
              onChange={applyPolicy}
              policy={value}
              tagUsage={tagUsage}
              users={users}
            />
          ))}
        </TabsPanel>
        <TabsPanel value="edit">
          <Suspense fallback={<Fallback />}>
            <LazyEditor isDisabled={disabled} onChange={setCodePolicy} value={codePolicy} />
          </Suspense>
        </TabsPanel>
        <TabsPanel value="diff">
          <Suspense fallback={<Fallback />}>
            <LazyDiffer left={policy} right={codePolicy} />
          </Suspense>
        </TabsPanel>
        <TabsPanel value="preview">
          <div className="flex flex-col items-center py-8">
            <Construction />
            <p className="mt-4 w-1/2 text-center">{t("policy.previewUnavailable")}</p>
          </div>
        </TabsPanel>
      </Tabs>
      <Button
        className="mr-2"
        disabled={
          disabled ||
          fetcher.state !== "idle" ||
          codePolicy.trim().length === 0 ||
          !parsed.ok ||
          codePolicy === policy
        }
        onClick={() => {
          fetcher.submit({ intent: "save", policy: codePolicy }, { method: "POST" });
        }}
        variant="primary"
      >
        {t("policy.save")}
      </Button>
      <Button
        disabled={disabled || fetcher.state !== "idle" || codePolicy === policy}
        onClick={() => {
          // Reset the editor to the original policy
          setCodePolicy(policy);
        }}
      >
        {t("policy.discard")}
      </Button>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useI18n();
  if (
    isRouteErrorResponse(error) &&
    isApiError(error.data) &&
    error.data.rawData.includes("reading policy from path") &&
    error.data.rawData.includes("no such file or directory")
  ) {
    return (
      <ErrorState
        description={
          <Trans
            id="policy.missingFile.description"
            values={{ mode: <Code>policy.mode</Code>, database: <Code>database</Code> }}
          />
        }
        icon={<FileX />}
        title={t("policy.missingFile.title")}
      />
    );
  }

  return <PageError error={error} page={t("policy.errorPage")} />;
}
