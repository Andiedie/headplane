import { createStaticHandler, type ActionFunction, type LoaderFunction } from "react-router";
import { expect, test } from "vitest";

import { setLocale } from "~/i18n/locale.server";
import { loader as rootLoader } from "~/root";
import routeConfig from "~/routes";

const modules = import.meta.glob<{ loader: LoaderFunction; action: ActionFunction }>(
  "/app/routes/*.tsx",
);

test.each(["GET", "POST"])(
  "an unknown %s URL retains the chosen language on its 404 response",
  async (method) => {
    const fallback = routeConfig.find((route) => route.path === "*");
    const module = fallback ? await modules[`/app/${fallback.file}`]() : undefined;
    const children =
      fallback && module
        ? [{ path: fallback.path, loader: module.loader, action: module.action }]
        : [];
    const handler = createStaticHandler([{ id: "root", loader: rootLoader, children }], {
      basename: "/admin",
    });
    const result = await handler.query(
      new Request("http://localhost/admin/unrecognized-page", {
        method,
        headers: { Cookie: (await setLocale("zh-CN")).split(";")[0] },
      }),
    );
    if (result instanceof Response) throw new Error("Expected a document context for the 404 page");
    expect(result.statusCode).toBe(404);
    expect(result.loaderData.root).toMatchObject({ locale: "zh-CN" });
  },
);
