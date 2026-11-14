import ActionDialog from "~/components/action-dialog";
import { useI18n } from "~/i18n/react";
import { KEY_EXPIRY_DAYS } from "~/server/headscale/api/resources/nodes";
import type { Machine } from "~/types";
import { isNoExpiry } from "~/utils/node-info";

interface KeyExpiryProps {
  machine: Machine;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function KeyExpiry({ machine, isOpen, setIsOpen }: KeyExpiryProps) {
  const { t } = useI18n();
  const isDisabling = !isNoExpiry(machine.expiry);

  return (
    <ActionDialog
      description={
        isDisabling
          ? t("machines.keyExpiry.disableDescription")
          : t("machines.keyExpiry.enableDescription", { days: KEY_EXPIRY_DAYS })
      }
      fields={{ node_id: machine.id, disable_expiry: String(isDisabling) }}
      intent="toggle_expiry"
      onOpenChange={setIsOpen}
      open={isOpen}
      submitLabel={isDisabling ? t("machines.keyExpiry.disable") : t("machines.keyExpiry.enable")}
      title={
        isDisabling
          ? t("machines.keyExpiry.disableTitle", { name: machine.givenName })
          : t("machines.keyExpiry.enableTitle", { name: machine.givenName })
      }
    />
  );
}
