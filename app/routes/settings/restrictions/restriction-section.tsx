import ActionDialog from "~/components/action-dialog";
import Section, { RemoveButton, Row, RowList } from "~/components/section";
import { useI18n } from "~/i18n/react";

import AddRestriction from "./dialogs/add-restriction";
import type { RestrictionType } from "./schemas";

const copy = {
  domain: {
    title: "settings.restrictions.domain.title",
    description: "settings.restrictions.domain.description",
    empty: "settings.restrictions.domain.empty",
    removeDescription: "settings.restrictions.domain.removeDescription",
  },
  group: {
    title: "settings.restrictions.group.title",
    description: "settings.restrictions.group.description",
    empty: "settings.restrictions.group.empty",
    removeDescription: "settings.restrictions.group.removeDescription",
  },
  user: {
    title: "settings.restrictions.user.title",
    description: "settings.restrictions.user.description",
    empty: "settings.restrictions.user.empty",
    removeDescription: "settings.restrictions.user.removeDescription",
  },
} as const;

interface Props {
  type: RestrictionType;
  values: string[];
  isDisabled: boolean;
}

export default function RestrictionSection({ type, values, isDisabled }: Props) {
  const { t } = useI18n();
  const { title, description, empty, removeDescription } = copy[type];

  return (
    <Section
      action={isDisabled ? undefined : <AddRestriction type={type} />}
      description={t(description)}
      title={t(title)}
    >
      {values.length === 0 ? (
        <p className="text-muted py-2.5 text-sm">{t(empty)}</p>
      ) : (
        <RowList>
          {values.map((value) => (
            <Row
              action={
                <ActionDialog
                  description={t(removeDescription)}
                  fields={{ type, value }}
                  intent="remove"
                  isDestructive
                  submitLabel={t("settings.remove")}
                  title={t("settings.restrictions.removeTitle", { value })}
                  trigger={
                    <RemoveButton disabled={isDisabled}>{t("settings.remove")}</RemoveButton>
                  }
                />
              }
              key={value}
            >
              <span className="font-mono text-xs break-all">{value}</span>
            </Row>
          ))}
        </RowList>
      )}
    </Section>
  );
}
