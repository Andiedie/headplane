import assert from "node:assert/strict";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { getContainerRuntimeClient } from "testcontainers";
import { parse, stringify } from "yaml";

import { loadConfig } from "~/server/config/load";

import { buildDerper, type PreviewDerper, startDerper } from "./derper";
import { freePort } from "./headscale";
import {
  bounded,
  CleanupBudget,
  localDockerEnvironment,
  PendingOperations,
  previewEnvironment,
  processGroupExists,
  stopProcess,
  verifyDaemonIds,
} from "./preview-safety";
import { createTailnet, type Tailnet } from "./tailnet";
import { LATEST_HEADSCALE, TAILSCALE_IMAGE } from "./versions";
import { waitFor as upstreamWaitFor } from "./wait";

const exec = promisify(execFile);
const OWNER_LABEL = "me.tale.headplane.network-preview";
const CONTAINER_MAP = "/etc/headscale/selected-derp.json";

type Options = {
  port: number;
  stateDirectory?: string;
  check: boolean;
  app: boolean;
  agent: boolean;
  failAfter?: string;
  startupTimeoutMs?: number;
  signal: AbortSignal;
};

type Resource = { kind: "container" | "network"; name: string; id?: string; internal?: boolean };

// Headscale reads derp.paths using yaml.v3, even for a .json filename. Its
// native field names are lowercase; the DERP control protocol uses capitals.
function headscaleMap(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(headscaleMap);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key.toLowerCase(), headscaleMap(item)]),
    );
  }
  return value;
}

async function availablePort(preferred: number) {
  if (!preferred) return freePort();
  const socket = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.listen(preferred, "127.0.0.1", resolve);
    });
    return (socket.address() as AddressInfo).port;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    return freePort();
  } finally {
    if (socket.listening) await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}

/**
 * This entry point owns only disposable resources created during this invocation.
 * It uses the upstream createTailnet/node helpers, original Tailscale images,
 * and the unmodified derper and hp_agent binaries. No fixture observations.
 */
export async function runNetworkPreview(options: Options) {
  const client = await bounded(
    "Docker discovery",
    getContainerRuntimeClient,
    20_000,
    options.signal,
  );
  const docker = client.container.dockerode;
  // getSocketPath is the installed docker-modem API, including lazy defaults.
  const modem = docker.modem as unknown as { getSocketPath(): Promise<string | undefined> };
  const socketPath = await bounded(
    "Docker socket discovery",
    () => modem.getSocketPath(),
    5000,
    options.signal,
  );
  const dockerEnvironment = localDockerEnvironment(socketPath, process.env);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(client.info.containerRuntime.host),
    "Preview requires local published ports",
  );
  const runtimeInfo = await bounded("Docker identity", () => docker.info(), 10_000, options.signal);
  const cliInfo = JSON.parse(
    (
      await exec(
        "docker",
        ["--host", dockerEnvironment.DOCKER_HOST, "info", "--format", "{{json .}}"],
        {
          env: dockerEnvironment,
          timeout: 10_000,
          signal: options.signal,
        },
      )
    ).stdout,
  );
  verifyDaemonIds(runtimeInfo.ID, cliInfo.ID);
  const parent = resolve(options.stateDirectory ?? join(tmpdir(), "headplane-network-preview"));
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, "network-"));
  await chmod(directory, 0o700);
  const statePath = join(directory, "state.json");
  const state: Record<string, unknown> = {
    owner: randomUUID(),
    pid: process.pid,
    directory,
    statePath,
    phase: "preparing",
    headscaleVersion: LATEST_HEADSCALE,
    tailscaleImage: TAILSCALE_IMAGE,
    resources: [] as Resource[],
    checks: {},
    runtime: { endpoint: dockerEnvironment.DOCKER_HOST, daemonId: runtimeInfo.ID },
    isolation:
      "Clients and DERP relays use only the run-owned internal network. Headscale may use a separate run-owned bridge for host loopback access; Headscale egress is not restricted in that case.",
  };
  const resources = state.resources as Resource[];
  const persist = () =>
    writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await persist();
  console.log(`Private preview state: ${statePath}`);

  const originalCreateContainer = client.container.create.bind(client.container);
  const originalCreateNetwork = client.network.create.bind(client.network);
  const originalConnect = client.container.connectToNetwork.bind(client.container);
  const originalStart = client.container.start.bind(client.container);
  const pending = new PendingOperations();
  const startupController = new AbortController();
  const startupSignal = AbortSignal.any([options.signal, startupController.signal]);
  let closing = false;
  const active = () => {
    if (closing) throw new Error("Preview is stopping; no new resources or processes may start");
    startupSignal.throwIfAborted();
  };
  const internalNetwork = () => {
    const network = resources.find((resource) => resource.kind === "network" && resource.internal);
    assert.ok(network?.id, "Owned internal network must exist before container creation");
    return network;
  };
  // The upstream helpers don't expose ownership hooks. Scope these hooks to
  // this standalone launcher, record intended names before creation, and leave
  // the shared Testcontainers reaper alone. This also covers startup failures
  // before createTailnet has returned a disposable handle.
  client.container.create = async (configuration) => {
    if (
      configuration.Labels?.["org.testcontainers.ryuk"] === "true" ||
      configuration.name?.startsWith("testcontainers-ryuk-")
    ) {
      return originalCreateContainer(configuration);
    }
    active();
    const resource: Resource = {
      kind: "container",
      name: configuration.name ?? `hp-network-${state.owner}-${resources.length}`,
    };
    resources.push(resource);
    await persist();
    const bindings = configuration.HostConfig?.PortBindings;
    if (bindings) {
      for (const entries of Object.values(bindings) as Array<
        Array<{ HostIp?: string }> | undefined
      >) {
        for (const entry of entries ?? []) entry.HostIp = "127.0.0.1";
      }
    }
    active();
    const container = await pending.track(`create container ${resource.name}`, () =>
      originalCreateContainer({
        ...configuration,
        name: resource.name,
        HostConfig: { ...configuration.HostConfig, NetworkMode: internalNetwork().id },
        Labels: { ...configuration.Labels, [OWNER_LABEL]: String(state.owner) },
      }),
    );
    resource.id = container.id;
    await persist();
    active();
    return container;
  };
  client.network.create = async (configuration) => {
    active();
    const resource: Resource = { kind: "network", name: configuration.Name, internal: true };
    resources.push(resource);
    await persist();
    active();
    const network = await pending.track(`create network ${resource.name}`, async () => {
      if (options.failAfter === "late-create") {
        // Fault injection: the daemon creates after cancellation and the first
        // absence query. The tracked request must settle before a clean verdict.
        startupController.abort(new Error("Requested late network creation"));
        await delay(1000);
      }
      return originalCreateNetwork({
        ...configuration,
        // Docker DNS still resolves the lab aliases; no node can reach public
        // bootstrap-DNS, log upload, STUN, or DERP endpoints outside this network.
        Internal: true,
        Labels: { ...configuration.Labels, [OWNER_LABEL]: String(state.owner) },
      });
    });
    resource.id = network.id;
    await persist();
    active();
    return network;
  };

  client.container.connectToNetwork = async (container, network, aliases) => {
    active();
    const inspected = await container.inspect();
    assert.equal(inspected.Config.Labels[OWNER_LABEL], state.owner);
    const selectedNetwork = await network.inspect();
    assert.equal(selectedNetwork.Id, internalNetwork().id);
    assert.equal(selectedNetwork.Labels?.[OWNER_LABEL], state.owner);
    assert.equal(inspected.State.Running, false);
    // Testcontainers 12 clears NetworkMode for aliases and later connects. We
    // created on the owned network already; replace only that stopped endpoint
    // to install its aliases. Never change the shared bridge itself.
    if (
      Object.entries(inspected.NetworkSettings.Networks).some(
        ([name, item]) =>
          name === selectedNetwork.Name ||
          name === selectedNetwork.Id ||
          item.NetworkID === selectedNetwork.Id,
      )
    ) {
      await network.disconnect({ Container: container.id, Force: true });
    }
    active();
    await originalConnect(container, network, aliases);
  };

  const attachments: Record<string, string[]> = {};
  let accessNetwork: string | undefined;
  async function verifyAttachments(
    container: ReturnType<typeof client.container.getById>,
    headscale: boolean,
  ) {
    let inspected = await container.inspect();
    assert.equal(inspected.Config.Labels[OWNER_LABEL], state.owner);
    if (inspected.NetworkSettings.Networks.bridge) {
      await docker.getNetwork("bridge").disconnect({ Container: container.id, Force: true });
      inspected = await container.inspect();
    }
    // Docker leaves NetworkID empty before first start. Resolve every endpoint
    // name against the same daemon and verify its ownership and Internal flag.
    const actual = (
      await Promise.all(
        Object.entries(inspected.NetworkSettings.Networks).map(async ([name, endpoint]) => {
          const network = await docker.getNetwork(name).inspect();
          assert.equal(network.Labels?.[OWNER_LABEL], state.owner);
          const owned = resources.find(
            (resource) => resource.kind === "network" && resource.id === network.Id,
          );
          assert.ok(owned);
          assert.equal(network.Internal, owned.internal);
          if (endpoint.NetworkID) assert.equal(endpoint.NetworkID, network.Id);
          return network.Id;
        }),
      )
    ).sort();
    const expected = [
      internalNetwork().id!,
      ...(headscale && accessNetwork ? [accessNetwork] : []),
    ].sort();
    assert.deepEqual(actual, expected, "Unexpected preview container network attachment");
    attachments[container.id] = actual;
    state.attachments = attachments;
    await persist();
  }
  client.container.start = async (container) => {
    const resource = resources.find(
      (item) => item.kind === "container" && item.id === container.id,
    );
    if (!resource) return originalStart(container); // shared Ryuk only
    active();
    const inspected = await container.inspect();
    const headscale = inspected.Config.Image.startsWith("headscale/headscale:");
    await verifyAttachments(container, headscale);
    active();
    await originalStart(container);
    await verifyAttachments(container, headscale);
    if (headscale) {
      const port = inspected.HostConfig.PortBindings["443/tcp"]?.[0]?.HostPort;
      assert.ok(port);
      const health = () =>
        new Promise<void>((resolve, reject) => {
          const request = httpsGet(
            `https://127.0.0.1:${port}/health`,
            { rejectUnauthorized: false },
            (response) => {
              response.resume();
              if (response.statusCode === 200) resolve();
              else reject(new Error(`Headscale health: ${response.statusCode}`));
            },
          );
          request.setTimeout(500, () => request.destroy(new Error("Headscale loopback timed out")));
          request.once("error", reject);
        });
      try {
        await bounded(
          "internal Headscale loopback",
          () => waitFor("loopback health", health, { timeout: 3000 }),
          4000,
          startupSignal,
        );
        state.headscaleAccess = "internal-only loopback publication verified";
      } catch {
        active();
        await bounded(
          "stop Headscale for loopback bridge",
          () => container.stop({ t: 1 }),
          5000,
          startupSignal,
        );
        const bridge: Resource = {
          kind: "network",
          name: `hp-network-access-${state.owner}`,
          internal: false,
        };
        resources.push(bridge);
        await persist();
        const network = await pending.track("create Headscale access network", () =>
          originalCreateNetwork({
            Name: bridge.name,
            Driver: "bridge",
            Internal: false,
            Labels: { [OWNER_LABEL]: String(state.owner) },
          }),
        );
        bridge.id = accessNetwork = network.id;
        await persist();
        active();
        await network.connect({ Container: container.id });
        await verifyAttachments(container, true);
        active();
        await originalStart(container);
        await verifyAttachments(container, true);
        await bounded(
          "Headscale loopback bridge health",
          () => waitFor("loopback health", health, { timeout: 10_000 }),
          12_000,
          startupSignal,
        );
        state.headscaleAccess =
          "internal-only publication failed; verified dedicated owned bridge, Headscale egress unrestricted";
      }
    }
  };

  let tailnet: Tailnet | undefined;
  let app: ChildProcess | undefined;
  let appLog: Awaited<ReturnType<typeof open>> | undefined;
  const relays: PreviewDerper[] = [];
  let failure: unknown;
  const errors: string[] = [];
  const checkpoint = (name: string) => {
    active();
    if (options.failAfter === name) throw new Error(`Requested startup failure after ${name}`);
  };

  function waitFor(
    description: string,
    check: () => Promise<unknown>,
    settings: { timeout?: number; interval?: number } = {},
  ) {
    return bounded(
      description,
      () =>
        upstreamWaitFor(
          description,
          async () => {
            active();
            return check();
          },
          settings,
        ),
      settings.timeout ?? 30_000,
      startupSignal,
    );
  }

  try {
    await bounded(
      "preview startup",
      () =>
        pending.track("startup", async () => {
          checkpoint("start");
          console.log("Starting isolated Headscale (no public DERP map)...");
          tailnet = await createTailnet({
            policy: { acls: [{ action: "accept", src: ["*"], dst: ["*:*"] }] },
            headscaleConfig: {
              // Bootstrap locally before the mounted map can be written. Only this
              // newly created container is restarted after the final map is installed.
              derp: {
                server: {
                  enabled: true,
                  region_id: 999,
                  region_code: "bootstrap",
                  region_name: "Preview bootstrap",
                  stun_listen_addr: "0.0.0.0:3478",
                  private_key_path: "/var/lib/headscale/derp.key",
                  automatically_add_embedded_derp_region: true,
                },
                urls: [],
                paths: [],
                auto_update_enabled: false,
              },
            },
          });
          state.headscale = {
            url: tailnet.server.url,
            apiKey: tailnet.server.apiKey,
            configPath: tailnet.server.configPath,
            certPath: tailnet.server.certPath,
            containerId: tailnet.server.container.getId(),
            networkId: tailnet.network.getId(),
          };
          await persist();
          checkpoint("headscale");
          if (options.failAfter === "hang-startup") await new Promise(() => {});
          if (options.failAfter === "hang-cleanup")
            throw new Error("Requested hung disposal after Headscale");

          const architecture = client.info.containerRuntime.architecture;
          const arch = ["aarch64", "arm64"].includes(architecture)
            ? "arm64"
            : architecture === "x86_64"
              ? "amd64"
              : undefined;
          if (!arch) throw new Error(`Unsupported container architecture: ${architecture}`);
          console.log("Building original derper and starting two container-only regions...");
          const derper = await buildDerper(directory, arch, startupSignal);
          state.derperModule = JSON.parse(
            (
              await exec("go", ["list", "-m", "-json", "tailscale.com"], {
                timeout: 20_000,
                signal: startupSignal,
              })
            ).stdout,
          ).Version;
          for (const [regionId, code, name] of [
            [901, "lab-a", "Local lab A"],
            [902, "lab-b", "Local lab B"],
          ] as const) {
            checkpoint("building-relays");
            relays.push(
              await startDerper({
                tailnet,
                binary: derper,
                directory,
                regionId,
                code,
                name,
                signal: startupSignal,
              }),
            );
          }
          const catalogPath = join(dirname(tailnet.server.configPath), "relay-catalog.json");
          const mapPath = join(dirname(tailnet.server.configPath), "selected-derp.json");
          const catalog = {
            Regions: Object.fromEntries(
              relays.map((relay) => [relay.region.RegionID, relay.region]),
            ),
          };
          await writeFile(catalogPath, JSON.stringify(catalog, null, 2), { mode: 0o600 });
          const select = (relay: PreviewDerper) =>
            writeFile(
              mapPath,
              // Numeric YAML keys are required: JSON quotes region IDs and yaml.v3
              // rejects them for map[int]*DERPRegion. The mounted filename is fixed.
              stringify({
                regions: new Map([[relay.region.RegionID, headscaleMap(relay.region)]]),
              }),
              { mode: 0o644 },
            );
          await select(relays[0]);
          const headscaleConfiguration = parse(await readFile(tailnet.server.configPath, "utf8"));
          headscaleConfiguration.derp = {
            server: { enabled: false, automatically_add_embedded_derp_region: false },
            urls: [],
            paths: [CONTAINER_MAP],
            auto_update_enabled: true,
            update_frequency: "5s",
          };
          await writeFile(tailnet.server.configPath, stringify(headscaleConfiguration));
          // Avoid Testcontainers' restart wait strategy deleting the container before
          // we can preserve its failure log. This exact container belongs to this run.
          await client.container.restart(
            client.container.getById(tailnet.server.container.getId()),
            {
              timeout: 10_000,
            },
          );
          await waitFor("restarted lab Headscale", () => tailnet!.api.nodes.list());
          checkpoint("relays");

          console.log("Joining three original Tailscale nodes and checking relay propagation...");
          const nodes: Array<Awaited<ReturnType<Tailnet["node"]>>> = [];
          for (const name of ["preview-workstation", "preview-gateway", "preview-offline"]) {
            checkpoint("joining");
            nodes.push(await tailnet.node({ name, user: "preview-operator" }));
          }
          state.nodes = nodes.map((node) => ({ id: node.id, name: node.name }));
          const checks: Record<string, unknown> = {};
          state.checks = checks;
          async function expectRegion(relay: PreviewDerper) {
            await waitFor(
              `all original clients to receive region ${relay.region.RegionID}`,
              async () => {
                for (const node of nodes) {
                  const map = JSON.parse(await node.tailscale(["debug", "derp-map"]));
                  assert.deepEqual(Object.keys(map.Regions), [String(relay.region.RegionID)]);
                }
              },
              { timeout: 60_000 },
            );
            // A map update and a new home relay are separate observations. Ask the
            // original clients to repeat their real STUN probe rather than waiting
            // for their much slower idle netcheck timer; no observations are injected.
            for (const node of nodes) await node.tailscale(["debug", "restun"]);
            await waitFor(
              `clients to connect to ${relay.region.RegionCode}`,
              async () => {
                for (const node of nodes) {
                  const status = await node.status();
                  assert.equal((status.Self as { Relay: string }).Relay, relay.region.RegionCode);
                }
              },
              { timeout: 60_000 },
            );
            await waitFor(`native connections at ${relay.region.RegionCode}`, async () => {
              const metrics = JSON.parse(await relay.metrics());
              assert.ok(metrics.derp.gauge_current_connections >= nodes.length);
            });
          }
          await expectRegion(relays[0]);
          const peerIp = (await nodes[1].machine()).ipAddresses[0];
          checks.peerPing = (
            await nodes[0].tailscale(["ping", "--c=1", "--until-direct=false", peerIp])
          ).trim();
          await select(relays[1]);
          await expectRegion(relays[1]);
          checks.regionSwitch = [901, 902];
          checks.secondRegionPing = (
            await nodes[0].tailscale(["ping", "--c=1", "--until-direct=false", peerIp])
          ).trim();
          await select(relays[0]);
          await expectRegion(relays[0]);
          checks.restoredRegion = 901;
          checks.nativeMetrics = await Promise.all(
            relays.map(async (relay) => {
              const body = JSON.parse(await relay.metrics());
              assert.equal(typeof body.derp.bytes_received, "number");
              assert.equal(typeof body.derp.bytes_sent, "number");
              return { region: relay.region.RegionID, ...body.derp };
            }),
          );
          await nodes[2].down();
          checks.offlineNode = nodes[2].name;
          checkpoint("nodes");

          const port = await availablePort(options.port);
          const configPath = join(directory, "config.yaml");
          const dataPath = join(directory, "data");
          await mkdir(dataPath, { mode: 0o700 });
          let agentConfiguration: Record<string, unknown> | undefined;
          if (options.agent) {
            console.log("Building hp_agent for an isolated node container...");
            const binary = join(directory, "hp_agent");
            await exec("go", ["build", "-mod=readonly", "-o", binary, "./cmd/hp_agent"], {
              env: { ...process.env, GOOS: "linux", GOARCH: arch, CGO_ENABLED: "0" },
              timeout: 600_000,
              signal: startupSignal,
              maxBuffer: 8 * 1024 * 1024,
            });
            await nodes[1].copyFiles([
              { source: binary, target: "/preview/hp_agent", mode: 0o755 },
            ]);
            const nodeContainer = resources.find(
              (resource) => resource.name === `hp-harness-${tailnet!.id}-${nodes[1].name}`,
            )!;
            const docker = (await exec("/bin/sh", ["-c", "command -v docker"])).stdout.trim();
            const launcher = join(directory, "launch-agent");
            // Use an absolute interpreter and Docker path: agent manager intentionally
            // provides no PATH. Auth keys travel in the environment, never arguments.
            await writeFile(
              launcher,
              `#!${process.execPath}\n` +
                `const {spawn} = require('node:child_process');\n` +
                `const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'].includes(key)));\n` +
                `const child = spawn(${JSON.stringify(docker)}, ['--host',${JSON.stringify(dockerEnvironment.DOCKER_HOST)},'exec','-i',` +
                `'--env','HEADPLANE_AGENT_TS_AUTHKEY','--env','HEADPLANE_AGENT_HOSTNAME',` +
                `'--env','HEADPLANE_AGENT_WORK_DIR=/preview/agent-state',` +
                `'--env','HEADPLANE_AGENT_TS_SERVER=https://headscale',` +
                `'--env','HEADPLANE_AGENT_TS_NETNS=false','--env','SSL_CERT_FILE=/etc/ssl/harness.pem',` +
                `${JSON.stringify(nodeContainer.id)},'/preview/hp_agent'], {stdio:'inherit',env});\n` +
                `child.on('error',()=>process.exit(1)); child.on('exit',(code)=>process.exit(code ?? 1));\n` +
                `for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));\n`,
              { mode: 0o700 },
            );
            agentConfiguration = {
              enabled: true,
              executable_path: launcher,
              work_dir: join(directory, "agent-manager"),
              host_name: "preview-agent",
              tailscale_netns: false,
              cache_ttl: 5000,
            };
            state.agentContainerId = nodeContainer.id;
          }
          const configuration = {
            server: {
              host: "127.0.0.1",
              port,
              base_url: `http://127.0.0.1:${port}`,
              cookie_secret: randomBytes(16).toString("hex"),
              cookie_secure: false,
              data_path: dataPath,
            },
            headscale: {
              url: tailnet.server.url,
              api_key: tailnet.server.apiKey,
              tls_cert_path: tailnet.server.certPath,
              config_path: tailnet.server.configPath,
              dns_records_path: tailnet.server.recordsPath,
            },
            // No Docker integration: the UI gets no authority to restart services.
            integration: agentConfiguration ? { agent: agentConfiguration } : {},
            network: {
              poll_interval: 5000,
              history: { enabled: true, retention_days: 7, max_rows: 10000 },
              relays: {
                catalog_path: catalogPath,
                map_path: mapPath,
                headscale_path: CONTAINER_MAP,
              },
              metrics: relays.map((relay) => ({
                id: relay.region.RegionCode,
                name: relay.region.RegionName,
                url: relay.metricsUrl,
                region_id: relay.region.RegionID,
              })),
            },
          };
          await writeFile(configPath, stringify(configuration), { mode: 0o600 });
          const appEnvironment = previewEnvironment(process.env, configPath);
          // This standalone runner has no app services yet. Validate with the actual
          // loader and precisely the environment the application will receive.
          const inheritedEnvironment = process.env;
          let effective: Awaited<ReturnType<typeof loadConfig>>;
          try {
            process.env = appEnvironment;
            effective = await loadConfig();
          } finally {
            process.env = inheritedEnvironment;
          }
          assert.partialDeepStrictEqual(effective, configuration);
          for (const integration of ["docker", "kubernetes", "proc"] as const) {
            assert.notEqual(effective.integration?.[integration]?.enabled, true);
          }
          assert.equal(effective.integration?.agent?.enabled === true, options.agent);
          state.effectiveConfigurationVerified = true;
          state.configPath = configPath;
          state.url = `http://127.0.0.1:${port}/admin/network`;
          state.metrics = configuration.network.metrics;
          state.relays = configuration.network.relays;
          await persist();

          if (options.app) {
            console.log("Starting Headplane on loopback; application logs stay private...");
            const logPath = join(directory, "app.log");
            appLog = await open(logPath, "a", 0o600);
            active();
            app = spawn(
              "pnpm",
              [
                "exec",
                "react-router",
                "dev",
                "--host",
                "127.0.0.1",
                "--port",
                String(port),
                "--strictPort",
              ],
              {
                detached: true,
                stdio: ["ignore", appLog.fd, appLog.fd],
                env: appEnvironment,
              },
            );
            state.devPid = app.pid;
            state.logPath = logPath;
            app.on("error", (error) => {
              failure = error;
            });
            await waitFor(
              "Headplane HTTP listener",
              async () => {
                active();
                if (app!.exitCode !== null || failure)
                  throw new Error("Headplane exited; inspect private app.log");
                const response = await fetch(`http://127.0.0.1:${port}/admin/login`, {
                  signal: AbortSignal.timeout(3000),
                });
                assert.equal(response.status, 200);
              },
              { timeout: 90_000 },
            );
            checks.appLoginStatus = 200;
            const login = await fetch(`http://127.0.0.1:${port}/admin/login`, {
              method: "POST",
              body: new URLSearchParams({ api_key: tailnet.server.apiKey }),
              redirect: "manual",
              signal: AbortSignal.timeout(10_000),
            });
            assert.equal(login.status, 302);
            const cookie = login.headers
              .getSetCookie()
              .map((value) => value.split(";", 1)[0])
              .join("; ");
            assert.ok(cookie);
            const networkPage = await fetch(String(state.url), {
              headers: { cookie },
              signal: AbortSignal.timeout(10_000),
            });
            assert.equal(networkPage.status, 200);
            checks.networkPageStatus = networkPage.status;
            if (options.agent) {
              await waitFor(
                "containerized hp_agent registration",
                async () => {
                  const agent = (await tailnet!.api.nodes.list()).find(
                    (node) => node.name === "preview-agent",
                  );
                  assert.ok(agent?.online);
                },
                { timeout: 90_000 },
              );
              checks.agentOnline = true;
            }
          }
          active();
          state.phase = "ready";
          await persist();
          console.log(`Preview ready: ${state.url}`);
          console.log(
            `Verified two native relays, client map switching, real ping, and one offline node.`,
          );
        }),
      options.startupTimeoutMs ?? 900_000,
      startupSignal,
    );
    if (!options.check) {
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) resolve();
        else options.signal.addEventListener("abort", () => resolve(), { once: true });
        app?.once("exit", (code, signal) => {
          if (!options.signal.aborted) failure = new Error(`Headplane exited (${code ?? signal})`);
          resolve();
        });
      });
    }
  } catch (error) {
    failure = error;
  } finally {
    closing = true;
    startupController.abort(new Error("Preview cleanup started"));
    state.phase = "stopping";
    // Independent phase budgets reserve recovery time even if every graceful
    // disposal hangs. Each daemon request is raced too, not just Docker's t.
    const totalDeadline = Date.now() + 90_000;
    const graceful = new CleanupBudget(20_000, 5000);
    const guard = (name: string, work: () => Promise<unknown>) =>
      graceful.guard(name, () => pending.track(name, work));
    await guard("save shutdown state", persist);
    if (app) await guard("stop dev process group", () => stopProcess(app!, 2000));
    if (appLog) await guard("close private log", () => appLog!.close());
    for (const relay of relays) await guard("close metrics bridge", () => relay.closeBridge());
    if (failure) {
      await guard("preserve container diagnostics", async () => {
        await Promise.all(
          resources
            .filter((resource) => resource.kind === "container" && resource.id)
            .map(async (resource) => {
              try {
                const logs = await bounded(
                  "container logs",
                  () =>
                    docker.getContainer(resource.id!).logs({
                      stdout: true,
                      stderr: true,
                      follow: false,
                      tail: 200,
                    }),
                  3000,
                );
                await writeFile(join(directory, `${resource.name}.log`), logs, { mode: 0o600 });
              } catch {
                /* Logs are best effort; removal and verification are separate. */
              }
            }),
        );
      });
    }
    for (const relay of relays) {
      await guard("stop relay container", () =>
        relay.container.stop({ remove: true, removeVolumes: true }),
      );
    }
    if (tailnet)
      await guard("dispose upstream tailnet", () =>
        options.failAfter === "hang-cleanup" ? new Promise(() => {}) : tailnet!.dispose(),
      );
    errors.push(...graceful.errors);

    const recovery = new CleanupBudget(Math.min(50_000, totalDeadline - Date.now()), 5000);
    const filters = { label: [`${OWNER_LABEL}=${state.owner}`] };
    async function recover() {
      for (const kind of ["container", "network"] as const) {
        let ids: string[] = [];
        await recovery.guard(`list owned ${kind}s`, async () => {
          ids =
            kind === "container"
              ? (await docker.listContainers({ all: true, filters })).map((item) => item.Id)
              : (await docker.listNetworks({ filters })).map((item) => item.Id);
        });
        for (const id of ids) {
          await recovery.guard(`remove owned ${kind} ${id.slice(0, 12)}`, async () => {
            const target = kind === "container" ? docker.getContainer(id) : docker.getNetwork(id);
            const inspected = await target.inspect();
            const labels = "Config" in inspected ? inspected.Config.Labels : inspected.Labels;
            const name = inspected.Name.replace(/^\//, "");
            assert.equal(labels?.[OWNER_LABEL], state.owner);
            assert.ok(
              resources.some(
                (resource) =>
                  resource.kind === kind &&
                  resource.name === name &&
                  (!resource.id || resource.id === id),
              ),
            );
            await target.remove(kind === "container" ? { force: true, v: true } : {});
          });
        }
      }
    }
    await recover();
    // A timed-out creation may finish during disposal. Give it a bounded chance
    // to settle and recover again. Unsettled work can never certify absence.
    if (pending.labels().length) {
      try {
        await bounded(
          "settle startup/disposal",
          () => pending.settle(),
          Math.min(5000, totalDeadline - Date.now()),
        );
      } catch {
        /* Recorded explicitly in pendingOperations below. */
      }
      await recover();
    }
    errors.push(...recovery.errors);
    const verification = new CleanupBudget(Math.min(10_000, totalDeadline - Date.now()), 5000);
    let resourcesAbsent = true;
    for (const kind of ["container", "network"] as const) {
      const verified = await verification.guard(`verify absence of owned ${kind}s`, async () => {
        const remaining =
          kind === "container"
            ? await docker.listContainers({ all: true, filters })
            : await docker.listNetworks({ filters });
        assert.equal(remaining.length, 0);
      });
      resourcesAbsent = verified && resourcesAbsent;
    }
    errors.push(...verification.errors);
    const pendingOperations = pending.labels();
    if (pendingOperations.length)
      errors.push(
        `Unsettled operations: ${pendingOperations.join(", ")}; late resource creation cannot be excluded`,
      );
    let processGroupAbsent = !app?.pid;
    try {
      processGroupAbsent = !app?.pid || !processGroupExists(app.pid);
    } catch (error) {
      errors.push(`Process group verification failed: ${String(error)}`);
    }
    if (!processGroupAbsent) errors.push("Owned dev process group remains");
    const absenceVerified = resourcesAbsent && processGroupAbsent && pendingOperations.length === 0;
    // Keep the closed creation/start gates installed if asynchronous startup is
    // still alive. Restoring them would allow a late continuation to escape.
    if (!pendingOperations.length) {
      client.container.create = originalCreateContainer;
      client.network.create = originalCreateNetwork;
      client.container.connectToNetwork = originalConnect;
      client.container.start = originalStart;
    }
    state.phase = "stopped";
    state.cleanup = {
      absenceVerified,
      resourcesAbsent,
      processGroupAbsent,
      pendingOperations,
      errors,
    };
    if (failure) state.failure = failure instanceof Error ? failure.stack : String(failure);
    await bounded("save final state", persist, 5000);
    console.log(
      `Owned resource/process cleanup verified: ${absenceVerified}; errors: ${errors.length}`,
    );
  }
  if (failure || errors.length)
    throw new Error(`Network preview failed; private diagnostics: ${statePath}`);
}
