import { Plus } from "lucide-react";
import { useState } from "react";

import ActionDialog from "~/components/action-dialog";
import Button from "~/components/button";
import Input from "~/components/input";
import Select from "~/components/select";
import { useI18n } from "~/i18n/react";
import { fieldValidator } from "~/utils/form";

import { recordValue } from "../schemas";

const validators = {
  A: fieldValidator(recordValue.A),
  AAAA: fieldValidator(recordValue.AAAA),
};

export default function AddRecord() {
  const { t } = useI18n();
  const [type, setType] = useState<keyof typeof validators>("A");

  return (
    <ActionDialog
      description={t("dns.records.addDescription")}
      intent="add_record"
      submitLabel={t("dns.records.add")}
      title={t("dns.records.addTitle")}
      trigger={
        <Button>
          <Plus className="size-3.5" />
          {t("dns.records.add")}
        </Button>
      }
    >
      <Select
        items={[
          { value: "A", label: "A" },
          { value: "AAAA", label: "AAAA" },
        ]}
        label={t("dns.records.type")}
        name="type"
        onValueChange={(value) => {
          if (value === "A" || value === "AAAA") setType(value);
        }}
        required
        value={type}
      />
      <Input label={t("dns.domain")} name="name" placeholder="test.example.com" required />
      <Input
        key={type}
        label={t("dns.ipAddress")}
        name="value"
        placeholder={type === "AAAA" ? "2001:db8::ff00:42:8329" : "100.100.100.100"}
        required
        validate={(value) =>
          validators[type](value)
            ? type === "AAAA"
              ? t("dns.errors.ipv6")
              : t("dns.errors.ipv4")
            : null
        }
      />
    </ActionDialog>
  );
}
