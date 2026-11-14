import { useState } from "react";

import Input from "~/components/input";
import Link from "~/components/link";
import TokenList from "~/components/token-list";
import { Trans, useI18n } from "~/i18n/react";
import { withDefaultPort, type AclRule } from "~/utils/acl-policy";

import EditorDialog from "./editor-dialog";

interface AclRuleDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  rule?: AclRule;
  sources: string[];
  destinations: string[];
  onSave: (rule: AclRule) => void;
}

const EMPTY: AclRule = { action: "accept", src: [], dst: [], extra: {} };

export default function AclRuleDialog({
  isOpen,
  setIsOpen,
  rule,
  sources,
  destinations,
  onSave,
}: AclRuleDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<AclRule>(() => structuredClone(rule ?? EMPTY));

  const isInvalid = draft.src.length === 0 || draft.dst.length === 0;

  return (
    <EditorDialog
      description={
        <Trans
          id="policy.rules.dialogDescription"
          values={{
            example: <code className="font-mono">tag:web:80,443</code>,
            allPorts: <code className="font-mono">:*</code>,
            guide: (
              <Link external styled to="https://tailscale.com/kb/1018/acls">
                {t("policy.aclGuide")}
              </Link>
            ),
          }}
        />
      }
      isDisabled={isInvalid}
      isOpen={isOpen}
      onSubmit={() => {
        // A hand-written policy may be missing the port spec Headscale wants.
        onSave({ ...draft, dst: draft.dst.map(withDefaultPort) });
      }}
      setIsOpen={setIsOpen}
      submitLabel={rule ? t("policy.rules.update") : t("policy.rules.add")}
      title={rule ? t("policy.rules.edit") : t("policy.rules.new")}
    >
      <TokenList
        description={t("policy.sources.description")}
        emptyText={t("policy.sources.empty")}
        label={t("policy.sources.title")}
        onChange={(src) => setDraft({ ...draft, src })}
        placeholder="group:eng"
        suggestions={sources}
        values={draft.src}
      />
      <TokenList
        description={t("policy.rules.destinationsDescription")}
        emptyText={t("policy.destinations.empty")}
        label={t("policy.destinations.title")}
        normalize={withDefaultPort}
        onChange={(dst) => setDraft({ ...draft, dst })}
        placeholder="tag:web:80,443"
        suggestions={destinations}
        values={draft.dst}
      />
      <Input
        description={t("policy.rules.protocolDescription")}
        label={t("policy.rules.protocol")}
        onChange={(proto) => setDraft({ ...draft, proto: proto.length > 0 ? proto : undefined })}
        placeholder="tcp"
        value={draft.proto ?? ""}
      />
    </EditorDialog>
  );
}
