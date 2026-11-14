import { useCallback } from "react";

import type { MessageKey } from "~/i18n";
import { useI18n } from "~/i18n/react";

// Translate the parser's known diagnostics at the display boundary. Unknown
// messages stay verbatim, and the parser and policy document stay locale-free.
const DIAGNOSTICS: Readonly<Record<string, MessageKey>> = {
  "Invalid symbol": "policy.diagnostics.invalidSymbol",
  "Invalid number format": "policy.diagnostics.invalidNumberFormat",
  "Property name expected": "policy.diagnostics.propertyNameExpected",
  "Value expected": "policy.diagnostics.valueExpected",
  "Colon expected": "policy.diagnostics.colonExpected",
  "Comma expected": "policy.diagnostics.commaExpected",
  "Close brace expected": "policy.diagnostics.closeBraceExpected",
  "Close bracket expected": "policy.diagnostics.closeBracketExpected",
  "End of file expected": "policy.diagnostics.endOfFileExpected",
  "Invalid comment token": "policy.diagnostics.invalidCommentToken",
  "Unexpected end of comment": "policy.diagnostics.unexpectedEndOfComment",
  "Unexpected end of string": "policy.diagnostics.unexpectedEndOfString",
  "Unexpected end of number": "policy.diagnostics.unexpectedEndOfNumber",
  "Invalid unicode": "policy.diagnostics.invalidUnicode",
  "Invalid escape character": "policy.diagnostics.invalidEscapeCharacter",
  "Invalid character": "policy.diagnostics.invalidCharacter",
  "The policy must be a JSON object": "policy.diagnostics.objectRequired",
};

export function usePolicyDiagnostic() {
  const { t } = useI18n();
  return useCallback(
    (diagnostic: string) => {
      const location = /^(.*) at line (\d+), column (\d+)$/.exec(diagnostic);
      const message = location?.[1] ?? diagnostic;
      if (!Object.hasOwn(DIAGNOSTICS, message)) return diagnostic;
      const key = DIAGNOSTICS[message];
      return location
        ? t("policy.diagnostics.location", {
            message: t(key),
            line: location[2],
            column: location[3],
          })
        : t(key);
    },
    [t],
  );
}
