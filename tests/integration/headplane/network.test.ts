import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { machineAction } from "~/routes/machines/machine-actions";
import { action, loader } from "~/routes/network/overview";
import { History } from "~/routes/network/panels";
import { userAction } from "~/routes/users/user-actions";

import { createTailnet } from "../../harness/tailnet";
import { statusOf } from "../../support/app";

describe("network overview", () => {
  test("audits the affected Headplane user despite unrelated submitted identifiers", async () => {
    await using tailnet = await createTailnet();
    const app = await tailnet.headplane({ config: { network: { history: { enabled: true } } } });
    const owner = await app.signIn("owner");
    const member = await app.signIn("member");
    const result = await app.call(userAction, "/users", {
      as: owner.cookie,
      form: {
        intent: "reassign",
        headplane_user_id: member.userId,
        role: "auditor",
        node_id: "999999",
        user_id: "888888",
        headscale_user_id: "777777",
        extra: "never-store-this",
      },
    });
    expect(statusOf(result)).toBe(200);
    expect(await app.ctx.auth.roleForSubject(member.subject)).toBe("auditor");
    const current = await app.ctx.network.read(app.api);
    const event = current.history.find((event) => event.payload.intent === "reassign");
    expect(event).toMatchObject({
      entityId: member.userId,
      payload: {
        target: member.userId,
        actor: owner.userId,
        intent: "reassign",
        outcome: "success",
        path: "/admin/users",
      },
    });
    expect(Object.keys(event!.payload).sort()).toEqual([
      "actor",
      "intent",
      "outcome",
      "path",
      "target",
    ]);
    expect(JSON.stringify(current.history)).not.toContain("never-store-this");
    expect(JSON.stringify(current.history)).not.toContain("999999");
    const markup = renderToStaticMarkup(
      createElement(History, {
        data: { ...current, canSelectRelay: true },
      }),
    );
    expect(markup).toContain(`User ${member.userId}`);

    const linked = await tailnet.user("linked-audit-user");
    const forms: Record<string, string>[] = [
      { intent: "link", headplane_user_id: member.userId, headscale_user_id: linked.id },
      { intent: "transfer", headplane_user_id: member.userId },
    ];
    for (const form of forms) {
      expect(
        statusOf(
          await app.call(userAction, "/users", {
            as: owner.cookie,
            form: { ...form, node_id: "999999" },
          }),
        ),
      ).toBe(200);
    }
    const updated = await app.ctx.network.read(app.api);
    for (const intent of ["link", "transfer"]) {
      expect(updated.history.find((event) => event.payload.intent === intent)).toMatchObject({
        entityId: member.userId,
        payload: { target: member.userId, outcome: "success" },
      });
    }
  });

  test("audits Headscale user IDs and omits undeclared or malformed targets", async () => {
    await using tailnet = await createTailnet();
    const app = await tailnet.headplane({ config: { network: { history: { enabled: true } } } });
    const owner = await app.signIn("owner");
    expect(
      statusOf(
        await app.call(userAction, "/users", {
          as: owner.cookie,
          form: {
            intent: "create",
            name: "audit-created",
            node_id: "999999",
            headscale_user_id: "888888",
          },
        }),
      ),
    ).toBe(200);
    const [user] = await tailnet.api.users.list({ name: "audit-created" });
    for (const intent of ["rename", "delete"]) {
      expect(
        statusOf(
          await app.call(userAction, "/users", {
            as: owner.cookie,
            form: { intent, headscale_user_id: user.id, name: "audit-renamed", node_id: "999999" },
          }),
        ),
      ).toBe(200);
    }
    expect(await tailnet.api.users.list({ id: user.id })).toEqual([]);
    expect(
      statusOf(
        await app.call(userAction, "/users", {
          as: owner.cookie,
          form: {
            intent: "reassign",
            headplane_user_id: "nodekey:never-store-this",
            role: "auditor",
          },
        }),
      ),
    ).toBe(404);
    expect(
      statusOf(
        await app.call(userAction, "/users", {
          as: owner.cookie,
          form: { intent: "reassign", headplane_user_id: owner.userId, role: "member" },
        }),
      ),
    ).toBe(403);
    // Invalid fields never reach the handler or produce an operation record.
    expect(
      statusOf(
        await app.call(userAction, "/users", {
          as: owner.cookie,
          form: { intent: "reassign", headplane_user_id: owner.userId, role: "not-a-role" },
        }),
      ),
    ).toBe(400);

    const current = await app.ctx.network.read(app.api);
    const events = current.history.filter((event) => event.kind === "action");
    expect(events).toHaveLength(5);
    for (const intent of ["rename", "delete"]) {
      expect(events.find((event) => event.payload.intent === intent)).toMatchObject({
        entityId: user.id,
        payload: { target: user.id, outcome: "success" },
      });
    }
    expect(events.find((event) => event.payload.intent === "create")).toMatchObject({
      entityId: "/admin/users",
      payload: { outcome: "success" },
    });
    const failures = events.filter((event) => event.payload.outcome === "failed");
    expect(failures).toMatchObject([
      { entityId: owner.userId, payload: { target: owner.userId } },
      { entityId: "/admin/users" },
    ]);
    expect(failures[1].payload).not.toHaveProperty("target");
    expect(events.find((event) => event.payload.intent === "create")?.payload).not.toHaveProperty(
      "target",
    );
    for (const excluded of [
      "999999",
      "888888",
      "never-store-this",
      "audit-created",
      "audit-renamed",
    ]) {
      expect(JSON.stringify(events)).not.toContain(excluded);
    }
  });

  test("records dashboard operations without storing submitted values or credentials", async () => {
    await using tailnet = await createTailnet();
    const node = await tailnet.node({ name: "audit-test", user: "audit-test@" });
    const app = await tailnet.headplane({ config: { network: { history: { enabled: true } } } });
    const owner = await app.signIn("owner");
    const result = await app.call(machineAction, "/machines", {
      as: owner.cookie,
      form: {
        intent: "rename",
        node_id: node.id,
        name: "renamed-audit-test",
        extra: "never-store-this",
      },
    });
    expect(statusOf(result)).toBe(200);
    const current = await app.ctx.network.read(app.api);
    expect(current.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "action",
          entityId: node.id,
          payload: expect.objectContaining({
            intent: "rename",
            outcome: "success",
            target: node.id,
          }),
        }),
      ]),
    );
    expect(JSON.stringify(current.history)).not.toContain("never-store-this");
    expect(JSON.stringify(current.history)).not.toContain(tailnet.server.apiKey);
    expect((await tailnet.api.nodes.get(node.id)).givenName).toBe("renamed-audit-test");
    const markup = renderToStaticMarkup(
      createElement(History, {
        data: { ...current, canSelectRelay: true },
      }),
    );
    expect(markup).toContain(`renamed-audit-test (Device ${node.id})`);
    expect(markup).toContain("/admin/machines");
    expect(markup).toContain(owner.userId);
  });

  test("accepts the configured HTTPS origin behind a proxy without trusting forwarded headers", async () => {
    await using tailnet = await createTailnet();
    const app = await tailnet.headplane({
      config: {
        server: { base_url: "https://dashboard.example/admin" },
        network: { history: { enabled: true } },
      },
    });
    const owner = await app.signIn("owner");
    const permitted = await app.call(action, "/network", {
      as: owner.cookie,
      headers: {
        Origin: "https://dashboard.example",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "dashboard.example",
      },
      form: { intent: "select-relay", region: "901", revision: "old" },
    });
    // The unconfigured relay manager returns 400 after accepting the request.
    expect(statusOf(permitted)).toBe(400);
    for (const origin of ["https://evil.example", "http://headplane.test", "null"]) {
      expect(
        statusOf(
          await app.call(action, "/network", {
            as: owner.cookie,
            headers: {
              Origin: origin,
              "X-Forwarded-Proto": "https",
              "X-Forwarded-Host": "evil.example",
              Forwarded: "host=evil.example;proto=https",
            },
            form: { intent: "select-relay", region: "902", revision: "old" },
          }),
        ),
      ).toBe(403);
    }
    const current = await app.ctx.network.read(app.api);
    expect(current.history.filter((event) => event.kind === "action")).toMatchObject([
      { payload: { actor: owner.userId, region: 901, outcome: "failed" } },
    ]);
  });

  test("accepts a runtime-aligned origin only on the configured public host and port", async () => {
    await using tailnet = await createTailnet();
    const app = await tailnet.headplane({
      config: {
        server: { base_url: "https://headplane.test/admin" },
        network: { history: { enabled: true } },
      },
    });
    const owner = await app.signIn("owner");
    // The HTTP runtime aligns the public HTTPS Origin with its HTTP transport.
    for (const [origin, status] of [
      ["http://headplane.test", 400],
      ["http://headplane.test:8080", 403],
      ["http://evil.example", 403],
    ] as const) {
      expect(
        statusOf(
          await app.call(action, "/network", {
            as: owner.cookie,
            headers: { Origin: origin },
            form: { intent: "select-relay", region: "901", revision: "old" },
          }),
        ),
      ).toBe(status);
    }
    const current = await app.ctx.network.read(app.api);
    expect(current.history.filter((event) => event.kind === "action")).toMatchObject([
      { payload: { actor: owner.userId, region: 901, outcome: "failed" } },
    ]);
  });

  test("falls back to the request origin only when no canonical URL is configured", async () => {
    await using tailnet = await createTailnet();
    const app = await tailnet.headplane();
    const owner = await app.signIn("owner");
    for (const [origin, status] of [
      ["http://headplane.test", 400],
      ["https://evil.example", 403],
    ] as const) {
      expect(
        statusOf(
          await app.call(action, "/network", {
            as: owner.cookie,
            headers: {
              Origin: origin,
              "X-Forwarded-Proto": "https",
              "X-Forwarded-Host": "evil.example",
              Forwarded: "host=evil.example;proto=https",
            },
            form: { intent: "select-relay", region: "901", revision: "old" },
          }),
        ),
      ).toBe(status);
    }
  });

  test("uses existing control data without requiring the agent or relay configuration", async () => {
    await using tailnet = await createTailnet();
    const node = await tailnet.node({ name: "network-test", user: "network-test@" });
    const app = await tailnet.headplane();
    const owner = await app.signIn("owner");
    const result = await app.call(loader, "/network", { as: owner.cookie });
    expect(statusOf(result)).toBe(200);
    expect(result).toMatchObject({
      snapshot: {
        nodes: expect.arrayContaining([expect.objectContaining({ id: node.id, homeRegion: null })]),
      },
      historyEnabled: false,
      history: [],
    });
    for (const role of ["member", "viewer"] as const) {
      const caller = await app.signIn(role);
      expect(statusOf(await app.call(loader, "/network", { as: caller.cookie }))).toBe(403);
      expect(
        statusOf(
          await app.call(action, "/network", {
            as: caller.cookie,
            form: { intent: "select-relay", region: "901", revision: "old" },
          }),
        ),
      ).toBe(403);
    }
    for (const role of ["auditor", "it_admin"] as const) {
      const caller = await app.signIn(role);
      const view = await app.call(loader, "/network", { as: caller.cookie });
      expect(statusOf(view)).toBe(200);
      expect(view).toMatchObject({
        canSelectRelay: false,
        snapshot: { nodes: expect.arrayContaining([expect.objectContaining({ id: node.id })]) },
      });
      expect(
        statusOf(
          await app.call(action, "/network", {
            as: caller.cookie,
            form: { intent: "select-relay", region: "901", revision: "old" },
          }),
        ),
      ).toBe(403);
    }
    const resultAction = await app.call(action, "/network", {
      as: owner.cookie,
      form: { intent: "select-relay", region: "901", revision: "old" },
    });
    expect(statusOf(resultAction)).toBe(400);
    expect(await tailnet.api.nodes.list()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: node.id })]),
    );
  });
});
