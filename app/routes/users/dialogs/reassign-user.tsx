import { useState } from "react";

import ActionDialog from "~/components/action-dialog";
import Link from "~/components/link";
import RadioGroup from "~/components/radio-group";
import { Trans, useI18n } from "~/i18n/react";
import { Roles } from "~/server/web/roles";
import type { Role } from "~/server/web/roles";

interface ReassignProps {
  headplaneUserId: string;
  displayName: string;
  role: Role;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function ReassignUser({
  headplaneUserId,
  displayName,
  role,
  isOpen,
  setIsOpen,
}: ReassignProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string>(role);

  return (
    <ActionDialog
      description={
        <Trans
          id="users.reassign.description"
          values={{
            docs: (
              <Link external styled to="https://tailscale.com/kb/1138/user-roles">
                {t("users.docs")}
              </Link>
            ),
          }}
        />
      }
      fields={{ headplane_user_id: headplaneUserId }}
      intent="reassign"
      isDisabled={selected === role}
      onOpenChange={setIsOpen}
      open={isOpen}
      submitLabel={t("users.changeRole")}
      title={t("users.reassign.title", { name: displayName })}
    >
      <RadioGroup
        className="gap-4"
        label={t("users.role")}
        name="role"
        onValueChange={setSelected}
        value={selected}
      >
        {Object.keys(Roles)
          .filter((r) => r !== "owner")
          .map((r) => {
            const { name, desc } = mapRoleToName(r, t);
            return (
              <RadioGroup.Radio key={r} label={name} value={r}>
                <div>
                  <p className="font-medium">{name}</p>
                  <p className="text-muted">{desc}</p>
                </div>
              </RadioGroup.Radio>
            );
          })}
      </RadioGroup>
    </ActionDialog>
  );
}

function mapRoleToName(role: string, t: ReturnType<typeof useI18n>["t"]) {
  switch (role) {
    case "admin":
      return {
        name: t("users.role.admin"),
        desc: t("users.roleDescription.admin"),
      };
    case "network_admin":
      return {
        name: t("users.role.network_admin"),
        desc: t("users.roleDescription.network_admin"),
      };
    case "it_admin":
      return {
        name: t("users.role.it_admin"),
        desc: t("users.roleDescription.it_admin"),
      };
    case "auditor":
      return {
        name: t("users.role.auditor"),
        desc: t("users.roleDescription.auditor"),
      };
    case "viewer":
      return {
        name: t("users.role.viewer"),
        desc: t("users.roleDescription.viewer"),
      };
    case "member":
      return {
        name: t("users.role.member"),
        desc: t("users.roleDescription.member"),
      };
    default:
      return {
        name: role,
        desc: t("users.roleDescription.unknown"),
      };
  }
}
