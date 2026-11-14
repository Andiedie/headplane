import { Plus } from "lucide-react";

import ActionDialog from "~/components/action-dialog";
import Button from "~/components/button";
import Input from "~/components/input";
import { useI18n } from "~/i18n/react";
import { fieldValidator } from "~/utils/form";

import { username } from "../schemas";

interface CreateUserProps {
  isOidc?: boolean;
  isDisabled?: boolean;
}

const validateUsername = fieldValidator(username);

export default function CreateUser({ isOidc, isDisabled }: CreateUserProps) {
  const { t } = useI18n();
  return (
    <ActionDialog
      description={t(isOidc ? "users.create.oidcDescription" : "users.create.localDescription")}
      intent="create"
      submitLabel={t("users.create.submit")}
      title={t("users.create.title")}
      trigger={
        <Button disabled={isDisabled} variant="primary">
          <Plus className="size-3.5" />
          {t("users.add")}
        </Button>
      }
    >
      <Input
        description={t("users.username.rules")}
        label={t("users.username")}
        name="name"
        placeholder="my-new-user"
        required
        validate={(value) =>
          validateUsername(value) === null ? null : t("users.username.invalid")
        }
      />
      <Input label={t("users.displayName")} name="display_name" placeholder="John Doe" />
      <Input label={t("users.email")} name="email" placeholder="name@example.com" type="email" />
    </ActionDialog>
  );
}
