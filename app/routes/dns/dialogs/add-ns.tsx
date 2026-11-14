import { Plus } from "lucide-react";
import { useState } from "react";

import ActionDialog from "~/components/action-dialog";
import Button from "~/components/button";
import Input from "~/components/input";
import { SwitchField } from "~/components/switch";
import { useI18n } from "~/i18n/react";
import { fieldValidator } from "~/utils/form";

import { nameserver } from "../schemas";

const validateNameserver = fieldValidator(nameserver);

export default function AddNameserver() {
  const { t } = useI18n();
  const [isSplit, setIsSplit] = useState(false);

  return (
    <ActionDialog
      intent="add_ns"
      onOpenChange={(isOpen) => isOpen && setIsSplit(false)}
      submitLabel={t("dns.nameservers.add")}
      title={t("dns.nameservers.add")}
      trigger={
        <Button>
          <Plus className="size-3.5" />
          {t("dns.nameservers.add")}
        </Button>
      }
    >
      <Input
        description={t("dns.nameservers.addressDescription")}
        label={t("dns.nameserver")}
        name="nameserver"
        placeholder="1.2.3.4"
        required
        validate={(value) => (validateNameserver(value) ? t("dns.errors.ip") : null)}
      />
      <SwitchField
        checked={isSplit}
        description={t("dns.nameservers.splitDescription")}
        label={t("dns.nameservers.restrictDomain")}
        onCheckedChange={setIsSplit}
      />
      {isSplit && (
        <Input
          description={t("dns.nameservers.domainDescription")}
          label={t("dns.domain")}
          name="split_domain"
          placeholder="example.com"
          required
        />
      )}
    </ActionDialog>
  );
}
