import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";

import { I18nProvider } from "~/i18n/react";
import { History, Overview, Relays } from "~/routes/network/panels";
import { summarizeNetwork } from "~/server/network/snapshot";

type Data = Parameters<typeof Relays>[0]["data"];

function data(): Data {
  return {
    snapshot: summarizeNetwork([], {}, [], 0),
    observedAt: 0,
    relay: {
      regions: [{ id: 901, code: "private-901", name: "Operator relay" }],
      selectedRegionId: 901,
      revision: "technical-revision",
      writable: true,
    },
    agent: { enabled: false, syncedAt: null, error: null },
    metrics: [
      {
        id: "relay-test",
        name: "Operator metric",
        regionId: 901,
        observedAt: 0,
        connections: null,
        receivedBytes: 0,
        sentBytes: 0,
        rxBytesPerSecond: 0.25,
        txBytesPerSecond: null,
      },
    ],
    history: [0, 1000].map((observedAt, id) => ({
      id,
      observedAt,
      kind: "relay",
      entityId: "relay-test",
      payload: { rxBytesPerSecond: 0.25 },
    })),
    historyEnabled: true,
    historyReason: null,
    collectionError: null,
    pollInterval: 30000,
    canSelectRelay: true,
  };
}

function render(element: ReactNode) {
  const router = createMemoryRouter([{ path: "/", element }]);
  try {
    return renderToStaticMarkup(
      createElement(I18nProvider, {
        locale: "zh-CN",
        children: createElement(RouterProvider, { router }),
      }),
    );
  } finally {
    router.dispose();
  }
}

test("Chinese relay presentation keeps form identifiers and operator data intact", () => {
  const fixture = data();
  fixture.relay.reason = "Relay configuration changed. Reload before selecting a region.";
  const markup = render(createElement(Relays, { data: fixture }));
  expect(markup).toContain("保存中继选择");
  expect(markup).toContain("中继配置已更改，请刷新页面后再选择区域。");
  expect(markup).toContain('aria-label="每秒接收字节数，');
  expect(markup).toContain("峰值 0.25 B/s");
  expect(markup).toContain("0 台上报信息的在线设备中有 0 台匹配");
  expect(markup).toContain("Operator relay");
  expect(markup).toContain("Operator metric");
  expect(markup).toContain("private-901");
  expect(markup).toContain('name="intent" value="select-relay"');
  expect(markup).toContain('name="revision" value="technical-revision"');
  expect(markup).toContain('name="region"');
  expect(markup).toContain('value="901"');
});

test("Chinese activity translates status and targets while preserving audit identifiers", () => {
  const fixture = data();
  fixture.history = [
    {
      id: 1,
      observedAt: 0,
      kind: "action",
      entityId: "87654321",
      payload: {
        intent: "delete",
        path: "/admin/machines",
        target: "87654321",
        actor: "owner",
        outcome: "success",
      },
    },
    {
      id: 2,
      observedAt: 0,
      kind: "action",
      entityId: "relay-selection",
      payload: {
        region: 901,
        actor: "api-key-session",
        outcome: "saved",
      },
    },
    {
      id: 3,
      observedAt: 0,
      kind: "node",
      entityId: "node-3",
      payload: {
        name: "Original device name",
        online: false,
        homeRegion: null,
      },
    },
  ];
  const markup = render(createElement(History, { data: fixture }));
  expect(markup).toContain("设备 87654321");
  expect(markup).toContain('title="delete"');
  expect(markup).toContain("删除");
  expect(markup).toContain("/admin/machines · 成功 · 操作者 owner");
  expect(markup).toContain("区域 901 · 已保存 · 操作者 api-key-session");
  expect(markup).toContain("离线 · 归属中继 未上报");
  expect(markup).toContain("Original device name");
  expect(markup).toContain('dateTime="1970-01-01T00:00:00.000Z"');
  expect(markup).toContain(
    new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "long",
      timeZone: "UTC",
    }).format(new Date(0)),
  );
});

test("Chinese device details preserve operator names and safely interpolate network data", () => {
  const fixture = data();
  fixture.relay.regions[0].name = "Region 901";
  fixture.snapshot.nodes = [
    {
      id: "12345678",
      name: "<device & name>",
      online: true,
      expired: true,
      lastSeen: "1970-01-01T00:00:00.000Z",
      expiry: null,
      ipAddresses: ["100.64.0.1", "fd7a:115c:a1e0::1"],
      homeRegion: 901,
      homeName: "Region 901",
      latencies: [{ regionId: 902, regionName: "Region 902", family: "v4", milliseconds: 12.5 }],
      approvedRoutes: ["10.0.0.0/24"],
      pendingRoutes: [],
      os: "Linux",
      version: "1.0-technical",
      udp: true,
      ipv6: false,
      natVaries: null,
      endpoints: ["192.0.2.1:41641"],
    },
  ];
  const markup = render(createElement(Overview, { data: fixture }));
  expect(markup).toContain("1 台已连接到 Headscale");
  expect(markup).toContain('aria-label="在线"');
  expect(markup).toContain("UDP 是 · IPv6 否");
  expect(markup).toContain("已过期");
  expect(markup).toContain("Region 901");
  expect(markup).toContain("区域 902");
  expect(markup).toContain("12.5 毫秒");
  expect(markup).toContain("&lt;device &amp; name&gt;");
  expect(markup).not.toContain("<device & name>");
  expect(markup).toContain("Linux · 1.0-technical");
  expect(markup).toContain("100.64.0.1, fd7a:115c:a1e0::1");
  expect(markup).toContain("192.0.2.1:41641");
  expect(markup).toContain("10.0.0.0/24");
  expect(markup).toContain('href="/machines/12345678"');
});

test("Chinese empty and unavailable states retain unknown technical diagnostics", () => {
  const fixture = data();
  expect(render(createElement(Overview, { data: fixture }))).toContain("尚未注册任何设备。");
  fixture.historyEnabled = false;
  fixture.historyReason = "History requires a configured Headscale API key.";
  expect(render(createElement(History, { data: fixture }))).toContain(
    "历史记录需要配置 Headscale API 密钥。",
  );
  fixture.relay.reason = "Unknown diagnostic: E_IO /relay/custom.yaml";
  fixture.metrics[0].error = "Metrics endpoint returned HTTP 503.";
  const markup = render(createElement(Relays, { data: fixture }));
  expect(markup).toContain("Unknown diagnostic: E_IO /relay/custom.yaml");
  expect(markup).toContain("指标端点返回 HTTP 503。");
});
