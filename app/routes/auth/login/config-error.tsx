import Callout from "~/components/callout";
import Code from "~/components/code";
import Link from "~/components/link";
import { Trans, useI18n } from "~/i18n/react";
import type { OidcErrorCode } from "~/server/oidc/provider";

export function OidcDiscoveryFailedNotice() {
  const { t } = useI18n();
  return (
    <Callout className="mb-6" title={t("auth.oidc.unavailable")} variant="warning">
      {t("auth.oidc.unreachable")}
    </Callout>
  );
}

export function OidcConfigErrorNotice({ errors }: { errors: OidcErrorCode[] }) {
  const { t } = useI18n();
  return (
    <Callout className="mb-6" title={t("auth.oidc.misconfigured")} variant="error">
      <ul className="list-inside list-disc">
        {errors.map((code) => (
          <li key={code}>
            <span>{getErrorMessage(code)}</span>
          </li>
        ))}
      </ul>
      <Link external styled to="https://headplane.net/features/sso#troubleshooting">
        {t("auth.oidc.troubleshooting")}
      </Link>
    </Callout>
  );
}

function getErrorMessage(code: OidcErrorCode) {
  switch (code) {
    case "invalid_api_key":
      return (
        <Trans id="auth.oidc.invalidKey" values={{ config: <Code>headscale.api_key</Code> }} />
      );
    case "missing_endpoints":
      return <Trans id="auth.oidc.missingEndpoints" />;
    case "discovery_failed":
      return <Trans id="auth.oidc.discoveryFailed" />;
    default:
      return <Trans id="auth.oidc.unknownConfig" />;
  }
}
