import { expect, test } from "@playwright/test";

test.beforeAll(async ({ request }) => {
  const response = await request.post("/api/demo/seed");
  expect(response.ok()).toBeTruthy();
  // The settings test needs a configured provider; it deliberately has no key.
  const settings = await request.put("/api/settings", {
    data: {
      provider: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      autoAnalyze: false,
    },
  });
  expect(settings.ok()).toBeTruthy();
});

test("home shows the library and the demo book", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "我的书架" }),
  ).toBeVisible();
  await expect(page.locator(".shelf-tab")).toContainText("全部");
  await expect(
    page.getByRole("button", { name: /导入书籍/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "三国演义（赤壁节选）" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /启卷阅读/ }).first()).toBeVisible();
});

test("settings page renders the provider form without exposing a key", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "模型服务" })).toBeVisible();
  await expect(page.getByText("key 只保存在本机服务端")).toBeVisible();
  await expect(page.locator("select").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /保存 Key/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /保存设置/ })).toHaveCount(0);
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
});

test("settings preferences autosave and night mode persists", async ({ page }) => {
  await page.goto("/settings");
  const autoGenerate = page.getByRole("switch", {
    name: "打开章节时自动生成态势",
  });
  const initial = await autoGenerate.isChecked();
  await autoGenerate.click();
  await expect(autoGenerate).toBeChecked({ checked: !initial });
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "打开章节时自动生成态势" }),
  ).toBeChecked({ checked: !initial });

  await page.goto(
    "/book/demo-three-kingdoms/chi-bi-50?analysis=demo-chibi-analysis",
  );
  await page.getByRole("button", { name: "选择阅读背景色" }).click();
  await page.getByRole("button", { name: "选择夜间背景" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/settings");
  const keyInput = page.getByPlaceholder(/sk-|已保存/);
  await keyInput.fill("local-test-key-only");
  await page.getByRole("button", { name: "保存 Key" }).click();
  await expect(page.getByText("API Key 已保存")).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("local-test-key-only");
});
