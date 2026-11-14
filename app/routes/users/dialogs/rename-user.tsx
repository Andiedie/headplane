import ActionDialog from "~/components/action-dialog";
import Input from "~/components/input";
import { useI18n } from "~/i18n/react";
import type { User } from "~/types";
import { fieldValidator } from "~/utils/form";

import { username } from "../schemas";

interface RenameProps {
  user: User;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const validateUsername = fieldValidator(username);

export default function RenameUser({ user, isOpen, setIsOpen }: RenameProps) {
  const { t } = useI18n();
  return (
    <ActionDialog
      description={t("users.rename.description")}
      fields={{ headscale_user_id: user.id }}
      intent="rename"
      onOpenChange={setIsOpen}
      open={isOpen}
      submitLabel={t("users.rename")}
      title={t("users.rename.title", { name: user.name || user.displayName || user.id })}
    >
      <Input
        defaultValue={user.name}
        description={t("users.username.rules")}
        label={t("users.username")}
        name="name"
        required
        validate={(value) =>
          validateUsername(value) === null ? null : t("users.username.invalid")
        }
      />
    </ActionDialog>
  );
}
