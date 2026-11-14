---
title: Network overview
description: Inspect reported relay preferences, manage a DERP map, and optionally retain observations.
---

The **Network** page combines Headscale's node API with the existing Headplane
Agent's host information. It does not query device operating systems, run SSH
commands, or require additional software on devices.

## Available information

The overview shows control-plane online status, pending subnet routes, expiring
keys, reported home DERP regions, and client-reported DERP latency. The Agent
provides the latter two; absent reports remain unknown. UDP and IPv6 reports
are capability observations, not proof of a current direct connection.

The relationship view groups devices by their reported home region and lists
approved subnet routes. It is a logical view, not a packet trace. Home DERP is
not necessarily the path used for a connection. Neither the map nor native
DERP statistics includes peer-to-peer direct traffic.

The page requires **read network** permission. Selecting a relay requires
**write network** permission. Existing device and route management stays on
the Machines page.

## Managed relay selection

Relay selection is optional. With no `network.relays` configuration, the page
is read-only and existing deployments keep their routing behavior.

Prepare a DERP catalog containing all selectable regions and a separate
Headscale YAML file containing the selected single region. The catalog can use
protocol JSON or native YAML. The selected file must use lowercase native
fields and numeric region keys; it is not the client protocol JSON format.
Configure Headscale to read
only the selected file, then restart Headscale as part of the operator's normal
maintenance procedure:

```yaml
# Headscale configuration (existing supported options)
derp:
  server:
    automatically_add_embedded_derp_region: false
  urls: []
  paths:
    - /etc/headscale/selected-derp.yaml
  auto_update_enabled: true
  update_frequency: 15s
```

Retain the existing `derp.server` settings when using an embedded DERP; the
example only shows the relevant selection settings. Both relay services can
continue running. This selects which region Headscale advertises, not which
service runs.

Configure Headplane's paths separately when containers mount the files at
different locations:

```yaml
network:
  relays:
    catalog_path: /etc/headplane/derp-catalog.json
    map_path: /etc/headplane/selected-derp.yaml
    headscale_path: /etc/headscale/selected-derp.yaml
```

`map_path` and Headscale's path must refer to the same shared file. Mount its
parent directory, rather than an individual file, so atomic replacement is
visible in both containers. Keep the catalog separate from the output and
Headscale configuration. Use absolute paths to separate regular files, with
no symlinks in their parent paths or hard links; each file is limited to 2 MiB.

The backend validates the catalog and Headscale configuration before writing,
serializes selections, and rejects a stale form when another writer changed
the file. A selection writes native Headscale YAML regardless of the filename extension
and replaces only the managed map; it does not restart
Headscale, change ACLs, or rewrite the main Headscale configuration. Existing
Headscale scheduled refreshes load the map.

**Saved** confirms the file write, not runtime adoption. The page separately
shows the configured refresh interval and how many reporting online devices
match the selection. It does not claim every client has switched. Reconnect a
client if necessary after the normal refresh. Connections using a removed
relay can briefly interrupt; direct connections need not use the chosen relay.

## Native DERP statistics

Metrics sources are configured by the operator, not supplied by browser
requests. Supported input is DERP expvar JSON (including a `derp` wrapper) or
Prometheus text containing the equivalent connection and byte counters.

```yaml
network:
  poll_interval: 30000 # milliseconds
  metrics:
    - id: primary
      name: Primary relay
      region_id: 901
      url: http://127.0.0.1:9091/debug/vars
```

Point `url` at the statistics endpoint exposed by the actual DERP deployment.
Endpoint availability and access controls vary between independent `derper`
and Headscale's embedded relay. Do not expose debug endpoints publicly merely
to enable this page. URLs containing credentials or fragments are rejected;
redirects are not followed and responses have a size limit and timeout.

Sent and received counters are separate. They must not be added together as
unique transferred data. Rates require two successful monotonic samples;
restarts, counter resets, missing fields, or failed observations produce
unknown rates. Per-device traffic and arbitrary device-to-device paths are
not inferred from aggregate counters.

## Optional history

History is off by default. Enable it with a server API key and explicit bounds:

```yaml
network:
  poll_interval: 30000
  history:
    enabled: true
    retention_days: 7
    max_rows: 10000
```

One additive SQLite table, `network_history`, holds observation events,
relay samples, and dashboard operations. Operations include the actor, action,
target identifier, and outcome, without submitted form values or credentials. Existing tables and Headscale's
database are unchanged. Retention is bounded by both age and total row count.
The page shows recent retained records; it is not a billing system or a
complete security audit log.

Node history records initial observations and observed changes in online or
home-region state, rather than a duplicate record at every poll. Failed API
requests do not mark all nodes offline. Agent information may lag the control
API. History starts when enabled and polling may miss brief transitions.

Keep `server.data_path` persistent to retain history. The standard upstream
Drizzle migration mechanism creates the additive table; older Headplane builds
ignore it. Disable recording before returning to an older build. No separate
database, collector service, or client changes are required.

## Local acceptance preview

The repository includes an opt-in isolated preview harness under
`tests/harness/network-preview.ts`. It creates disposable Headscale/Tailscale
containers and runs Headplane on a loopback-only port. Clients and relays stay
on an internal Docker network. Headscale also uses a dedicated, run-owned
bridge when Docker Desktop requires it for loopback access; Headscale retains
outbound access through that bridge. The exact topology is recorded in the
private state file.

The launcher discards inherited `HEADPLANE_*` settings, validates its generated
configuration, and pins provisioning and cleanup to one local Docker daemon.
It never reads production configurations or credentials. Follow the preview
launcher's instructions and stop it to remove only its own resources.

Launch from the repository root with Node 24 after installing dependencies:

```sh
pnpm install --frozen-lockfile
node tests/harness/network-preview-launch.ts --port=8847
```

The launcher prints the preview URL and a private state file. Log in using the
`headscale.apiKey` field in that file. All credentials are generated for this
disposable network. Keep the state file private. Stop with Ctrl+C, or send
SIGTERM to the `pid` in the state file, to remove only that run's resources.
Use `--check` for a non-interactive smoke check that cleans up on completion.

Use the preview to inspect known/unknown reports, select between the lab's
regions, check role restrictions and history, and verify the actual map seen
by the test clients. Passing a lab test is not a production deployment or a
compatibility claim for every third-party Tailscale client.
