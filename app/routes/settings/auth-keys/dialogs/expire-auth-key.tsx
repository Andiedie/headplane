import ActionDialog from "~/components/action-dialog";
import { RemoveButton } from "~/components/section";
import { useI18n } from "~/i18n/react";
import type { PreAuthKey, User } from "~/types";

interface ExpireAuthKeyProps {
  authKey: PreAuthKey;
  user: User;
}

export default function ExpireAuthKey({ authKey, user }: ExpireAuthKeyProps) {
  const { t } = useI18n();
  return (
    <ActionDialog
      description={t("settings.keys.expireDescription")}
      fields={{ key_id: authKey.id, user_id: user.id }}
      intent="expire"
      isDestructive
      submitLabel={t("settings.keys.expireSubmit")}
      title={t("settings.keys.expireTitle")}
      trigger={<RemoveButton>{t("settings.keys.expire")}</RemoveButton>}
    />
  );
}
