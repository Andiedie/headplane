import ActionDialog from "~/components/action-dialog";
import Code from "~/components/code";
import Link from "~/components/link";
import Section, { RemoveButton, Row, RowList } from "~/components/section";
import { Trans, useI18n } from "~/i18n/react";

import AddRecord from "../dialogs/add-record";

interface Props {
  records: { name: string; type: "A" | string; value: string }[];
  hasRecordsFile: boolean;
  isDisabled: boolean;
  isReadOnly: boolean;
}

export default function ManageRecords({ records, hasRecordsFile, isDisabled, isReadOnly }: Props) {
  const { t } = useI18n();
  const isLocked = isDisabled || isReadOnly;

  return (
    <Section
      action={isLocked ? undefined : <AddRecord />}
      description={
        <>
          <Trans
            id="dns.records.description"
            values={{
              docs: (
                <Link external styled to="https://headscale.net/stable/ref/dns">
                  {t("dns.docs")}
                </Link>
              ),
            }}
          />
          {!isDisabled && isReadOnly && hasRecordsFile && (
            <>
              {" "}
              <Trans
                id="dns.records.fileReadOnly"
                values={{ path: <Code>dns.extra_records_path</Code> }}
              />
            </>
          )}
          {!isDisabled && isReadOnly && !hasRecordsFile && (
            <>
              {" "}
              <Trans
                id="dns.records.inlineReadOnly"
                values={{
                  records: <Code>dns.extra_records</Code>,
                  path: <Code>dns.extra_records_path</Code>,
                }}
              />
            </>
          )}
        </>
      }
      title={t("dns.records.title")}
    >
      {records.length === 0 ? (
        <p className="text-muted py-2.5 text-sm">{t("dns.records.empty")}</p>
      ) : (
        <RowList>
          {records.map((record) => (
            <Row
              action={
                <ActionDialog
                  description={t("dns.records.removeDescription")}
                  fields={{ name: record.name, type: record.type }}
                  intent="remove_record"
                  isDestructive
                  submitLabel={t("dns.remove")}
                  title={t("dns.records.removeTitle", { type: record.type, name: record.name })}
                  trigger={<RemoveButton disabled={isLocked} />}
                />
              }
              key={`${record.name}-${record.type}-${record.value}`}
            >
              <span className="grid grid-cols-1 gap-x-4 font-mono text-xs sm:grid-cols-2">
                <span className="break-all">{record.name}</span>
                <span className="break-all">
                  <span className="text-muted mr-2 inline-block w-8">{record.type}</span>
                  {record.value}
                </span>
              </span>
            </Row>
          ))}
        </RowList>
      )}
    </Section>
  );
}
