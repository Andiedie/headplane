import { Plus } from "lucide-react";
import { useState } from "react";

import ActionDialog from "~/components/action-dialog";
import Button from "~/components/button";
import Input from "~/components/input";
import { settingsErrorKeys } from "~/i18n/messages/settings";
import { useI18n } from "~/i18n/react";
import { fieldValidator } from "~/utils/form";

import { type RestrictionType, restrictionValue } from "../schemas";

const copy = {
  domain: {
    title: "settings.restrictions.domain.addTitle",
    label: "settings.restrictions.domain.addLabel",
    description: "settings.restrictions.domain.addDescription",
    placeholder: "example.com",
  },
  group: {
    title: "settings.restrictions.group.addTitle",
    label: "settings.restrictions.group.addLabel",
    description: "settings.restrictions.group.addDescription",
    placeholder: "admin",
  },
  user: {
    title: "settings.restrictions.user.addTitle",
    label: "settings.restrictions.user.addLabel",
    description: "settings.restrictions.user.addDescription",
    placeholder: "john_doe",
  },
} as const;

const validators = {
  domain: fieldValidator(restrictionValue.domain),
  group: fieldValidator(restrictionValue.group),
  user: fieldValidator(restrictionValue.user),
};

interface AddRestrictionProps {
  type: RestrictionType;
}

export default function AddRestriction({ type }: AddRestrictionProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const { title, label, description, placeholder } = copy[type];
  const domain = value.trim();

  return (
    <ActionDialog
      description={t(description)}
      fields={{ type }}
      intent="add"
      submitLabel={t(title)}
      title={t(title)}
      trigger={
        <Button>
          <Plus className="size-3.5" />
          {t(title)}
        </Button>
      }
    >
      <Input
        description={
          type === "domain" && domain.length > 0
            ? t("settings.restrictions.matches", { domain })
            : undefined
        }
        label={t(label)}
        name="value"
        onChange={setValue}
        placeholder={placeholder}
        required
        validate={(value) => {
          const error = validators[type](value);
          return error && settingsErrorKeys[error] ? t(settingsErrorKeys[error]) : error;
        }}
      />
    </ActionDialog>
  );
}
