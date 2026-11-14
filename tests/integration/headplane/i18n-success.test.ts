import { readFile } from "node:fs/promises";

import { createCookie } from "react-router";
import { expect, test } from "vitest";
import { parse } from "yaml";

import { aclAction } from "~/routes/acls/acl-action";
import { dnsAction } from "~/routes/dns/dns-actions";
import { machineAction } from "~/routes/machines/machine-actions";
import { authKeysAction } from "~/routes/settings/auth-keys/actions";
import { restrictionAction } from "~/routes/settings/restrictions/actions";
import { userAction } from "~/routes/users/user-actions";
import { createNetworkHistory } from "~/server/network/history";
import type { ActionResult } from "~/utils/form";

import { createTailnet } from "../../harness/tailnet";
import { statusOf } from "../../support/app";

test("successful route messages follow each request language without changing mutations or audit identifiers", async () => {
  await using tailnet = await createTailnet();
  const app = await tailnet.headplane({
    config: { network: { history: { enabled: true } } },
  });
  const owner = await app.signIn("owner");
  const viewer = await app.signIn("viewer");
  const preferences = ["zh-CN", undefined, "en", "unsupported"] as const;
  const cookies = await Promise.all(
    preferences.map(async (locale) =>
      locale === undefined
        ? owner.cookie
        : `${owner.cookie}; ${(await createCookie("headplane_locale").serialize(locale)).split(";")[0]}`,
    ),
  );
  const created = await Promise.all(
    cookies.map((cookie, index) =>
      app.call(userAction, "/users", {
        as: cookie,
        form: { intent: "create", name: `locale-${index}`, display_name: "Machine renamed" },
      }),
    ),
  );
  for (const [index, result] of created.entries()) {
    expect(statusOf(result)).toBe(200);
    expect(result).toEqual({
      ok: true,
      message: index === 0 ? "用户已创建" : "User created",
      data: undefined,
    });
    const [user] = await tailnet.api.users.list({ name: `locale-${index}` });
    expect(user).toMatchObject({ name: `locale-${index}`, displayName: "Machine renamed" });
  }

  const [user] = await tailnet.api.users.list({ name: "locale-0" });
  for (const [index, cookie] of cookies.entries()) {
    const result = await app.call(userAction, "/users", {
      as: cookie,
      form: { intent: "rename", headscale_user_id: user.id, name: `renamed-${index}` },
    });
    expect(statusOf(result)).toBe(200);
    expect(result).toEqual({
      ok: true,
      message: index === 0 ? "用户已重命名" : "User renamed",
      data: undefined,
    });
    expect(await tailnet.api.users.list({ id: user.id })).toMatchObject([
      { id: user.id, name: `renamed-${index}`, displayName: "Machine renamed" },
    ]);
  }

  const languageCookie = cookies[0].slice(owner.cookie.length);
  const denied = await app.call(userAction, "/users", {
    as: `${viewer.cookie}${languageCookie}`,
    form: { intent: "rename", headscale_user_id: user.id, name: "forbidden" },
  });
  expect(statusOf(denied)).toBe(403);
  expect(await tailnet.api.users.list({ id: user.id })).toMatchObject([
    { id: user.id, name: "renamed-3" },
  ]);

  const node = await tailnet.node({ name: "locale-machine", user: "renamed-3" });
  for (const [index, cookie] of cookies.slice(0, 2).entries()) {
    expect(
      await app.call(machineAction, "/machines", {
        as: cookie,
        form: { intent: "rename", node_id: node.id, name: `machine-${index}` },
      }),
    ).toEqual({
      ok: true,
      message: index === 0 ? "设备已重命名" : "Machine renamed",
      data: undefined,
    });
    expect(await tailnet.api.nodes.get(node.id)).toMatchObject({
      id: node.id,
      givenName: `machine-${index}`,
    });
  }

  const previousKeys = new Set(
    (await tailnet.api.preAuthKeys.listForUser(user.id)).map((key) => key.id),
  );
  const keyResult = await app.call(authKeysAction, "/settings/auth-keys", {
    as: cookies[0],
    form: { intent: "create", user_id: user.id, expiry: "1" },
  });
  const key = (await tailnet.api.preAuthKeys.listForUser(user.id)).find(
    (item) => !previousKeys.has(item.id),
  )!;
  expect(keyResult).toEqual({ ok: true, message: undefined, data: { key: expect.any(String) } });
  const issuedKey = (keyResult as Extract<ActionResult, { ok: true }>).data!.key;
  expect(key.key).toBe(
    tailnet.headscale.capabilities.preAuthKeysHaveStableIds
      ? `${issuedKey.slice(0, 23)}-***`
      : issuedKey,
  );
  expect(
    await app.call(authKeysAction, "/settings/auth-keys", {
      as: cookies[0],
      form: { intent: "expire", key_id: key.id, user_id: user.id },
    }),
  ).toEqual({ ok: true, message: "认证密钥已过期", data: undefined });
  const expired = (await tailnet.api.preAuthKeys.listForUser(user.id)).find(
    (item) => item.id === key.id,
  )!;
  expect(new Date(expired.expiration!).getTime()).toBeLessThanOrEqual(Date.now());

  const policy = JSON.stringify({ acls: [{ action: "accept", src: ["*"], dst: ["*:*"] }] });
  expect(
    await app.call(aclAction, "/acls", {
      as: cookies[0],
      form: { intent: "save", policy },
    }),
  ).toEqual({ ok: true, message: "策略已更新", data: undefined });
  expect(JSON.parse((await tailnet.api.policy.get()).policy)).toEqual(JSON.parse(policy));

  for (const enabled of [false, true]) {
    expect(
      await app.call(dnsAction, "/dns", {
        as: cookies[0],
        form: { intent: "toggle_magic", enabled: String(enabled) },
      }),
    ).toEqual({
      ok: true,
      message: enabled ? "Magic DNS 已启用" : "Magic DNS 已禁用",
      data: undefined,
    });
    expect(parse(await readFile(tailnet.server.configPath, "utf8")).dns.magic_dns).toBe(enabled);
  }

  // A config-only edit needs no identity provider or Headscale restart.
  await app.ctx.hs.patch([{ path: "oidc.issuer", value: "https://issuer.example.test" }]);
  for (const [type, value, field, added, removed] of [
    ["domain", "example.test", "allowed_domains", "已添加域名", "已移除域名"],
    ["group", "Machine renamed", "allowed_groups", "已添加组", "已移除组"],
    ["user", "alice@example.test", "allowed_users", "已添加用户", "已移除用户"],
  ]) {
    for (const [intent, message] of [
      ["add", added],
      ["remove", removed],
    ]) {
      expect(
        await app.call(restrictionAction, "/settings/restrictions", {
          as: cookies[0],
          form: { intent, type, value },
        }),
      ).toEqual({ ok: true, message, data: undefined });
      expect(parse(await readFile(tailnet.server.configPath, "utf8")).oidc[field]).toEqual(
        intent === "add" ? [value] : [],
      );
    }
  }

  const history = createNetworkHistory(app.ctx.db, { enabled: true, retention_days: 7 });
  const events = (await history.recent("action")).map((event) => event.payload);
  expect(
    events.filter((event) => event.intent === "rename" && event.path === "/admin/users"),
  ).toEqual(
    cookies.map(() => ({
      actor: owner.userId,
      intent: "rename",
      path: "/admin/users",
      outcome: "success",
      target: user.id,
    })),
  );
  expect(
    events.filter((event) => event.intent === "rename" && event.path === "/admin/machines"),
  ).toEqual(
    cookies.slice(0, 2).map(() => ({
      actor: owner.userId,
      intent: "rename",
      path: "/admin/machines",
      outcome: "success",
      target: node.id,
    })),
  );
  expect(JSON.stringify(events)).not.toContain(issuedKey);
  expect(JSON.stringify(events)).not.toContain("设备已重命名");
});
