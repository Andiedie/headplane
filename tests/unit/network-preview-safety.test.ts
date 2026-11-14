import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";

import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { stringify } from "yaml";

import { loadConfig } from "~/server/config/load";

import {
  bounded,
  CleanupBudget,
  localDockerEnvironment,
  PendingOperations,
  previewEnvironment,
  stopProcess,
  verifyDaemonIds,
} from "../harness/preview-safety";
import { tempDir } from "../support/temp";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("Docker commands pin the resolved local socket and discard conflicting context and TLS selectors", () => {
  const env = localDockerEnvironment("/private/docker.sock", {
    PATH: "/bin",
    DOCKER_HOST: "tcp://remote:2376",
    DOCKER_CONTEXT: "production",
    DOCKER_TLS_VERIFY: "1",
    DOCKER_TLS: "1",
    DOCKER_CERT_PATH: "/private/certs",
  });
  expect(env).toEqual({ PATH: "/bin", DOCKER_HOST: "unix:///private/docker.sock" });
});

test("remote runtimes and daemon identity mismatches fail before provisioning", () => {
  expect(() => localDockerEnvironment(undefined, {})).toThrow("local Unix socket");
  expect(() => localDockerEnvironment("tcp://remote:2376", {})).toThrow("local Unix socket");
  expect(() => verifyDaemonIds("creation-daemon", "other-daemon")).toThrow("daemon mismatch");
  expect(() => verifyDaemonIds(undefined, undefined)).toThrow("identity");
  expect(() => verifyDaemonIds("same", "same")).not.toThrow();
});

test("a hung graceful operation cannot block recovery or clear its failure", async () => {
  vi.useFakeTimers();
  try {
    const cleanup = new CleanupBudget(100, 20);
    const recovered: string[] = [];
    const work = (async () => {
      await cleanup.guard("dispose", () => new Promise(() => {}));
      await cleanup.guard("recover", async () => {
        recovered.push("owned");
      });
    })();
    await vi.advanceTimersByTimeAsync(25);
    await work;
    expect(recovered).toEqual(["owned"]);
    expect(cleanup.errors).toEqual([expect.stringContaining("dispose timed out")]);
    await vi.advanceTimersByTimeAsync(100);
    await cleanup.guard("too late", async () => {
      recovered.push("late");
    });
    expect(recovered).toEqual(["owned"]);
    expect(cleanup.errors.at(-1)).toContain("cleanup deadline");
  } finally {
    vi.useRealTimers();
  }
});

test("startup cancellation returns while tracking a late creation until it settles", async () => {
  const controller = new AbortController();
  const pending = new PendingOperations();
  let finish!: () => void;
  const raw = pending.track(
    "create",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const startup = bounded("startup", () => raw, 1000, controller.signal);
  controller.abort(new Error("requested stop"));
  await expect(startup).rejects.toThrow("requested stop");
  expect(pending.labels()).toEqual(["create"]);
  finish();
  await raw;
  expect(pending.labels()).toEqual([]);
});

test("a hung readiness check has a real deadline", async () => {
  vi.useFakeTimers();
  try {
    const work = bounded("readiness", () => new Promise(() => {}), 20);
    const result = expect(work).rejects.toThrow("readiness timed out");
    await vi.advanceTimersByTimeAsync(20);
    await result;
  } finally {
    vi.useRealTimers();
  }
});

test("inherited deployment settings cannot override the private app configuration", async () => {
  const dir = await tempDir();
  const path = `${dir}/config.yaml`;
  await writeFile(
    path,
    stringify({
      server: { data_path: `${dir}/data`, cookie_secret: "a".repeat(32) },
      headscale: { url: "https://localhost:12345", api_key: "private" },
      network: {
        relays: {
          catalog_path: `${dir}/catalog`,
          map_path: `${dir}/map`,
          headscale_path: "/etc/headscale/map",
        },
      },
    }),
  );
  const inherited = {
    ...process.env,
    HEADPLANE_CONFIG_PATH: "/existing/config",
    HEADPLANE_SERVER__DATA_PATH: "/existing/data",
    HEADPLANE_HEADSCALE__URL: "https://existing.invalid",
    HEADPLANE_HEADSCALE__API_KEY: "existing",
    HEADPLANE_INTEGRATION__PROC__ENABLED: "true",
    HEADPLANE_NETWORK__RELAYS__MAP_PATH: "/existing/map",
    HEADPLANE_OIDC__ENABLED: "true",
    HEADPLANE_FUTURE_OPTION: "existing",
  };
  const env = previewEnvironment(inherited, path);
  expect(Object.keys(env).filter((key) => key.startsWith("HEADPLANE_"))).toEqual([
    "HEADPLANE_CONFIG_PATH",
  ]);
  for (const key of Object.keys(process.env).filter((key) => key.startsWith("HEADPLANE_")))
    vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const config = await loadConfig();
  expect(config.server.data_path).toBe(`${dir}/data`);
  expect(config.headscale).toMatchObject({ url: "https://localhost:12345", api_key: "private" });
  expect(config.integration?.proc?.enabled).not.toBe(true);
  expect(config.network?.relays?.map_path).toBe(`${dir}/map`);
});

for (const leaderExitsFirst of [true, false]) {
  test(`process cleanup kills an ignoring descendant when leader ${leaderExitsFirst ? "already exited" : "exits on TERM"}`, async () => {
    const descendant = `process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000);`;
    const leader = spawn(
      process.execPath,
      [
        "-e",
        `
      const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','pipe','ignore']});
      child.stdout.once('data',()=>{console.log(child.pid); ${leaderExitsFirst ? "process.exit(0)" : "process.on('SIGTERM',()=>process.exit(0));"}});
      setInterval(()=>{},1000);
    `,
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    const exited = once(leader, "exit");
    // Test timeouts don't unwind an awaiting test's finally block. Always reap
    // the owned fixture through Vitest's completion hook, including RED runs.
    onTestFinished(async () => {
      vi.useRealTimers();
      try {
        process.kill(-leader.pid!, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      await bounded("reap test leader", () => exited, 1000);
    });
    await once(leader.stdout!, "data");
    if (leaderExitsFirst) await exited;
    await stopProcess(leader, 50);
    await expect
      .poll(
        () => {
          try {
            process.kill(-leader.pid!, 0);
            return false;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === "ESRCH";
          }
        },
        { timeout: 1500, interval: 20 },
      )
      .toBe(true);
  });
}
