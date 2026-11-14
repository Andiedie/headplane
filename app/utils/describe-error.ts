import { isRouteErrorResponse } from "react-router";

import { translate, type Locale, type MessageKey, type MessageValues } from "~/i18n";
import { isApiError, isConnectionError } from "~/server/headscale/api/error-client";

export interface ErrorInfo {
  kind: "connection" | "forbidden" | "not_found" | "headscale" | "unknown";
  title: string;
  description: string;
  details?: string;
}

export function describeError(error: unknown, locale: Locale = "en"): ErrorInfo {
  const t = (key: MessageKey, values?: MessageValues) => translate(locale, key, values);
  if (isRouteErrorResponse(error)) {
    const { data, status, statusText } = error;
    if (isConnectionError(data)) {
      return {
        kind: "connection",
        title: t("components.errors.connectionTitle"),
        description: t("components.errors.connectionDescription"),
        details: lines(data.requestUrl, data.errorMessage || data.errorCode),
      };
    }

    if (isApiError(data)) {
      const details = lines(
        `${data.statusCode} ${data.requestUrl}`,
        data.data != null ? json(data.data) : data.rawData,
      );

      if (data.statusCode >= 500) {
        return {
          kind: "headscale",
          title: t("components.errors.headscaleTitle"),
          description: t("components.errors.headscaleDescription", { status: data.statusCode }),
          details,
        };
      }

      if (data.statusCode === 401 || data.statusCode === 403) {
        return {
          kind: "headscale",
          title: t("components.errors.rejectedTitle"),
          description: t("components.errors.rejectedDescription"),
          details,
        };
      }

      return {
        kind: "headscale",
        title: t("components.errors.unexpectedTitle"),
        description: t("components.errors.unexpectedDescription"),
        details,
      };
    }

    if (status === 404) {
      return {
        kind: "not_found",
        title: t("components.errors.notFoundTitle"),
        description: t("components.errors.notFoundDescription"),
      };
    }

    const message = messageOf(data);

    if (status === 403) {
      return {
        kind: "forbidden",
        title: t("components.errors.forbiddenTitle"),
        description: message ?? t("components.errors.forbiddenDescription"),
      };
    }

    return {
      kind: "unknown",
      title: t("components.errors.unknownTitle"),
      description:
        message ??
        t("components.errors.serverResponse", {
          status: [status, statusText].filter(Boolean).join(" "),
        }),
    };
  }

  if (error instanceof Error) {
    let root = error;
    while (root.cause instanceof Error) {
      root = root.cause;
    }

    const message =
      root instanceof AggregateError
        ? root.errors.map((e) => (e instanceof Error ? e.message : String(e))).join("\n")
        : root.message;

    return {
      kind: "unknown",
      title: t("components.errors.unknownTitle"),
      description: t("components.errors.bug"),
      details: `${root.name}: ${message}`,
    };
  }

  return {
    kind: "unknown",
    title: t("components.errors.unknownTitle"),
    description: t("components.errors.bug"),
    details: json(error),
  };
}

function messageOf(data: unknown) {
  if (typeof data === "string" && data.length > 0) {
    return data;
  }

  if (typeof data === "object" && data !== null && "message" in data) {
    return typeof data.message === "string" ? data.message : undefined;
  }
}

function lines(...parts: (string | undefined)[]) {
  return parts.filter(Boolean).join("\n\n");
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}
