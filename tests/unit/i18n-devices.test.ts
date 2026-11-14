import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";

import { I18nProvider } from "~/i18n/react";
import { MachineFilters } from "~/routes/machines/components/machine-filters";
import { ErrorBoundary as MachinesError } from "~/routes/machines/overview";
import HeadplaneUserRow from "~/routes/users/components/headplane-user-row";
import MachinesSeen from "~/routes/users/components/machines-seen";
import { ErrorBoundary as UsersError } from "~/routes/users/overview";

function render(element: ReactElement, locale?: "en" | "zh-CN") {
  const router = createMemoryRouter([{ path: "/", element }], {
    initialEntries: ["/?status=offline&route=exit-node"],
  });
  const page = createElement(RouterProvider, { router });
  try {
    return renderToStaticMarkup(
      locale ? createElement(I18nProvider, { locale, children: page }) : page,
    );
  } finally {
    router.dispose();
  }
}

test("machine filters translate active labels without changing query values", () => {
  const filters = createElement(MachineFilters, { users: [], populatedNodes: [] });
  expect(render(filters)).toContain("Offline");
  const chinese = render(filters, "zh-CN");
  expect(chinese).toContain("离线");
  expect(chinese).toContain("出口节点");
  expect(chinese).toContain("清除筛选");
});

const forbidden = { status: 403, statusText: "Forbidden", internal: false, data: null };
test.each([
  [
    "machines",
    "设备",
    createElement(MachinesError, { error: forbidden } as Parameters<typeof MachinesError>[0]),
  ],
  [
    "users",
    "用户",
    createElement(UsersError, { error: forbidden } as Parameters<typeof UsersError>[0]),
  ],
] as const)("the %s access error translates its page name", (englishName, chineseName, element) => {
  expect(render(element)).toContain(`access to ${englishName}`);
  expect(render(element, "zh-CN")).toContain(`你没有访问${chineseName}的权限`);
});

test("user rows translate roles while retaining account identity and the English default", () => {
  const row = createElement(HeadplaneUserRow, {
    user: {
      id: "user-01",
      sub: "subject-original",
      name: "Network Admin",
      email: "viewer@example.com",
      role: "network_admin",
      headscaleUserId: null,
      createdAt: null,
      lastLoginAt: null,
      machines: [],
      groups: ["group:original"],
    },
    headscaleUsers: [],
  });
  const english = render(row);
  expect(english).toContain("Not linked");
  expect(english).toContain("No machines");
  const chinese = render(row, "zh-CN");
  expect(chinese).toContain("网络管理员");
  expect(chinese).toContain("尚未关联");
  expect(chinese).toContain("Network Admin");
  expect(chinese).toContain("viewer@example.com");
  expect(chinese).toContain("group:original");
});

test("machine last-seen text and timestamp tooltip use the selected locale", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-04T12:00:00Z"));
  try {
    const lastSeen = "2026-01-01T12:00:00Z";
    const status = createElement(MachinesSeen, { machines: [{ online: false, lastSeen }] });
    expect(render(status)).toContain("3 days ago");
    const chinese = render(status, "zh-CN");
    expect(chinese).toContain("3天前");
    expect(chinese).toContain(new Date(lastSeen).toLocaleString("zh-CN"));
  } finally {
    vi.useRealTimers();
  }
});
