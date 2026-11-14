import Callout from "~/components/callout";
import Code from "~/components/code";
import { Trans, useI18n } from "~/i18n/react";

export function OidcErrorNotice({ code }: { code: string }) {
  const { t } = useI18n();
  return (
    <Callout className="mb-6" title={t("auth.oidc.failed")} variant="error">
      {getErrorMessage(code)}
    </Callout>
  );
}

function getErrorMessage(code: string) {
  switch (code) {
    case "error_no_query":
      return (
        <p>
          <Trans id="auth.oidc.noQuery" />
        </p>
      );
    case "error_no_session":
    case "error_invalid_session":
      return (
        <p>
          <Trans id="auth.oidc.invalidSession" />
        </p>
      );
    case "error_no_sub":
      return (
        <p>
          <Trans id="auth.oidc.noSubject" values={{ claim: <Code>sub</Code> }} />
        </p>
      );
    case "error_auth_failed":
      return (
        <p>
          <Trans id="auth.oidc.authFailed" />
        </p>
      );
    default:
      return (
        <p>
          <Trans id="auth.oidc.unknown" />
        </p>
      );
  }
}
