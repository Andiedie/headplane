import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { Locale } from "~/i18n";
import { I18nProvider } from "~/i18n/react";
import { OidcConfigErrorNotice } from "~/routes/auth/login/config-error";
import { OidcErrorNotice } from "~/routes/auth/login/oidc-error";
import Login from "~/routes/auth/login/page";
import AuthKeyRow from "~/routes/settings/auth-keys/auth-key-row";
import { ErrorBoundary as RestrictionsError } from "~/routes/settings/restrictions/overview";
import RestrictionSection from "~/routes/settings/restrictions/restriction-section";
import { SSHError, isSSHError, sshErrors } from "~/routes/ssh/errors";
import UserPrompt from "~/routes/ssh/user-prompt";
import type { PreAuthKey } from "~/types";

function render(element: ReactElement, locale?: Locale) {
  const router = createMemoryRouter([
    {
      path: "*",
      element: locale ? createElement(I18nProvider, { locale, children: element }) : element,
    },
  ]);
  try {
    return renderToStaticMarkup(createElement(RouterProvider, { router }));
  } finally {
    router.dispose();
  }
}

function text(markup: string) {
  return markup
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"');
}

describe("Auth, Settings and Browser SSH locale behavior", () => {
  it("keeps default English SSO errors and translates the explanation without changing the sub claim", () => {
    const notice = createElement(OidcErrorNotice, { code: "error_no_sub" });
    const english = render(notice);
    expect(text(english)).toContain("The SSO provider did not return a valid user identifier.");
    expect(english).toMatch(/<code[^>]*>sub<\/code>/);
    const chinese = render(notice, "zh-CN");
    expect(text(chinese)).toContain("SSO 提供方未返回有效的用户标识。");
    expect(chinese).toMatch(/<code[^>]*>sub<\/code>/);
    expect(text(chinese)).not.toContain("The SSO provider did not return");
  });

  it("preserves the OIDC configuration identifier and troubleshooting link in Chinese", () => {
    const markup = render(
      createElement(OidcConfigErrorNotice, { errors: ["invalid_api_key"] }),
      "zh-CN",
    );
    expect(text(markup)).toContain("用于 OIDC 认证的 API 密钥无效。");
    expect(markup).toMatch(/<code[^>]*>headscale\.api_key<\/code>/);
    expect(markup).toContain('href="https://headplane.net/features/sso#troubleshooting"');
  });

  it("translates login errors while preserving the password field protocol", () => {
    const loaderData: Parameters<typeof Login>[0]["loaderData"] = {
      isCookieSecureEnabled: false,
      isOidcConnectorEnabled: false,
      oidcErrorCodes: [],
      urlState: undefined,
    };
    const page = createElement(Login, {
      loaderData,
      actionData: { success: false, message: "That API key is invalid or has expired." },
      params: {},
      matches: [
        {
          id: "root",
          params: {},
          pathname: "/",
          loaderData: { colorScheme: "light", locale: "en" },
          handle: undefined,
        },
        {
          id: "routes/auth/login/page",
          params: {},
          pathname: "/login",
          loaderData,
          handle: undefined,
        },
      ],
    });
    const english = render(page);
    expect(text(english)).toContain("Sign in with API key");
    expect(text(english)).toContain("That API key is invalid or has expired.");
    const chinese = render(page, "zh-CN");
    expect(text(chinese)).toContain("使用 API 密钥登录");
    expect(text(chinese)).toContain("该 API 密钥无效或已过期。");
    expect(chinese).toContain('name="api_key"');
    expect(chinese).toContain('type="password"');
    expect(chinese).toContain('placeholder="hskey-api-…"');
  });

  it("renders auth key times in the selected locale without translating key bytes or tags", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T12:00:00Z"));
    try {
      const key: PreAuthKey = {
        id: "1",
        key: "key-byte-preservation",
        user: null,
        reusable: false,
        ephemeral: true,
        used: true,
        aclTags: ["tag:server"],
        expiration: "2026-01-02T12:00:00Z",
        createdAt: "2026-01-01T12:00:00Z",
      };
      const element = createElement(
        "table",
        null,
        createElement("tbody", null, createElement(AuthKeyRow, { authKey: key, user: null })),
      );
      const english = text(render(element));
      expect(english).toContain("Expired yesterday");
      expect(english).toContain("Tags only");
      const chinese = render(element, "zh-CN");
      expect(text(chinese)).toContain("已于");
      expect(text(chinese)).toContain("过期");
      expect(text(chinese)).not.toContain("day ago");
      expect(chinese).toContain('title="' + new Date(key.expiration).toLocaleString("zh-CN") + '"');
      expect(chinese).toContain("key-byte-preservation");
      expect(chinese).toContain("tag:server");
    } finally {
      vi.useRealTimers();
    }
  });

  it("translates empty restriction explanations without altering identity-provider values", () => {
    const empty = createElement(RestrictionSection, {
      type: "domain",
      values: [],
      isDisabled: true,
    });
    expect(text(render(empty))).toContain("Any email domain can sign in.");
    expect(text(render(empty, "zh-CN"))).toContain("允许使用任意域名邮箱的用户登录。");
    const group = createElement(RestrictionSection, {
      type: "group",
      values: ["admin&ops"],
      isDisabled: true,
    });
    expect(render(group, "zh-CN")).toContain("admin&amp;ops");
  });

  it("translates owned restriction loader errors while preserving unknown diagnostic text", () => {
    const error = {
      status: 501,
      statusText: "Not Implemented",
      internal: false,
      data: "OIDC is not configured on this Headscale instance.",
    };
    const known = createElement(RestrictionsError, { error } as Parameters<
      typeof RestrictionsError
    >[0]);
    expect(text(render(known))).toContain("OIDC is not configured on this Headscale instance.");
    expect(text(render(known, "zh-CN"))).toContain("此 Headscale 实例尚未配置 OIDC。");
    const upstream = createElement(RestrictionsError, {
      error: { ...error, data: "opaque upstream diagnostic" },
    } as Parameters<typeof RestrictionsError>[0]);
    expect(text(render(upstream, "zh-CN"))).toContain("opaque upstream diagnostic");
  });

  it("localizes SSH errors using raw hostname metadata and escapes user-controlled text", () => {
    const hostname = "<web>&{hostname}";
    const error = sshErrors.node_not_found(hostname);
    expect(isSSHError(error)).toBe(true);
    expect(isSSHError({ ...error, hostname: {} })).toBe(false);
    const english = render(createElement(SSHError, error));
    expect(text(english)).toContain("Machine not found");
    const chinese = render(createElement(SSHError, error), "zh-CN");
    expect(text(chinese)).toContain("找不到设备");
    expect(chinese).toContain("&lt;web&gt;&amp;{hostname}");
    expect(chinese).not.toContain("<web>");
    expect(chinese).toContain('href="https://headplane.net/features/ssh#node-not-found"');
    const prompt = render(createElement(UserPrompt, { hostname }), "zh-CN");
    expect(prompt).toContain('name="user"');
    expect(prompt).toContain("&lt;web&gt;&amp;{hostname}");
    expect(text(prompt)).toContain("用户名");
  });
});
