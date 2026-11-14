import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";

import { ExpiryTag } from "~/components/tags/Expiry";
import { I18nProvider } from "~/i18n/react";
import { describeError } from "~/utils/describe-error";

function render(element: ReactElement, locale?: "en" | "zh-CN") {
  const router = createMemoryRouter([{ path: "/", element }]);
  const page = createElement(RouterProvider, { router });
  try {
    return renderToStaticMarkup(
      locale ? createElement(I18nProvider, { locale, children: page }) : page,
    );
  } finally {
    router.dispose();
  }
}

function routeError(status: number, data: unknown) {
  return { status, statusText: "Upstream status", internal: false, data };
}

test("error localization preserves classification and raw diagnostics with an English default", () => {
  const errors = [
    routeError(502, {
      requestUrl: "GET /api/v1/node",
      errorCode: "ECONNREFUSED",
      errorMessage: "connect ECONNREFUSED",
      extraData: null,
    }),
    ...[401, 403, 422, 500].map((statusCode) =>
      routeError(statusCode, {
        requestUrl: "POST /api/v1/node",
        statusCode,
        rawData: "upstream original",
        data: null,
      }),
    ),
    routeError(404, undefined),
    routeError(403, undefined),
    routeError(503, undefined),
    new Error("outer", { cause: new Error("unexpected tag:prod") }),
    { unexpected: "original-value" },
  ];

  for (const error of errors) {
    const english = describeError(error);
    const chinese = describeError(error, "zh-CN");
    expect(chinese.kind).toBe(english.kind);
    expect(chinese.details).toBe(english.details);
    expect(chinese.title).not.toBe(english.title);
    expect(chinese.description).not.toBe(english.description);
    expect(describeError(error, "en")).toEqual(english);
  }

  expect(describeError(errors[0]).title).toBe("Can't reach Headscale");
  expect(describeError(errors[4], "zh-CN").description).toContain("500");
  expect(describeError(errors[8], "zh-CN").details).toBe("Error: unexpected tag:prod");
  expect(
    describeError(routeError(403, "Administrator supplied message"), "zh-CN").description,
  ).toBe("Administrator supplied message");
  expect(
    describeError(routeError(503, { message: "Opaque upstream message" }), "zh-CN").description,
  ).toBe("Opaque upstream message");
});

test("expiry badges format their relative time in the current locale", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  try {
    const badge = createElement(ExpiryTag, { variant: "expiring", expiry: "2026-01-04T12:00:00Z" });
    expect(render(badge)).toContain("Key expires in 3 days");
    expect(render(badge, "zh-CN")).toContain("密钥3天后过期");
  } finally {
    vi.useRealTimers();
  }
});
