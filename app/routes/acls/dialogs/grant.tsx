import { useState } from "react";

import Link from "~/components/link";
import TokenList from "~/components/token-list";
import { Trans, useI18n } from "~/i18n/react";
import { isValidTagName, type Grant } from "~/utils/acl-policy";

import EditorDialog from "./editor-dialog";

interface GrantDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  grant?: Grant;
  sources: string[];
  destinations: string[];
  onSave: (grant: Grant) => void;
}

const EMPTY: Grant = { src: [], dst: [], ip: ["*"], via: [], extra: {} };
const IP_SUGGESTIONS = ["*", "tcp:22", "tcp:80", "tcp:443", "udp:53", "icmp"];

export default function GrantDialog({
  isOpen,
  setIsOpen,
  grant,
  sources,
  destinations,
  onSave,
}: GrantDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Grant>(() => structuredClone(grant ?? EMPTY));

  // A grant that only carries app capabilities has no `ip`.
  const isInvalid =
    draft.src.length === 0 ||
    draft.dst.length === 0 ||
    (draft.ip.length === 0 && !("app" in draft.extra));

  return (
    <EditorDialog
      description={
        <Trans
          id="policy.grants.dialogDescription"
          values={{
            guide: (
              <Link external styled to="https://tailscale.com/kb/1324/grants">
                {t("policy.grants.guide")}
              </Link>
            ),
          }}
        />
      }
      isDisabled={isInvalid}
      isOpen={isOpen}
      onSubmit={() => onSave(draft)}
      setIsOpen={setIsOpen}
      submitLabel={grant ? t("policy.grants.update") : t("policy.grants.add")}
      title={grant ? t("policy.grants.edit") : t("policy.grants.new")}
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
        description={t("policy.grants.destinationsDescription")}
        emptyText={t("policy.destinations.empty")}
        label={t("policy.destinations.title")}
        onChange={(dst) => setDraft({ ...draft, dst })}
        placeholder="tag:web"
        suggestions={destinations}
        values={draft.dst}
      />
      <TokenList
        description={t("policy.grants.portsDescription")}
        emptyText={t("policy.grants.portsEmpty")}
        label={t("policy.grants.ports")}
        onChange={(ip) => setDraft({ ...draft, ip })}
        placeholder="tcp:443"
        suggestions={IP_SUGGESTIONS}
        values={draft.ip}
      />
      <TokenList
        description={t("policy.grants.viaDescription")}
        emptyText={t("policy.grants.viaEmpty")}
        label={t("policy.grants.viaTitle")}
        onChange={(via) => setDraft({ ...draft, via })}
        placeholder="tag:router"
        suggestions={sources.filter((source) => source.startsWith("tag:"))}
        validate={isValidTagName}
        values={draft.via}
      />
    </EditorDialog>
  );
}
