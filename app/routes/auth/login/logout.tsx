import { Link as RouterLink } from "react-router";

import Button from "~/components/button";
import { useI18n } from "~/i18n/react";

import Shell from "./shell";

export default function Logout() {
  const { t } = useI18n();
  return (
    <Shell description={t("auth.logout.description")} title={t("auth.logout.title")}>
      <Button
        className="w-full"
        nativeButton={false}
        render={<RouterLink prefetch="none" reloadDocument to="/login" />}
        variant="primary"
      >
        {t("auth.logout.signIn")}
      </Button>
    </Shell>
  );
}
