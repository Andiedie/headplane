import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createCookie } from "react-router";
import { expect, test, vi } from "vitest";

import { interpolate, translate } from "~/i18n";
import { getLocale } from "~/i18n/locale.server";
import { I18nProvider, Trans, useI18n } from "~/i18n/react";
import { loader } from "~/root";
import { formatTimeDelta } from "~/utils/time";

test("the root loader uses the selected language for the initial server render", async () => {
  const cookie = await createCookie("headplane_locale").serialize("zh-CN");
  const result = await loader({
    request: new Request("http://localhost/admin/login", { headers: { Cookie: cookie } }),
  } as Parameters<typeof loader>[0]);

  expect(result).toMatchObject({ locale: "zh-CN" });
});

test("missing and malformed language preferences preserve English", async () => {
  for (const Cookie of [
    "",
    "headplane_locale=invalid",
    await createCookie("headplane_locale").serialize("fr"),
    await createCookie("headplane_locale").serialize({ locale: "zh-CN" }),
  ]) {
    expect(
      await getLocale(
        new Request("http://localhost", { headers: { Cookie, "Accept-Language": "zh-CN" } }),
      ),
    ).toBe("en");
  }
});

test("separate server renders do not leak language preferences", async () => {
  function Label() {
    const { t } = useI18n();
    return createElement("span", null, t("common.settings"));
  }
  const languages = await Promise.all(
    ["zh-CN", "en", "zh-CN", "en"].map(async (locale) =>
      getLocale(
        new Request("http://localhost", {
          headers: { Cookie: await createCookie("headplane_locale").serialize(locale) },
        }),
      ),
    ),
  );
  expect(
    languages.map((locale) =>
      renderToStaticMarkup(createElement(I18nProvider, { locale, children: createElement(Label) })),
    ),
  ).toEqual([
    "<span>设置</span>",
    "<span>Settings</span>",
    "<span>设置</span>",
    "<span>Settings</span>",
  ]);
});

test("untranslated messages fall back to English rather than exposing a key", () => {
  expect(translate("zh-CN", "common.dns")).toBe("DNS");
});

test("interpolation preserves user values without recursively interpreting placeholders", () => {
  expect(translate("zh-CN", "common.signedInAs", { name: "{name} $&" })).toBe(
    "已登录为 {name} $&。",
  );
  expect(interpolate("{toString} {name}", { name: "Alice" })).toBe("{toString} Alice");
});

test("rich translations preserve markup but escape user-supplied text", () => {
  const html = renderToStaticMarkup(
    createElement(I18nProvider, {
      locale: "zh-CN",
      children: createElement(Trans, {
        id: "common.signedInAs",
        values: { name: createElement("strong", null, "<img src=x onerror=alert(1)>") },
      }),
    }),
  );
  expect(html).toContain("已登录为 <strong>&lt;img");
  expect(html).not.toContain("<img");
});

test("relative time uses the chosen language without changing the English default", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
  try {
    const previous = new Date("2026-01-02T10:00:00Z");
    expect(formatTimeDelta(previous, "zh-CN")).toBe("2小时前");
    expect(formatTimeDelta(previous)).toBe("2 hours ago");
  } finally {
    vi.useRealTimers();
  }
});
