import { useI18n } from "~/i18n/react";
import cn from "~/utils/cn";

export interface StatusCircleProps {
  isOnline: boolean;
  isExpired?: boolean;
  className?: string;
}

export default function StatusCircle({ isOnline, isExpired, className }: StatusCircleProps) {
  const { t } = useI18n();
  const label = t(
    isExpired
      ? "components.status.expired"
      : isOnline
        ? "components.status.online"
        : "components.status.offline",
  );

  return (
    <span
      aria-label={label}
      className={cn(
        "inline-block size-[7px] shrink-0 rounded-full",
        isExpired ? "bg-bad" : isOnline ? "bg-ok" : "bg-faint",
        className,
      )}
      role="img"
    />
  );
}
