import { Plus } from "lucide-react";

import ActionDialog from "~/components/action-dialog";
import Button from "~/components/button";
import Input from "~/components/input";
import { useI18n } from "~/i18n/react";

export default function AddDomain() {
  const { t } = useI18n();
  return (
    <ActionDialog
      description={t("dns.domains.addDescription")}
      intent="add_domain"
      submitLabel={t("dns.domains.add")}
      title={t("dns.domains.addTitle")}
      trigger={
        <Button>
          <Plus className="size-3.5" />
          {t("dns.domains.add")}
        </Button>
      }
    >
      <Input label={t("dns.domain")} name="domain" placeholder="corp.example.com" required />
    </ActionDialog>
  );
}
