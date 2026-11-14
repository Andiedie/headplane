import { useState } from "react";

import Input from "~/components/input";
import { useI18n } from "~/i18n/react";
import { isValidHostName } from "~/utils/acl-policy";

import EditorDialog from "./editor-dialog";

interface HostDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  name?: string;
  value?: string;
  existingNames: string[];
  onSave: (name: string, value: string) => void;
}

export default function HostDialog({
  isOpen,
  setIsOpen,
  name,
  value,
  existingNames,
  onSave,
}: HostDialogProps) {
  const { t } = useI18n();
  const [draftName, setDraftName] = useState(name ?? "");
  const [draftValue, setDraftValue] = useState(value ?? "");

  const isDuplicate = draftName !== name && existingNames.includes(draftName);
  const nameIsInvalid = !isValidHostName(draftName) || isDuplicate;
  const valueIsInvalid = draftValue.trim().length === 0;

  return (
    <EditorDialog
      description={t("policy.hosts.dialogDescription")}
      isDisabled={nameIsInvalid || valueIsInvalid}
      isOpen={isOpen}
      onSubmit={() => onSave(draftName, draftValue.trim())}
      setIsOpen={setIsOpen}
      submitLabel={name ? t("policy.hosts.update") : t("policy.hosts.add")}
      title={name ? t("policy.hosts.edit", { name }) : t("policy.hosts.new")}
    >
      <Input
        errorMessage={isDuplicate ? t("policy.hosts.duplicate") : t("policy.hosts.invalidName")}
        invalid={draftName.length > 0 && nameIsInvalid}
        label={t("policy.name")}
        onChange={setDraftName}
        placeholder="office"
        value={draftName}
      />
      <Input
        invalid={draftValue.length > 0 && valueIsInvalid}
        label={t("policy.hosts.address")}
        onChange={setDraftValue}
        placeholder="100.64.0.0/24"
        value={draftValue}
      />
    </EditorDialog>
  );
}
