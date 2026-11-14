import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { createRequestHandler, RouterContextProvider, type ServerBuild } from "react-router";
import { expect, test } from "vitest";

import { getLocale } from "~/i18n/locale.server";
import { action } from "~/routes/util/locale";
import { headplaneConfig } from "~/server/config/config-schema";
import { appConfigContext } from "~/server/context";

import { alignOriginScheme } from "../../runtime/http";

// Keep the production action as a component-free resource route: React Router's
// document/data action Origin check does not protect this request path.
function localeHandler(basename = "/admin") {
  const build = {
    basename,
    ssr: true,
    isSpaMode: false,
    future: {},
    prerender: [],
    publicPath: "/assets/",
    assetsBuildDirectory: "build/client",
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
    assets: {
      version: "locale-origin-test",
      url: "/manifest.js",
      entry: { module: "/entry.js", imports: [] },
      routes: {},
    },
    entry: {
      module: {
        default() {
          throw new Error("Locale requests must use the resource action");
        },
      },
    },
    routes: {
      locale: {
        id: "locale",
        path: "api/locale",
        // ServerRouteModule requires a component even for resource routes.
        module: { action } as NonNullable<ServerBuild["routes"][string]>["module"],
      },
    },
  } satisfies ServerBuild;
  return createRequestHandler(build, "test");
}

function localeContext(baseUrl?: string) {
  const context = new RouterContextProvider();
  context.set(
    appConfigContext,
    headplaneConfig.assert({
      server: {
        cookie_secret: "a".repeat(32),
        ...(baseUrl ? { base_url: baseUrl } : {}),
      },
      headscale: { url: "http://headscale.test" },
    }),
  );
  return context;
}

function localeRequest(
  headers: HeadersInit = {},
  url = "http://headplane.test/admin/api/locale",
  locale = "zh-CN",
) {
  return new Request(url, {
    method: "POST",
    headers,
    body: new URLSearchParams({ locale, returnTo: "/machines?name=demo%20server#details" }),
  });
}

test("resource language action rejects a foreign HTTP Origin without Fetch Metadata", async () => {
  const request = localeRequest({ Origin: "http://foreign.test" });
  expect(request.headers.has("Sec-Fetch-Site")).toBe(false);
  const response = await localeHandler()(request, localeContext());
  expect(response.status).toBe(403);
  expect(response.headers.has("Set-Cookie")).toBe(false);
  expect(response.headers.has("Location")).toBe(false);
});

test("configured public origin survives the runtime's same-host TLS scheme alignment", async () => {
  const incoming = new IncomingMessage(new Socket());
  incoming.headers = { host: "dashboard.example", origin: "https://dashboard.example" };
  alignOriginScheme(incoming);
  expect(incoming.headers.origin).toBe("http://dashboard.example");
  const response = await localeHandler()(
    localeRequest(
      { Origin: incoming.headers.origin! },
      "http://dashboard.example/admin/api/locale",
    ),
    localeContext("https://dashboard.example/admin"),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("Set-Cookie")).toContain("headplane_locale=");
});

test.each(["/", "/admin", "/console/nested"])(
  "same-origin HTTP preference requests preserve basename %s without Fetch Metadata",
  async (basename) => {
    const prefix = basename === "/" ? "" : basename;
    const url = `http://headplane.test${prefix}/api/locale`;
    const handler = localeHandler(basename);
    const context = localeContext();
    expect(await getLocale(new Request(url, { headers: { "Accept-Language": "zh-CN" } }))).toBe(
      "en",
    );
    let cookie = "";
    for (const locale of ["zh-CN", "en"]) {
      const request = localeRequest(
        { Origin: "http://headplane.test", Cookie: cookie },
        url,
        locale,
      );
      expect(request.headers.has("Sec-Fetch-Site")).toBe(false);
      const response = await handler(request, context);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `${prefix}/machines?name=demo%20server#details`,
      );
      expect(response.headers.getSetCookie()).toHaveLength(1);
      cookie = response.headers.get("Set-Cookie")!.split(";")[0];
      expect(cookie).toMatch(/^headplane_locale=/);
      expect(await getLocale(new Request(url, { headers: { Cookie: cookie } }))).toBe(locale);
    }
  },
);

test("configured HTTPS public origin is accepted through a different internal HTTP host", async () => {
  const response = await localeHandler("/console/nested")(
    localeRequest(
      {
        Origin: "https://dashboard.example",
        Forwarded: "host=foreign.test;proto=http",
        "X-Forwarded-Host": "foreign.test",
        "X-Forwarded-Proto": "http",
      },
      "http://headplane.test/console/nested/api/locale",
    ),
    localeContext("https://dashboard.example/console/nested"),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(
    "/console/nested/machines?name=demo%20server#details",
  );
  expect(
    await getLocale(
      new Request("https://dashboard.example/console/nested/machines", {
        headers: { Cookie: response.headers.get("Set-Cookie")! },
      }),
    ),
  ).toBe("zh-CN");
});

test.each([undefined, "https://dashboard.example/admin"])(
  "forwarded headers cannot authorize a foreign Origin (base_url: %s)",
  async (baseUrl) => {
    const handler = localeHandler();
    for (const fetchSite of [undefined, "same-site", "same-origin"]) {
      const headers = new Headers({
        Origin: "https://foreign.test",
        Forwarded: "host=foreign.test;proto=https",
        "X-Forwarded-Host": "foreign.test",
        "X-Forwarded-Proto": "https",
      });
      if (fetchSite) headers.set("Sec-Fetch-Site", fetchSite);
      const response = await handler(localeRequest(headers), localeContext(baseUrl));
      expect(response.status).toBe(403);
      expect(response.headers.has("Set-Cookie")).toBe(false);
      expect(response.headers.has("Location")).toBe(false);
    }
  },
);

test.each([
  "http://headplane.test",
  "http://dashboard.example",
  "https://dashboard.example:8443",
  "null",
  "",
  "not-an-origin",
  "https://dashboard.example/path",
  "https://dashboard.example https://foreign.test",
])("configured public URL rejects noncanonical or invalid Origin %s", async (origin) => {
  const response = await localeHandler()(
    localeRequest({ Origin: origin }),
    localeContext("https://dashboard.example/admin"),
  );
  expect(response.status).toBe(403);
  expect(response.headers.has("Set-Cookie")).toBe(false);
});

test("scheme alignment does not accept another port on the public hostname", async () => {
  const response = await localeHandler()(
    localeRequest(
      { Origin: "http://dashboard.example:3000" },
      "http://dashboard.example:3000/admin/api/locale",
    ),
    localeContext("https://dashboard.example/admin"),
  );
  expect(response.status).toBe(403);
  expect(response.headers.has("Set-Cookie")).toBe(false);
});

test("without a public URL the complete request origin must match", async () => {
  const response = await localeHandler()(
    localeRequest({ Origin: "https://headplane.test" }),
    localeContext(),
  );
  expect(response.status).toBe(403);
  expect(response.headers.has("Set-Cookie")).toBe(false);
});

test("cross-site Fetch Metadata still rejects a matching public Origin", async () => {
  const response = await localeHandler()(
    localeRequest({ Origin: "https://dashboard.example", "Sec-Fetch-Site": "cross-site" }),
    localeContext("https://dashboard.example/admin"),
  );
  expect(response.status).toBe(403);
  expect(response.headers.has("Set-Cookie")).toBe(false);
});

test("resource preference requests without browser source headers remain supported", async () => {
  const response = await localeHandler()(
    localeRequest(),
    localeContext("https://dashboard.example/admin"),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("Set-Cookie")).toContain("headplane_locale=");
});
