import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { Locale } from "~/i18n";
import { I18nProvider } from "~/i18n/react";
import { LinkUserSelect } from "~/routes/users/dialogs/link-user";

// The loader can give both accounts the same display name. Only the original
// tagged-devices identity should cause the application's label to translate.
const headscaleUsers = [
  { id: "41", name: "Tag-owned", isTaggedDevices: true },
  { id: "42", name: "Tag-owned", isTaggedDevices: false },
];

function render(currentLink: string, locale?: Locale) {
  const select = createElement(LinkUserSelect, { headscaleUsers, currentLink });
  return renderToStaticMarkup(
    locale ? createElement(I18nProvider, { locale, children: select }) : select,
  );
}

function expectSelected(html: string, label: string, id: string) {
  expect(html).toContain(`value="${label}"`);
  const submitted = html
    .match(/<input\b[^>]*>/g)
    ?.find((input) => input.includes('name="headscale_user_id"'));
  expect(submitted).toContain(`value="${id}"`);
}

test("the link selector translates the tagged-devices placeholder while retaining its ID", () => {
  const html = render("41", "zh-CN");
  expectSelected(html, "标签所有（当前）", "41");
  expect(html).toContain("Headscale 用户");
  expect(html).not.toContain('value="Tag-owned（当前）"');
});

test("a real account named Tag-owned retains its name and ID in Chinese", () => {
  expectSelected(render("42", "zh-CN"), "Tag-owned（当前）", "42");
});

test("the link selector defaults to English for both identities", () => {
  for (const id of ["41", "42"]) {
    expectSelected(render(id), "Tag-owned (current)", id);
  }
});
