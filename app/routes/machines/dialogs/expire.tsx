import ActionDialog from "~/components/action-dialog";
import { useI18n } from "~/i18n/react";
import type { Machine } from "~/types";

interface ExpireProps {
  machine: Machine;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function Expire({ machine, isOpen, setIsOpen }: ExpireProps) {
  const { t } = useI18n();
  return (
    <ActionDialog
      description={t("machines.expire.description")}
      fields={{ node_id: machine.id }}
      intent="expire"
      isDestructive
      onOpenChange={setIsOpen}
      open={isOpen}
      submitLabel={t("machines.expire")}
      title={t("machines.expire.title", { name: machine.givenName })}
    />
  );
}
