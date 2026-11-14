import { expect, test } from "vitest";

import { loader as rootLoader } from "~/root";
import { machineAction } from "~/routes/machines/machine-actions";
import { action as setLanguage } from "~/routes/util/locale";

import { createTailnet } from "../../harness/tailnet";
import { statusOf } from "../../support/app";

test("language changes work before login and preserve permissions under a custom base path", async () => {
  await using tailnet = await createTailnet();
  const app = await tailnet.headplane({ config: { server: { base_path: "/console" } } });

  const selected = await app.call(setLanguage, "/api/locale", {
    form: { locale: "zh-CN", returnTo: "/login?next=%2Fmachines" },
  });
  expect(selected).toBeInstanceOf(Response);
  const response = selected as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/login?next=%2Fmachines");
  const languageCookie = response.headers.get("Set-Cookie")!.split(";")[0];

  expect(
    await app.call(rootLoader, "/login", { headers: { Cookie: languageCookie } }),
  ).toMatchObject({ locale: "zh-CN" });
  expect(await app.call(rootLoader, "/login")).toMatchObject({ locale: "en" });

  const viewer = await app.signIn("viewer");
  const form = { intent: "register", register_key: "not-a-machine-key", user: "someone-else" };
  const deniedChinese = await app.call(machineAction, "/machines", {
    as: `${viewer.cookie}; ${languageCookie}`,
    form,
  });
  const deniedEnglish = await app.call(machineAction, "/machines", { as: viewer.cookie, form });
  expect(statusOf(deniedChinese)).toBe(403);
  expect(statusOf(deniedEnglish)).toBe(403);
  expect(JSON.stringify(deniedChinese)).toMatch(/[\u4e00-\u9fff]/);
  expect(JSON.stringify(deniedChinese)).not.toContain("You don't have permission to do this.");
  expect(JSON.stringify(deniedEnglish)).toContain("You don't have permission to do this.");

  const invalid = await app.call(setLanguage, "/api/locale", { form: { locale: "../zh-CN" } });
  expect(statusOf(invalid)).toBe(400);
});
