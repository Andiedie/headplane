import { randomUUID } from "node:crypto";

import { getContainerRuntimeClient } from "testcontainers";
import { describe, expect, test, vi } from "vitest";

import { createHeadscale } from "~/server/headscale/api";

import { startHeadscale } from "../../harness/headscale";
import { testedVersions } from "../../harness/versions";

describe.for(testedVersions())("control-only Headscale %s", (version) => {
  test("starts and restarts when external HTTPS is unavailable", async () => {
    const headscale = await startHeadscale({
      version,
      id: `startup-${randomUUID()}`,
      // Go's HTTP transport must fail any external HTTPS request immediately.
      // This affects only this container, not Docker or the host's HTTP client.
      environment: { HTTPS_PROXY: "http://127.0.0.1:1", NO_PROXY: "" },
    });
    try {
      const client = await createHeadscale({ url: headscale.url });
      try {
        expect(await client.health()).toBe(true);
        const api = client.client(headscale.apiKey);
        const user = await api.users.create({ name: "startup-check" });
        expect(await api.users.list({ name: user.name })).toEqual([user]);

        const runtime = await getContainerRuntimeClient();
        const container = runtime.container.getById(headscale.container.getId());
        const before = await runtime.container.inspect(container);
        await runtime.container.restart(container, { timeout: 10 });
        await vi.waitFor(() => expect(client.health()).resolves.toBe(true), {
          timeout: 30_000,
          interval: 250,
        });

        const after = await runtime.container.inspect(container);
        expect(after.State.StartedAt).not.toBe(before.State.StartedAt);
        expect(await api.users.list({ name: user.name })).toEqual([user]);
      } finally {
        await client.dispose();
      }
    } finally {
      await headscale.stop();
    }
  });
});
