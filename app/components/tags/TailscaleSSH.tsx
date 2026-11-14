import { useI18n } from "~/i18n/react";

import Chip from "../chip";
import Tooltip from "../tooltip";

export function TailscaleSSHTag() {
  const { t } = useI18n();
  return (
    <Tooltip content={t("components.tags.sshDescription")}>
      <Chip text="SSH" />
    </Tooltip>
  );
}
