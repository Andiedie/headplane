import { useState } from "react";

import Input from "~/components/input";
import TokenList from "~/components/token-list";
import { useI18n } from "~/i18n/react";
import { isValidGroupName, isValidTagName } from "~/utils/acl-policy";

import EditorDialog from "./editor-dialog";

export type NamedListKind = "group" | "tag";

interface NamedListDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  kind: NamedListKind;
  // Present when editing, absent when creating a new entry.
  name?: string;
  members?: string[];
  existingNames: string[];
  suggestions: string[];
  onSave: (name: string, members: string[]) => void;
}

const COPY = {
  group: {
    title: "policy.group.new",
    edit: "policy.group.edit",
    add: "policy.group.add",
    update: "policy.group.update",
    duplicate: "policy.group.duplicate",
    prefix: "group:",
    field: "policy.group.members",
    fieldDescription: "policy.group.membersDescription",
    empty: "policy.group.empty",
    placeholder: "alice@",
    validate: isValidGroupName,
    hint: "policy.group.hint",
  },
  tag: {
    title: "policy.tag.new",
    edit: "policy.tag.edit",
    add: "policy.tag.add",
    update: "policy.tag.update",
    duplicate: "policy.tag.duplicate",
    prefix: "tag:",
    field: "policy.tag.owners",
    fieldDescription: "policy.tag.ownersDescription",
    empty: "policy.tag.empty",
    placeholder: "group:ops",
    validate: isValidTagName,
    hint: "policy.tag.hint",
  },
} as const;

export default function NamedListDialog({
  isOpen,
  setIsOpen,
  kind,
  name,
  members,
  existingNames,
  suggestions,
  onSave,
}: NamedListDialogProps) {
  const { t } = useI18n();
  const copy = COPY[kind];
  const [draftName, setDraftName] = useState(name ?? copy.prefix);
  const [draftMembers, setDraftMembers] = useState<string[]>(() => [...(members ?? [])]);

  const trimmedName = draftName.trim();
  const isDuplicate = trimmedName !== name && existingNames.includes(trimmedName);
  const nameIsInvalid = !copy.validate(trimmedName) || isDuplicate;
  // The field opens pre-filled with the `group:`/`tag:` prefix, which is not a
  // valid name yet. Saving stays blocked, but nothing is flagged until it is edited.
  const isPristine = trimmedName.length === 0 || trimmedName === copy.prefix;
  const showNameError = !isPristine && nameIsInvalid;

  return (
    <EditorDialog
      description={t(copy.hint)}
      isDisabled={nameIsInvalid}
      isOpen={isOpen}
      onSubmit={() => onSave(trimmedName, draftMembers)}
      setIsOpen={setIsOpen}
      submitLabel={t(name ? copy.update : copy.add)}
      title={name ? t(copy.edit, { name }) : t(copy.title)}
    >
      <Input
        errorMessage={t(isDuplicate ? copy.duplicate : copy.hint)}
        invalid={showNameError}
        label={t("policy.name")}
        onChange={setDraftName}
        placeholder={`${copy.prefix}example`}
        value={draftName}
      />
      <TokenList
        description={t(copy.fieldDescription)}
        emptyText={t(copy.empty)}
        label={t(copy.field)}
        onChange={setDraftMembers}
        placeholder={copy.placeholder}
        suggestions={suggestions}
        values={draftMembers}
      />
    </EditorDialog>
  );
}
