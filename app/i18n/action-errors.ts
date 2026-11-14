import { translate, type Locale } from "~/i18n";
import { en } from "~/i18n/messages/errors";
import {
  headscaleErrorMessage,
  isApiError,
  isConnectionError,
} from "~/server/headscale/api/error-client";
import type { FormErrors } from "~/utils/form";

// Shared schemas keep their English diagnostics. Match only complete messages
// explicitly owned by those schemas, never fragments or arbitrary API bodies.
const validationKeys = new Map(
  Object.entries(en)
    .filter(([key]) => key.startsWith("errors.validation."))
    .map(([key, message]) => [message as string, key as keyof typeof en]),
);

export function translateValidationMessage(locale: Locale, message: string): string {
  const key = validationKeys.get(message);
  return key ? translate(locale, key) : message;
}

export function translateValidationErrors(locale: Locale, errors: FormErrors): FormErrors {
  return Object.fromEntries(
    Object.entries(errors).map(([field, message]) => [
      field,
      translateValidationMessage(locale, message),
    ]),
  );
}

export function localizedHeadscaleErrorMessage(error: unknown, locale: Locale): string | undefined {
  if (error != null && typeof error === "object" && "data" in error) {
    if (isConnectionError(error.data)) {
      return translate(locale, "errors.headscaleUnavailable");
    }
    if (isApiError(error.data)) {
      const { data, rawData, statusCode } = error.data;
      if (!(typeof data?.message === "string" && data.message.length > 0) && rawData.length === 0) {
        return translate(locale, "errors.headscaleRejected", { status: statusCode });
      }
    }
  }

  // Preserve the established diagnostic formatting for unknown upstream errors.
  return headscaleErrorMessage(error);
}
