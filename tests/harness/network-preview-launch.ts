// Run from the repository root with Node 24:
// node tests/harness/network-preview-launch.ts [--check] [--no-app] [--no-agent]
// --port=0 chooses an ephemeral loopback port. Startup defaults to 15 minutes;
// cleanup reserves separate graceful/recovery budgets and finishes within 90s.
// --fail-after=hang-startup with --startup-timeout-ms=12000 exercises deadlines;
// hang-cleanup exercises fallback disposal, late-create exercises late recovery.
// Clients/relays are internal-only; Headscale may need an owned access bridge
// (its egress is then unrestricted). The exact topology is recorded in state.
import { parseArgs } from "node:util";

import { createServer, createServerModuleRunner } from "vite";

// @ts-expect-error Node's native TypeScript entry point requires the extension.
import { bounded } from "./preview-safety.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8847" },
    "state-dir": { type: "string" },
    check: { type: "boolean", default: false },
    "no-app": { type: "boolean", default: false },
    "no-agent": { type: "boolean", default: false },
    "fail-after": { type: "string" },
    "startup-timeout-ms": { type: "string", default: "900000" },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid preview port");
if (
  values["fail-after"] &&
  !["headscale", "relays", "nodes", "hang-startup", "hang-cleanup", "late-create"].includes(
    values["fail-after"],
  )
) {
  throw new Error(
    "--fail-after must be headscale, relays, nodes, hang-startup, hang-cleanup, or late-create",
  );
}
const startupTimeoutMs = Number(values["startup-timeout-ms"]);
if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1)
  throw new Error("Invalid startup deadline");

const controller = new AbortController();

const stop = () => controller.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
let server: Awaited<ReturnType<typeof createServer>> | undefined;
try {
  server = await bounded(
    "preview module server",
    () =>
      createServer({
        configFile: "vitest.config.ts",
        logLevel: "error",
        appType: "custom",
        server: { host: "127.0.0.1", middlewareMode: true, hmr: false, ws: false, watch: null },
      }),
    20_000,
    controller.signal,
  );
  const { runNetworkPreview } = await bounded(
    "preview module import",
    () =>
      createServerModuleRunner(server!.environments.ssr).import(
        "/tests/harness/network-preview.ts",
      ),
    20_000,
    controller.signal,
  );
  await runNetworkPreview({
    port,
    stateDirectory: values["state-dir"],
    check: values.check,
    app: !values["no-app"],
    agent: !values["no-agent"],
    failAfter: values["fail-after"],
    startupTimeoutMs,
    signal: controller.signal,
  });
} catch (error) {
  // Detailed diagnostics and credentials stay in the private state directory.
  console.error(error instanceof Error ? error.message : "Network preview failed");
  process.exitCode = 1;
} finally {
  try {
    if (server) await bounded("close preview module server", () => server!.close(), 5000);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Module server cleanup failed");
    process.exitCode = 1;
  }
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
// Testcontainers keeps its reaper connection open after explicit cleanup.
process.exit(process.exitCode ?? 0);
