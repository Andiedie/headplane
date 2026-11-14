import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";

import { I18nProvider } from "~/i18n/react";
import { usePolicyDiagnostic } from "~/routes/acls/components/policy-diagnostics";
import RulesEditor from "~/routes/acls/components/rules-editor";
import TagsGroupsEditor from "~/routes/acls/components/tags-groups-editor";
import ManageNS from "~/routes/dns/components/manage-ns";
import ManageRecords from "~/routes/dns/components/manage-records";
import { parsePolicy } from "~/utils/acl-policy";

function render(element: ReactNode, locale?: "en" | "zh-CN") {
  const router = createMemoryRouter([
    {
      path: "/",
      element: locale ? createElement(I18nProvider, { locale, children: element }) : element,
    },
  ]);
  try {
    return renderToStaticMarkup(createElement(RouterProvider, { router }));
  } finally {
    router.dispose();
  }
}

test("Chinese policy rendering preserves unknown actions, selectors and machine names", () => {
  const raw = `{
    "groups": {"group:eng": ["alice@"]},
    "tagOwners": {"tag:web": ["group:eng"]},
    "acls": [{"action": "future-action", "src": ["group:eng"], "dst": ["tag:web:80,443"], "proto": "tcp"}],
    "ssh": [{"action": "check", "src": ["group:eng"], "dst": ["tag:web"], "users": ["autogroup:nonroot"]}],
    "grants": [{"src": ["group:eng"], "dst": ["autogroup:internet"], "ip": ["tcp:443"], "via": ["tag:router"]}],
    "hosts": {"office": "100.64.0.0/24"},
    "autoApprovers": {"exitNode": ["group:eng"]}
  }`;
  const parsed = parsePolicy(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const before = structuredClone(parsed.policy);
  const rules = createElement(RulesEditor, {
    policy: parsed.policy,
    onChange: () => {
      throw new Error("Rendering must not edit the policy");
    },
    isDisabled: false,
    canEditGrants: true,
    sources: [],
    destinations: [],
  });
  const english = render(rules);
  const chinese = render(rules, "zh-CN");
  expect(english).toContain("Access rules");
  expect(chinese).toContain("访问规则");
  expect(chinese).toContain('aria-label="编辑"');
  expect(chinese).toContain("出口节点");
  for (const value of [
    "future-action",
    "group:eng",
    "tag:web:80,443",
    "tcp",
    "check",
    "autogroup:nonroot",
    "autogroup:internet",
    "tcp:443",
    "tag:router",
    "office",
    "100.64.0.0/24",
  ]) {
    expect(english).toContain(value);
    expect(chinese).toContain(value);
  }
  const tags = createElement(TagsGroupsEditor, {
    policy: parsed.policy,
    onChange: () => {
      throw new Error("Rendering must not edit the policy");
    },
    isDisabled: false,
    users: ["alice"],
    tagUsage: [{ tag: "tag:web", nodes: ["web-01", "中文主机"] }],
  });
  expect(render(tags)).toContain("2 machines: web-01, 中文主机");
  expect(render(tags, "zh-CN")).toContain("2 台设备：web-01, 中文主机");
  expect(parsed.policy).toEqual(before);
});

test("Chinese DNS reordering keeps addresses, priority and boundary controls intact", () => {
  const element = createElement(ManageNS, {
    global: ["1.1.1.1", "2001:db8::53"],
    split: { "corp.example.com": ["10.0.0.53"] },
    isDisabled: false,
  });
  const english = render(element);
  const chinese = render(element, "zh-CN");
  expect(english).toContain('aria-label="Move 1.1.1.1 up"');
  expect(chinese).toContain('aria-label="上移 1.1.1.1"');
  const firstUp = chinese.match(/<button\b[^>]*aria-label="上移 1\.1\.1\.1"[^>]*>/)?.[0];
  const lastDown = chinese.match(/<button\b[^>]*aria-label="下移 2001:db8::53"[^>]*>/)?.[0];
  expect(firstUp).toContain('disabled=""');
  expect(lastDown).toContain('disabled=""');
  expect(chinese).toContain("corp.example.com");
  expect(chinese).toContain("10.0.0.53");
  expect(chinese.indexOf("1.1.1.1")).toBeLessThan(chinese.indexOf("2001:db8::53"));
  const records = createElement(ManageRecords, {
    records: [{ name: "v6.corp.example.com", type: "AAAA", value: "2001:db8::42" }],
    hasRecordsFile: true,
    isDisabled: false,
    isReadOnly: true,
  });
  const recordMarkup = render(records, "zh-CN");
  expect(recordMarkup).toContain("写入权限");
  expect(recordMarkup).toContain("dns.extra_records_path");
  expect(recordMarkup).toContain("v6.corp.example.com");
  expect(recordMarkup).toContain("AAAA");
  expect(recordMarkup).toContain("2001:db8::42");
});

function Diagnostic({ message }: { message: string }) {
  const diagnostic = usePolicyDiagnostic();
  return createElement("p", null, diagnostic(message));
}

test("policy diagnostics translate real parse failures without rewriting unknown details", () => {
  const parsed = parsePolicy('{\n  "hosts":\n}');
  if (parsed.ok) throw new Error("Expected an invalid policy");
  expect(render(createElement(Diagnostic, { message: parsed.error }))).toContain(parsed.error);
  expect(render(createElement(Diagnostic, { message: parsed.error }), "zh-CN")).toContain(
    "缺少值（第 3 行，第 1 列）",
  );
  const detail = "Future parser detail for tag:web at line 9, column 2";
  expect(render(createElement(Diagnostic, { message: detail }), "zh-CN")).toContain(detail);
});
