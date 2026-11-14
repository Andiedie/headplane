import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";

import LanguageSwitcher from "~/components/language-switcher";
import type { Locale } from "~/i18n";
import { I18nProvider } from "~/i18n/react";

test.each<[Locale, string]>([
  ["en", "Language"],
  ["zh-CN", "语言"],
])("the %s language control exposes its accessible name", (locale, label) => {
  const router = createMemoryRouter([{ path: "*", element: createElement(LanguageSwitcher) }]);
  try {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        locale,
        children: createElement(RouterProvider, { router }),
      }),
    );
    expect(html).toContain(`aria-label="${label}"`);
  } finally {
    router.dispose();
  }
});
