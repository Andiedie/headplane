import { useI18n } from "~/i18n/react";
import { formatTimeUntil } from "~/utils/time";

import Chip from "../chip";
import Tooltip from "../tooltip";

export interface ExpiryTagProps {
  variant: "expired" | "expiring" | "no-expiry";
  expiry?: string;
}

export function ExpiryTag({ variant, expiry }: ExpiryTagProps) {
  const { locale, t } = useI18n();
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const date = expiry ? formatter.format(new Date(expiry)) : undefined;

  switch (variant) {
    case "expired":
      return (
        <Tooltip content={t("components.tags.expiredDescription", { date: String(date) })}>
          <Chip text={t("components.status.expired")} variant="bad" />
        </Tooltip>
      );

    case "expiring":
      return (
        <Tooltip content={t("components.tags.expiringDescription", { date: String(date) })}>
          <Chip
            text={t("components.tags.expiring", {
              time: formatTimeUntil(new Date(expiry!), locale),
            })}
            variant="warn"
          />
        </Tooltip>
      );

    case "no-expiry":
      return (
        <Tooltip content={t("components.tags.noExpiryDescription")}>
          <Chip text={t("components.tags.noExpiry")} />
        </Tooltip>
      );
  }
}
