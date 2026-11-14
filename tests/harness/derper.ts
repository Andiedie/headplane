import { execFile } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";

import tc from "testcontainers";

import { bounded } from "./preview-safety";
import type { Tailnet } from "./tailnet";
import { TAILSCALE_IMAGE } from "./versions";
import { waitFor } from "./wait";

const exec = promisify(execFile);

// Build the original, unmodified derper from this checkout's pinned Go module.
// Nothing is installed on the host and no existing Tailscale process is used.
export async function buildDerper(directory: string, arch: string, signal?: AbortSignal) {
  const binary = join(directory, "derper");
  // derper has dependencies the app doesn't use. Resolve those only in the
  // private build directory; never update the checkout's go.mod or go.sum.
  const modfile = join(directory, "derper.go.mod");
  await copyFile("go.mod", modfile);
  await copyFile("go.sum", join(directory, "derper.go.sum"));
  await exec(
    "go",
    ["build", "-mod=mod", `-modfile=${modfile}`, "-o", binary, "tailscale.com/cmd/derper"],
    {
      env: { ...process.env, GOOS: "linux", GOARCH: arch, CGO_ENABLED: "0" },
      timeout: 600_000,
      signal,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return binary;
}

export type PreviewDerper = Awaited<ReturnType<typeof startDerper>>;

export async function startDerper(options: {
  tailnet: Tailnet;
  binary: string;
  directory: string;
  regionId: number;
  code: string;
  name: string;
  signal?: AbortSignal;
}) {
  const { tailnet, regionId, code, name } = options;
  const hostname = `preview-${code}`;
  const directory = join(options.directory, code);
  await mkdir(directory, { mode: 0o700 });
  const certPath = join(directory, `${hostname}.crt`);
  const keyPath = join(directory, `${hostname}.key`);
  await exec(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-days",
      "7",
      "-subj",
      `/CN=${hostname}`,
      "-addext",
      `subjectAltName=DNS:${hostname}`,
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { timeout: 10_000, signal: options.signal },
  );
  const certificate = new X509Certificate(await readFile(certPath));
  const fingerprint = createHash("sha256").update(certificate.raw).digest("hex");
  const container = await new tc.GenericContainer(TAILSCALE_IMAGE)
    .withNetwork(tailnet.network)
    .withNetworkAliases(hostname)
    .withName(`hp-network-${tailnet.id}-${code}`)
    .withEntrypoint(["/preview/derper"])
    .withCommand([
      "-a=:443",
      "-http-port=80",
      "-stun=true",
      "-verify-clients=false",
      "-certmode=manual",
      "-certdir=/preview/certs",
      `-hostname=${hostname}`,
      "-c=/preview/derper.key",
    ])
    .withCopyFilesToContainer([
      { source: options.binary, target: "/preview/derper", mode: 0o755 },
      { source: certPath, target: `/preview/certs/${hostname}.crt` },
      { source: keyPath, target: `/preview/certs/${hostname}.key`, mode: 0o600 },
    ])
    .withWaitStrategy(tc.Wait.forLogMessage("with TLS"))
    .withStartupTimeout(30_000)
    .start();

  // derper restricts debug endpoints to loopback. This transport reads the
  // original endpoint inside this container and forwards the body unchanged.
  // No DERP or metrics port is published by Docker.
  async function metrics() {
    const result = await bounded(
      `${code} metrics exec`,
      () => container.exec(["wget", "-q", "-T", "5", "-O", "-", "http://127.0.0.1/debug/vars"]),
      7000,
      options.signal,
    );
    if (result.exitCode !== 0) throw new Error(`Native metrics unavailable for ${code}`);
    return result.stdout;
  }

  let bridge: ReturnType<typeof createServer> | undefined;
  try {
    await bounded(
      `${code} native metrics readiness`,
      () =>
        waitFor(`${code} native metrics`, async () => {
          const body = JSON.parse(await metrics());
          if (typeof body.derp?.gauge_current_connections !== "number") {
            throw new Error("Original derper did not report its connections counter");
          }
        }),
      30_000,
      options.signal,
    );
    options.signal?.throwIfAborted();
    bridge = createServer(async (request, response) => {
      if (request.method !== "GET" || request.url !== "/debug/vars") {
        response.writeHead(404).end();
        return;
      }
      try {
        const body = await metrics();
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(body);
      } catch {
        response.writeHead(502).end("Native derper metrics unavailable\n");
      }
    });
    await new Promise<void>((resolve, reject) => {
      bridge!.once("error", reject);
      bridge!.listen(0, "127.0.0.1", resolve);
    });
    const metricsUrl = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}/debug/vars`;
    return {
      container,
      metrics,
      metricsUrl,
      region: {
        RegionID: regionId,
        RegionCode: code,
        RegionName: name,
        Nodes: [
          {
            Name: `${code}-1`,
            RegionID: regionId,
            HostName: hostname,
            CertName: `sha256-raw:${fingerprint}`,
            DERPPort: 443,
            STUNPort: 3478,
            IPv6: "none",
          },
        ],
      },
      async closeBridge() {
        bridge!.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          bridge!.close((error) => (error ? reject(error) : resolve())),
        );
      },
    };
  } catch (error) {
    bridge?.closeAllConnections();
    bridge?.close();
    // The preview's bounded ownership recovery removes this container even if
    // startup never returned its handle. Don't block recovery on another stop.
    throw error;
  }
}
