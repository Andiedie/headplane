import { useState } from "react";

import ActionDialog from "~/components/action-dialog";
import Callout from "~/components/callout";
import Code from "~/components/code";
import Link from "~/components/link";
import TokenList from "~/components/token-list";
import { Trans, useI18n } from "~/i18n/react";
import type { Machine } from "~/types";

interface TagsProps {
  machine: Machine;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  existingTags?: string[];
  // Tags declared under `tagOwners`. Others are assignable but match no rule.
  policyTags?: string[];
}

export default function Tags({ machine, isOpen, setIsOpen, existingTags, policyTags }: TagsProps) {
  const { t } = useI18n();
  const [tags, setTags] = useState([...machine.tags]);
  const undeclaredTags =
    policyTags === undefined ? [] : tags.filter((tag) => !policyTags.includes(tag));
  const isUnchanged =
    tags.length === machine.tags.length && tags.every((tag) => machine.tags.includes(tag));

  return (
    <ActionDialog
      description={
        <Trans
          id="machines.tags.description"
          values={{
            docs: (
              <Link external styled to="https://tailscale.com/kb/1068/acl-tags">
                {t("machines.docs")}
              </Link>
            ),
          }}
        />
      }
      fields={{ node_id: machine.id }}
      intent="update_tags"
      isDisabled={isUnchanged}
      onOpenChange={setIsOpen}
      open={isOpen}
      submitLabel={t("machines.tags.save")}
      title={t("machines.tags.title", { name: machine.givenName })}
    >
      {tags.map((tag) => (
        <input key={tag} name="tags" type="hidden" value={tag} />
      ))}
      <TokenList
        emptyText={t("machines.tags.empty")}
        label={t("machines.tags")}
        normalize={(value) => (value.startsWith("tag:") ? value : `tag:${value}`)}
        onChange={setTags}
        placeholder="tag:server"
        suggestions={existingTags}
        validate={(value) => /^tag:\S+$/.test(value)}
        values={tags}
      />
      {undeclaredTags.length > 0 && (
        <Callout variant="warning">
          <Trans
            id={
              undeclaredTags.length === 1
                ? "machines.tags.undeclaredOne"
                : "machines.tags.undeclaredMany"
            }
            values={{
              tags: undeclaredTags.join(", "),
              tagOwners: <Code>tagOwners</Code>,
              accessControl: (
                <Link styled to="/acls">
                  {t("machines.accessControl")}
                </Link>
              ),
            }}
          />
        </Callout>
      )}
    </ActionDialog>
  );
}
