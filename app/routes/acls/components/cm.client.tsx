import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import * as shopify from "@shopify/lang-jsonc";
import CodeMirror, {
  Compartment,
  EditorState,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { BookCopy, Braces, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Merge from "react-codemirror-merge";
import { ErrorBoundary } from "react-error-boundary";

import Button from "~/components/button";
import { useI18n } from "~/i18n/react";
import { formatPolicy, parsePolicy } from "~/utils/acl-policy";
import cn from "~/utils/cn";

import { usePolicyDiagnostic } from "./policy-diagnostics";
import { headplaneTheme } from "./theme";

interface EditorProps {
  isDisabled?: boolean;
  value: string;
  onChange: (value: string) => void;
}

export function Editor(props: EditorProps) {
  const { t } = useI18n();
  const diagnostic = usePolicyDiagnostic();
  const phrases = useEditorPhrases();
  const policyLinter = useMemo(
    () =>
      linter((view): Diagnostic[] => {
        const parsed = parsePolicy(view.state.doc.toString());
        if (parsed.ok) return [];
        return parsed.diagnostics.map((entry) => ({
          ...entry,
          message: diagnostic(entry.message),
          severity: "error",
          source: "HuJSON",
        }));
      }),
    [diagnostic],
  );
  const editor = useRef<ReactCodeMirrorRef>(null);
  const onChange = useRef(props.onChange);
  useLayoutEffect(() => {
    onChange.current = props.onChange;
  }, [props.onChange]);
  const handleChange = useCallback((value: string) => onChange.current(value), []);
  const [localization] = useState(() => new Compartment());
  // A root reconfigure discards extensions appended by commands (notably search).
  const [extensions] = useState(() => [
    shopify.jsonc(),
    lintGutter(),
    localization.of([policyLinter, phrases]),
  ]);
  useEffect(() => {
    const view = editor.current?.view;
    if (!view) return;
    // Phrase changes redraw panels. Preserve input drafts and focus in addition
    // to the search state retained by the compartment reconfiguration.
    const panel = view.dom.querySelector(".cm-search");
    const active = view.root.activeElement;
    const focused = panel?.contains(active) && active instanceof HTMLElement ? active : null;
    const inputs = Array.from(panel?.querySelectorAll("input") ?? [], (input) => ({
      name: input.name,
      value: input.value,
      checked: input.checked,
      start: input.selectionStart,
      end: input.selectionEnd,
      direction: input.selectionDirection,
    }));
    // Commit a pending input change before redraw removes the focused field;
    // its native change handler must not dispatch inside CodeMirror's update.
    focused?.blur();
    view.dispatch({ effects: localization.reconfigure([policyLinter, phrases]) });
    const updatedPanel = view.dom.querySelector(".cm-search");
    for (const saved of inputs) {
      const input = updatedPanel?.querySelector<HTMLInputElement>(`input[name=${saved.name}]`);
      if (!input) continue;
      input.value = saved.value;
      input.checked = saved.checked;
      if (saved.start !== null && saved.end !== null) {
        input.setSelectionRange(saved.start, saved.end, saved.direction ?? undefined);
      }
    }
    if (focused) {
      updatedPanel
        ?.querySelector<HTMLElement>(`${focused.tagName}[name=${focused.getAttribute("name")}]`)
        ?.focus({ preventScroll: true });
    } else if (active instanceof HTMLElement && active.isConnected) {
      active.focus({ preventScroll: true });
    }
  }, [localization, policyLinter, phrases]);

  const isEmpty = props.value.trim().length === 0;
  const parsed = parsePolicy(props.value);
  const status = !parsed.ok
    ? { Icon: CircleX, label: diagnostic(parsed.error), className: "text-bad" }
    : isEmpty
      ? { Icon: CircleDashed, label: t("policy.editor.empty"), className: "text-muted" }
      : { Icon: CircleCheck, label: t("policy.editor.valid"), className: "text-ok" };

  return (
    <div className="text-sm">
      <ErrorBoundary
        fallback={
          <div className="flex flex-col items-center gap-2.5 py-8">
            <CircleX />
            <p className="text-lg font-semibold">{t("policy.editor.loadFailed")}</p>
          </div>
        }
      >
        <div className="border-line bg-surface flex items-center justify-between gap-4 border-b px-3 py-2">
          <div role="status" className={cn("flex min-w-0 items-center gap-2", status.className)}>
            <status.Icon className="size-4 shrink-0" />
            <span className="truncate">{status.label}</span>
          </div>
          <Button
            disabled={props.isDisabled || isEmpty || !parsed.ok}
            onClick={() => {
              const result = formatPolicy(props.value);
              if (result.ok) props.onChange(result.value);
            }}
            size="sm"
            type="button"
          >
            <Braces className="size-4" />
            {t("policy.editor.format")}
          </Button>
        </div>
        <CodeMirror
          ref={editor}
          editable={!props.isDisabled}
          extensions={extensions}
          minHeight="24rem"
          maxHeight="var(--height-editor)"
          onChange={handleChange}
          readOnly={props.isDisabled}
          theme={headplaneTheme}
          value={props.value}
        />
      </ErrorBoundary>
    </div>
  );
}

interface DifferProps {
  left: string;
  right: string;
}

export function Differ(props: DifferProps) {
  const { t } = useI18n();
  const phrases = useEditorPhrases();
  return (
    <div className="text-sm">
      {props.left === props.right ? (
        <div className="flex flex-col items-center gap-2.5 py-8">
          <BookCopy />
          <p className="text-lg font-semibold">{t("policy.editor.noChanges")}</p>
        </div>
      ) : (
        <div className="h-editor">
          <ErrorBoundary
            fallback={
              <div className="flex flex-col items-center gap-2.5 py-8">
                <CircleX />
                <p className="text-lg font-semibold">{t("policy.editor.loadFailed")}</p>
              </div>
            }
          >
            <Merge orientation="a-b" theme={headplaneTheme}>
              <Merge.Original extensions={[shopify.jsonc(), phrases]} readOnly value={props.left} />
              <Merge.Modified
                extensions={[shopify.jsonc(), phrases]}
                readOnly
                value={props.right}
              />
            </Merge>
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}

// CodeMirror uses its own phrase placeholders ($), which must stay intact.
function useEditorPhrases() {
  const { t } = useI18n();
  return useMemo(
    () =>
      EditorState.phrases.of({
        Find: t("policy.editor.phrases.find"),
        Replace: t("policy.editor.phrases.replaceInput"),
        next: t("policy.editor.phrases.next"),
        previous: t("policy.editor.phrases.previous"),
        all: t("policy.editor.phrases.all"),
        "match case": t("policy.editor.phrases.matchCase"),
        regexp: t("policy.editor.phrases.regexp"),
        "by word": t("policy.editor.phrases.byWord"),
        replace: t("policy.editor.phrases.replace"),
        "replace all": t("policy.editor.phrases.replaceAll"),
        close: t("policy.editor.phrases.close"),
        "Go to line": t("policy.editor.phrases.goToLine"),
        go: t("policy.editor.phrases.go"),
        "replaced match on line $": t("policy.editor.phrases.replacedLine"),
        "replaced $ matches": t("policy.editor.phrases.replacedMatches"),
        "current match": t("policy.editor.phrases.currentMatch"),
        "on line": t("policy.editor.phrases.onLine"),
        Diagnostics: t("policy.editor.phrases.diagnostics"),
        "No diagnostics": t("policy.editor.phrases.noDiagnostics"),
        "Selection deleted": t("policy.editor.phrases.selectionDeleted"),
        "Folded lines": t("policy.editor.phrases.foldedLines"),
        "Unfolded lines": t("policy.editor.phrases.unfoldedLines"),
        to: t("policy.editor.phrases.to"),
        "folded code": t("policy.editor.phrases.foldedCode"),
        unfold: t("policy.editor.phrases.unfold"),
        "Fold line": t("policy.editor.phrases.foldLine"),
        "Unfold line": t("policy.editor.phrases.unfoldLine"),
        Completions: t("policy.editor.phrases.completions"),
        "Control character": t("policy.editor.phrases.controlCharacter"),
        "$ unchanged lines": t("policy.editor.phrases.unchangedLines"),
        "Revert this chunk": t("policy.editor.phrases.revertChunk"),
        Accept: t("policy.editor.phrases.accept"),
        Reject: t("policy.editor.phrases.reject"),
      }),
    [t],
  );
}
