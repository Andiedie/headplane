import type { ActionFunctionArgs } from "react-router";
import { expect, test } from "vitest";

import { getLocale } from "~/i18n/locale.server";
import { action } from "~/routes/util/locale";

async function changeLanguage(locale: string, returnTo = "/machines?sort=name") {
  return action({
    request: new Request("http://localhost/admin/api/locale", {
      method: "POST",
      body: new URLSearchParams({ locale, returnTo }),
    }),
  } as ActionFunctionArgs);
}

test("a signed-out visitor can select Chinese and retain the current page", async () => {
  const response = await changeLanguage("zh-CN");
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/machines?sort=name");
  expect(
    await getLocale(
      new Request("http://localhost/admin/login", {
        headers: { Cookie: response.headers.get("Set-Cookie")! },
      }),
    ),
  ).toBe("zh-CN");
});

test.each([
  "//example.com",
  "/\\example.com",
  "/%5cexample.com",
  "/%2fexample.com",
  "/%0d%0aLocation:evil",
  "https://example.com",
  "javascript:alert(1)",
  "/%",
  "/".repeat(2049),
])("language changes reject unsafe return paths: %s", async (target) => {
  const response = await changeLanguage("zh-CN", target);
  expect(response.headers.get("Location")).toBe("/");
});

test("language switching preserves encoded search filters and fragments", async () => {
  const target = "/machines?name=demo%20server#details";
  expect((await changeLanguage("en", target)).headers.get("Location")).toBe(target);
});

test.each(["", "fr", "zh", "__proto__"])(
  "unsupported locale %s cannot set a cookie",
  async (locale) => {
    await expect(changeLanguage(locale)).rejects.toMatchObject({ init: { status: 400 } });
  },
);

test("cross-site browser requests cannot replace a display preference", async () => {
  await expect(
    action({
      request: new Request("http://localhost/admin/api/locale", {
        method: "POST",
        headers: { "Sec-Fetch-Site": "cross-site" },
        body: new URLSearchParams({ locale: "zh-CN" }),
      }),
    } as ActionFunctionArgs),
  ).rejects.toMatchObject({ init: { status: 403 } });
});
