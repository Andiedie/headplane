import { useState } from "react";

import ActionDialog from "~/components/action-dialog";
import Code from "~/components/code";
import Input from "~/components/input";
import { Trans, useI18n } from "~/i18n/react";
import type { Machine } from "~/types";
import { fieldValidator } from "~/utils/form";

import { machineName } from "../schemas";

interface RenameProps {
  machine: Machine;
  isOpen: boolean;
  magic?: string;
  setIsOpen: (isOpen: boolean) => void;
}

const validateName = fieldValidator(machineName);

export default function Rename({ machine, magic, isOpen, setIsOpen }: RenameProps) {
  const { t } = useI18n();
  const [name, setName] = useState(machine.givenName);
  const isValid = validateName(name) === null;

  return (
    <ActionDialog
      description={t("machines.rename.description")}
      fields={{ node_id: machine.id }}
      intent="rename"
      isDisabled={name === machine.givenName}
      onOpenChange={setIsOpen}
      open={isOpen}
      submitLabel={t("machines.rename")}
      title={t("machines.rename.title", { name: machine.givenName })}
    >
      <Input
        defaultValue={machine.givenName}
        label={t("machines.name")}
        name="name"
        onChange={setName}
        required
        validate={(value) => (validateName(value) === null ? null : t("machines.rename.invalid"))}
      />
      {magic && isValid && (
        <p className="text-muted">
          {name === machine.givenName ? (
            <Trans
              id="machines.rename.reachable"
              values={{ name: <Code>{machine.givenName}</Code> }}
            />
          ) : (
            <Trans
              id="machines.rename.willBeReachable"
              values={{
                name: <Code>{name.toLowerCase()}</Code>,
                oldName: <Code>{machine.givenName}</Code>,
              }}
            />
          )}
        </p>
      )}
    </ActionDialog>
  );
}
