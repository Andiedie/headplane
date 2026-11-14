import { useI18n } from "~/i18n/react";

import Chip from "../chip";
import Tooltip from "../tooltip";

export interface ExitNodeTagProps {
  isEnabled?: boolean;
}

export function ExitNodeTag({ isEnabled }: ExitNodeTagProps) {
  const { t } = useI18n();
  return (
    <Tooltip
      content={t(isEnabled ? "components.tags.exitNodeActive" : "components.tags.exitNodePending")}
    >
      <Chip text={t("components.tags.exitNode")} variant={isEnabled ? "neutral" : "warn"} />
    </Tooltip>
  );
}
