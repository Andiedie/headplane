import ActionDialog from "~/components/action-dialog";
import Callout from "~/components/callout";
import Select from "~/components/select";
import { useI18n } from "~/i18n/react";

interface LinkUserProps {
  headplaneUserId: string;
  displayName: string;
  headscaleUsers: { id: string; name: string; isTaggedDevices: boolean }[];
  currentLink?: string;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function LinkUser({
  headplaneUserId,
  displayName,
  headscaleUsers,
  currentLink,
  isOpen,
  setIsOpen,
}: LinkUserProps) {
  const { t } = useI18n();
  const hasChoices = headscaleUsers.length > 0;

  return (
    <ActionDialog
      description={t("users.link.description")}
      fields={{ headplane_user_id: headplaneUserId }}
      intent="link"
      isDisabled={!hasChoices}
      onOpenChange={setIsOpen}
      open={isOpen}
      submitLabel={t("users.link.submit")}
      title={t("users.link.title", { name: displayName })}
    >
      {hasChoices ? (
        <LinkUserSelect currentLink={currentLink} headscaleUsers={headscaleUsers} />
      ) : (
        <Callout>{t("users.link.noChoices")}</Callout>
      )}
    </ActionDialog>
  );
}

export function LinkUserSelect({
  currentLink,
  headscaleUsers,
}: Pick<LinkUserProps, "currentLink" | "headscaleUsers">) {
  const { t } = useI18n();

  return (
    <Select
      defaultValue={currentLink ?? null}
      items={headscaleUsers.map((user) => {
        const name = user.isTaggedDevices ? t("users.link.tagOwned") : user.name;
        return {
          value: user.id,
          label: user.id === currentLink ? t("users.link.current", { name }) : name,
        };
      })}
      label={t("users.headscaleUser")}
      name="headscale_user_id"
      placeholder={t("users.link.select")}
      required
    />
  );
}
