import { useState } from "react";

import Input from "~/components/input";
import Link from "~/components/link";
import Select from "~/components/select";
import TokenList from "~/components/token-list";
import { Trans, useI18n } from "~/i18n/react";
import { KNOWN_SSH_ACTIONS, type SshRule } from "~/utils/acl-policy";

import EditorDialog from "./editor-dialog";

interface SshRuleDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  rule?: SshRule;
  sources: string[];
  destinations: string[];
  onSave: (rule: SshRule) => void;
}

const EMPTY: SshRule = { action: "accept", src: [], dst: [], users: [], extra: {} };
const SSH_USERS = ["root", "autogroup:nonroot"];

export default function SshRuleDialog({
  isOpen,
  setIsOpen,
  rule,
  sources,
  destinations,
  onSave,
}: SshRuleDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SshRule>(() => structuredClone(rule ?? EMPTY));

  const isInvalid = draft.src.length === 0 || draft.dst.length === 0 || draft.users.length === 0;

  return (
    <EditorDialog
      description={
        <Trans
          id="policy.ssh.dialogDescription"
          values={{
            docs: (
              <Link external styled to="https://tailscale.com/kb/1193/tailscale-ssh">
                {t("policy.ssh.docs")}
              </Link>
            ),
          }}
        />
      }
      isDisabled={isInvalid}
      isOpen={isOpen}
      onSubmit={() => onSave(draft)}
      setIsOpen={setIsOpen}
      submitLabel={rule ? t("policy.rules.update") : t("policy.rules.add")}
      title={rule ? t("policy.ssh.edit") : t("policy.ssh.new")}
    >
      <Select
        items={[
          { value: "accept", label: t("policy.ssh.accept") },
          { value: "check", label: t("policy.ssh.check") },
          // An action we do not know is listed as-is so it survives an edit.
          ...(KNOWN_SSH_ACTIONS.includes(draft.action)
            ? []
            : [
                {
                  value: draft.action,
                  label: t("policy.ssh.unknownAction", { action: draft.action }),
                },
              ]),
        ]}
        label={t("policy.ssh.action")}
        onValueChange={(value) => setDraft({ ...draft, action: value ?? draft.action })}
        value={draft.action}
      />
      <TokenList
        description={t("policy.ssh.sourcesDescription")}
        emptyText={t("policy.sources.empty")}
        label={t("policy.sources.title")}
        onChange={(src) => setDraft({ ...draft, src })}
        placeholder="group:ops"
        suggestions={sources}
        values={draft.src}
      />
      <TokenList
        description={t("policy.ssh.destinationsDescription")}
        emptyText={t("policy.destinations.empty")}
        label={t("policy.destinations.title")}
        onChange={(dst) => setDraft({ ...draft, dst })}
        placeholder="tag:server"
        suggestions={destinations}
        values={draft.dst}
      />
      <TokenList
        description={t("policy.ssh.usersDescription")}
        emptyText={t("policy.ssh.usersEmpty")}
        label={t("policy.ssh.users")}
        onChange={(users) => setDraft({ ...draft, users })}
        placeholder="autogroup:nonroot"
        suggestions={SSH_USERS}
        values={draft.users}
      />
      {draft.action === "check" ? (
        <Input
          description={t("policy.ssh.checkDescription")}
          label={t("policy.ssh.checkPeriod")}
          onChange={(checkPeriod) =>
            setDraft({ ...draft, checkPeriod: checkPeriod.length > 0 ? checkPeriod : undefined })
          }
          placeholder="12h"
          value={draft.checkPeriod ?? ""}
        />
      ) : null}
    </EditorDialog>
  );
}
