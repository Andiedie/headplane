import { useI18n } from "~/i18n/react";

import Chip from "../chip";
import Tooltip from "../tooltip";

export function HeadplaneAgentTag() {
  const { t } = useI18n();
  return (
    <Tooltip content={t("components.tags.agentDescription")}>
      <Chip text={t("components.tags.agent")} />
    </Tooltip>
  );
}
