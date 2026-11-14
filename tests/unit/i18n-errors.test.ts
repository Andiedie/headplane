import { createCookie, RouterContextProvider, type ActionFunctionArgs } from "react-router";
import * as v from "valibot";
import { expect, test } from "vitest";

import { loader as startOidc } from "~/routes/auth/oidc-start";
import { nameserver } from "~/routes/dns/schemas";
import { machineName } from "~/routes/machines/schemas";
import { headplaneConfig } from "~/server/config/config-schema";
import { actionAuditContext, appConfigContext, authContext, oidcContext } from "~/server/context";
import { disabled } from "~/server/feature";
import { createNetworkHistory } from "~/server/network/history";
import { ActionError, createAction } from "~/server/web/actions";
import { Capabilities, type Role } from "~/server/web/roles";
import { ok, parseValues } from "~/utils/form";

import { tempDir } from "../support/temp";
import { createTestAuth } from "./auth/create-auth";

async function actionArgs(
  context: RouterContextProvider,
  locale?: string,
  form: Record<string, string> = { intent: "save" },
): Promise<ActionFunctionArgs> {
  const headers = new Headers();
  if (locale !== undefined) {
    headers.set("Cookie", await createCookie("headplane_locale").serialize(locale));
  }
  const url = new URL("http://headplane.test/machines");
  return {
    request: new Request(url, { method: "POST", headers, body: new URLSearchParams(form) }),
    url,
    pattern: "/machines",
    params: {},
    context,
  };
}

async function authenticatedContext(role: Role = "owner") {
  const { auth, db } = createTestAuth();
  let userId = await auth.findOrCreateUser("owner");
  if (role !== "owner") {
    userId = await auth.findOrCreateUser(role);
    await auth.reassignUser(userId, role);
  }
  const cookie = await auth.createOidcSession(userId, { name: "Owner" });
  const principal = await auth.require(
    new Request("http://headplane.test", { headers: { Cookie: cookie } }),
  );
  const context = new RouterContextProvider();
  context.set(authContext, auth);
  context.set(actionAuditContext, undefined);
  return { auth, db, principal, context, userId };
}

test("localizes the same action error per concurrent request while preserving its diagnostic and status", async () => {
  const { db, principal, context, userId } = await authenticatedContext();
  const history = createNetworkHistory(db, { enabled: true, retention_days: 7 });
  context.set(actionAuditContext, async (event) => {
    await history.record("action", event.target ?? event.path, { ...event });
  });
  try {
    const error = new ActionError("A user named alice@ already exists.", 409, {
      key: "errors.userExists",
      values: { name: "alice@" },
    });
    const action = createAction({
      async setup() {
        return { principal };
      },
      intents: {
        save: {
          fields: { node_id: v.string() },
          auditTarget: "node_id",
          async handler() {
            throw error;
          },
        },
      },
    });
    const results = await Promise.all(
      ["zh-CN", undefined, "en", "zh-CN", "invalid"].map(async (locale) =>
        action(
          await actionArgs(context, locale, {
            intent: "save",
            node_id: "42",
            name: "private-form-value",
          }),
        ),
      ),
    );
    expect(results).toEqual([
      expect.objectContaining({
        data: { ok: false, errors: { form: "名为 alice@ 的用户已存在。" } },
        init: { status: 409 },
      }),
      expect.objectContaining({
        data: { ok: false, errors: { form: error.message } },
        init: { status: 409 },
      }),
      expect.objectContaining({
        data: { ok: false, errors: { form: error.message } },
        init: { status: 409 },
      }),
      expect.objectContaining({
        data: { ok: false, errors: { form: "名为 alice@ 的用户已存在。" } },
        init: { status: 409 },
      }),
      expect.objectContaining({
        data: { ok: false, errors: { form: error.message } },
        init: { status: 409 },
      }),
    ]);
    expect(error.message).toBe("A user named alice@ already exists.");
    expect((await history.recent("action")).map((entry) => entry.payload)).toEqual(
      results.map(() => ({
        actor: userId,
        intent: "save",
        path: "/machines",
        outcome: "failed",
        target: "42",
      })),
    );
  } finally {
    db.$client.close();
  }
});

test("localizes unavailable OIDC UI text while preserving its raw configuration reason and status", async () => {
  const { db, context } = await authenticatedContext();
  context.set(
    appConfigContext,
    headplaneConfig.assert({
      server: {
        cookie_secret: "test-cookie-secret-thirty-two-ch",
        cookie_secure: false,
        data_path: await tempDir(),
      },
      headscale: { url: "https://headscale.test" },
    }),
  );
  context.set(oidcContext, disabled("OIDC requires server.base_url to be configured"));
  try {
    for (const locale of ["zh-CN", undefined]) {
      const args = await actionArgs(context, locale);
      await expect(startOidc({ ...args, pattern: "/oidc/start" })).rejects.toMatchObject({
        data:
          locale === "zh-CN"
            ? "OIDC 不可用：OIDC requires server.base_url to be configured"
            : "OIDC is unavailable: OIDC requires server.base_url to be configured",
        init: { status: 501 },
      });
    }
  } finally {
    db.$client.close();
  }
});

test("localizes denied capabilities without running the handler or changing role identifiers", async () => {
  for (const role of ["owner", "member"] as const) {
    const { db, principal, context } = await authenticatedContext(role);
    let handled = 0;
    const action = createAction({
      capability: Capabilities.write_users,
      async setup() {
        return { principal };
      },
      intents: {
        save: {
          fields: {},
          async handler() {
            handled += 1;
            return ok(undefined, { role });
          },
        },
      },
    });
    try {
      for (const locale of ["zh-CN", undefined]) {
        const result = await action(await actionArgs(context, locale));
        if (role === "owner") {
          expect(result).toEqual({ ok: true, message: undefined, data: { role: "owner" } });
        } else {
          expect(result).toMatchObject({
            data: {
              ok: false,
              errors: {
                form:
                  locale === "zh-CN"
                    ? "你没有执行此操作的权限。"
                    : "You don't have permission to do this.",
              },
            },
            init: { status: 403 },
          });
        }
      }
      expect(handled).toBe(role === "owner" ? 2 : 0);
    } finally {
      db.$client.close();
    }
  }
});

test("localizes owned validation messages without altering field keys or library diagnostics", async () => {
  const { db, principal, context } = await authenticatedContext();
  const fields = { name: machineName, nameserver, node_id: v.string() };
  const form = { intent: "save", name: "bad name", nameserver: "bad IP" };
  const action = createAction({
    async setup() {
      return { principal };
    },
    intents: {
      save: {
        fields,
        async handler() {
          throw new Error("Validation must run first");
        },
      },
    },
  });
  try {
    const english = parseValues(v.object(fields), form);
    expect(english.ok).toBe(false);
    if (english.ok) throw new Error("Expected invalid input");
    expect(await action(await actionArgs(context, "zh-CN", form))).toMatchObject({
      data: {
        ok: false,
        errors: {
          name: "只能使用字母、数字和连字符，且须以字母或数字开头和结尾。",
          nameserver: "请输入 IPv4 或 IPv6 地址。",
          node_id: english.errors.node_id,
        },
      },
      init: { status: 400 },
    });
    expect(await action(await actionArgs(context, undefined, form))).toMatchObject({
      data: english,
      init: { status: 400 },
    });
    expect(await action(await actionArgs(context, "zh-CN", { intent: "toString" }))).toMatchObject({
      data: { ok: false, errors: { form: "不支持此操作。" } },
      init: { status: 400 },
    });
  } finally {
    db.$client.close();
  }
});

test.each([
  {
    kind: "typed connection fallback",
    error: {
      data: {
        requestUrl: "GET /api/v1/node",
        errorCode: "ECONNREFUSED",
        errorMessage: "connect ECONNREFUSED",
        extraData: null,
      },
    },
    message: "无法连接 Headscale。请确认其正在运行，然后重试。",
  },
  {
    kind: "empty upstream body fallback",
    error: {
      data: { requestUrl: "POST /api/v1/node", statusCode: 502, rawData: "", data: null },
    },
    message: "Headscale 拒绝了此更改（502）。",
  },
  {
    kind: "raw upstream body matching an owned validation string",
    error: {
      data: {
        requestUrl: "POST /api/v1/node",
        statusCode: 400,
        rawData: "Enter a domain.",
        data: null,
      },
    },
    message: "Enter a domain.",
  },
  {
    kind: "structured upstream diagnostic",
    error: {
      data: {
        requestUrl: "POST /api/v1/node",
        statusCode: 400,
        rawData: "raw",
        data: { message: "unknown field grants: tag:prod" },
      },
    },
    message: "Unknown field grants: tag:prod",
  },
  {
    kind: "unannotated ActionError",
    error: new ActionError("Enter a domain."),
    message: "Enter a domain.",
  },
])(
  "localizes only owned wording for $kind while preserving status and source payload",
  async ({ error, message }) => {
    const { db, principal, context } = await authenticatedContext();
    try {
      const before = structuredClone(error);
      const action = createAction({
        async setup() {
          return { principal };
        },
        intents: {
          save: {
            fields: {},
            async handler() {
              throw error;
            },
          },
        },
      });
      expect(await action(await actionArgs(context, "zh-CN"))).toMatchObject({
        data: { ok: false, errors: { form: message } },
        init: { status: 400 },
      });
      if (!(error instanceof Error)) expect(error).toEqual(before);
    } finally {
      db.$client.close();
    }
  },
);
