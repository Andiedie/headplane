import { useI18n } from "~/i18n/react";

import Chip from "../chip";
import Tooltip from "../tooltip";

export interface SubnetTagProps {
  isEnabled?: boolean;
  count: number;
}

export function SubnetTag({ isEnabled, count }: SubnetTagProps) {
  const { t } = useI18n();
  return (
    <Tooltip
      content={t(isEnabled ? "components.tags.subnetActive" : "components.tags.subnetPending")}
    >
      <Chip
        text={t(count === 1 ? "components.tags.subnet" : "components.tags.subnets", { count })}
        variant={isEnabled ? "neutral" : "warn"}
      />
    </Tooltip>
  );
}
