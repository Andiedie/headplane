import { X509Certificate } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";
import { parse, stringify } from "yaml";

import { action } from "~/routes/network/overview";

import { createTailnet } from "../../harness/tailnet";
import { testedVersions } from "../../harness/versions";
import { waitFor } from "../../harness/wait";
import { statusOf } from "../../support/app";

const containerMap = "/etc/headscale/selected-derp.yaml";

// This is the local-file format Headscale loads, independent of the protocol
// catalog below. Only the initial state is seeded; every switch uses the action.
const initialMap = (certName: string) => `regions:
  901:
    regionid: 901
    regioncode: lab-a
    regionname: Local lab A
    nodes:
      - name: lab-a-1
        regionid: 901
        hostname: headscale
        derpport: 443
        stunport: -1
        certname: ${certName}
`;
const relayCatalog = (certName: string) => ({
  Regions: {
    "901": {
      RegionID: 901,
      RegionCode: "lab-a",
      RegionName: "Local lab A",
      Nodes: [
        {
          Name: "lab-a-1",
          RegionID: 901,
          HostName: "headscale",
          DERPPort: 443,
          STUNPort: -1,
          CertName: certName,
        },
      ],
    },
    "902": {
      RegionID: 902,
      RegionCode: "lab-b",
      RegionName: "Local lab B",
      Nodes: [
        {
          Name: "lab-b-1",
          RegionID: 902,
          HostName: "headscale",
          DERPPort: 443,
          STUNPort: -1,
          CertName: certName,
        },
      ],
    },
  },
});

describe.each(testedVersions())("native relay selection (Headscale %s)", (version) => {
  test("clients receive only the selected region in both directions through the backend", async () => {
    await using tailnet = await createTailnet({ version });
    const certificate = new X509Certificate(await readFile(tailnet.server.certPath!));
    const pin = `sha256-raw:${certificate.fingerprint256.replaceAll(":", "").toLowerCase()}`;
    const catalog = relayCatalog(pin);
    const directory = await realpath(dirname(tailnet.server.configPath));
    const mapPath = join(directory, "selected-derp.yaml");
    const catalogPath = join(directory, "relay-catalog.json");
    await writeFile(mapPath, initialMap(pin), { mode: 0o644 });
    await writeFile(catalogPath, JSON.stringify(catalog));
    const config = parse(await readFile(tailnet.server.configPath, "utf8"));
    config.derp.server.automatically_add_embedded_derp_region = false;
    config.derp.paths = [containerMap];
    config.derp.urls = [];
    config.derp.auto_update_enabled = true;
    config.derp.update_frequency = "1s";
    await writeFile(tailnet.server.configPath, stringify(config));
    // Restart only this disposable server to enable local-file refresh.
    await tailnet.server.container.restart();
    await waitFor("Headscale with native DERP map", () => tailnet.api.nodes.list());

    const nodes = [
      await tailnet.node({ name: "relay-client-a", user: "relay-test@" }),
      await tailnet.node({ name: "relay-client-b", user: "relay-test@" }),
    ];
    const app = await tailnet.headplane({
      config: {
        network: {
          relays: {
            catalog_path: catalogPath,
            map_path: mapPath,
            headscale_path: containerMap,
          },
        },
      },
    });
    const owner = await app.signIn("owner");

    async function expectRegion(regionId: 901 | 902) {
      await waitFor(
        `both native clients to receive only region ${regionId}`,
        async () => {
          for (const node of nodes) {
            const map = JSON.parse(await node.tailscale(["debug", "derp-map"]));
            expect(Object.keys(map.Regions)).toEqual([String(regionId)]);
            expect(map.Regions[regionId]).toMatchObject(catalog.Regions[regionId]);
          }
        },
        { timeout: 20_000 },
      );
    }

    await expectRegion(901);
    for (const regionId of [902, 901] as const) {
      const before = (await app.ctx.network.read(app.api)).relay;
      expect(before).toMatchObject({ writable: true, revision: expect.any(String) });
      const result = await app.call(action, "/network", {
        as: owner.cookie,
        form: { intent: "select-relay", region: String(regionId), revision: before.revision! },
      });
      expect(statusOf(result), JSON.stringify(result)).toBe(200);
      expect((await app.ctx.network.read(app.api)).relay).toMatchObject({
        selectedRegionId: regionId,
        writable: true,
      });
      // No direct map writes or restarts here: Headscale's scheduled refresh
      // must parse the bytes emitted by Headplane and distribute the new map.
      await expectRegion(regionId);
    }
  });
});
