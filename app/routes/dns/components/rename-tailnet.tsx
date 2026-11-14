import ActionDialog from "~/components/action-dialog";
import Button from "~/components/button";
import Input from "~/components/input";
import { useI18n } from "~/i18n/react";

interface Props {
  name: string;
  isDisabled: boolean;
}

export default function RenameTailnet({ name, isDisabled }: Props) {
  const { t } = useI18n();
  return (
    <ActionDialog
      description={t("dns.tailnet.renameDescription")}
      intent="rename_tailnet"
      submitLabel={t("dns.tailnet.rename")}
      title={t("dns.tailnet.renameTitle")}
      trigger={
        <Button disabled={isDisabled} size="sm">
          {t("dns.tailnet.rename")}
        </Button>
      }
    >
      <Input
        defaultValue={name}
        label={t("dns.tailnet.name")}
        name="name"
        placeholder="ts.net"
        required
      />
    </ActionDialog>
  );
}
