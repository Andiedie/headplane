import { useI18n } from "~/i18n/react";
import { formatTimeDelta } from "~/utils/time";

interface MachinesSeenProps {
  machines: { online: boolean; lastSeen: string }[];
}

export default function MachinesSeen({ machines }: MachinesSeenProps) {
  const { locale, t } = useI18n();
  if (machines.length === 0) {
    return <span className="text-muted">{t("users.machines.none")}</span>;
  }

  if (machines.some((machine) => machine.online)) {
    return <span className="text-ok">{t("users.machines.connected")}</span>;
  }

  const lastSeen = new Date(Math.max(...machines.map((m) => new Date(m.lastSeen).getTime())));
  return (
    <span className="text-muted" suppressHydrationWarning title={lastSeen.toLocaleString(locale)}>
      {formatTimeDelta(lastSeen, locale)}
    </span>
  );
}
