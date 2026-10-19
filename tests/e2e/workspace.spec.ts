import { expect, test } from "@playwright/test";

const DEMO_URL =
  "/book/demo-three-kingdoms/chi-bi-50?analysis=demo-chibi-analysis";

test.beforeAll(async ({ request }) => {
  const response = await request.post("/api/demo/seed");
  expect(response.ok()).toBeTruthy();
});

test.describe("workspace", () => {
  test("loads the curated atlas and links map features to evidence", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("hmr")) {
        errors.push(message.text());
      }
    });

    await page.goto(DEMO_URL);
    await expect(page.getByRole("heading", { name: /第五十回/ })).toBeVisible();
    await expect(page.locator("canvas.maplibregl-canvas")).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(page.locator(".maplibregl-marker").first()).toBeVisible();
    const markerPosition = await page
      .locator(".maplibregl-marker")
      .first()
      .evaluate((element) => getComputedStyle(element).position);
    expect(markerPosition).toBe("absolute");

    const expandDetails = page.getByRole("button", {
      name: "展开态势详情",
    });
    if (await expandDetails.count()) {
      await expandDetails.click();
      await expect(page.getByText("态势详情", { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "查看赤壁" }).click();
    await expect(page.getByText("赤壁").first()).toBeVisible();
    await expect(page.locator(".reader-paragraph-highlight").first()).toBeVisible();

    await page.getByRole("button", { name: "下一幕" }).click();
    await expect(page.locator(".maplibregl-marker").first()).toBeVisible();

    await expect(
      page.getByRole("button", { name: /追问|问一句/ }),
    ).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("mobile reader and atlas tabs stay usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DEMO_URL);
    await expect(page.getByRole("heading", { name: /第五十回/ })).toBeVisible();

    const title = page.locator('[aria-label="阅读器"] h2').first();
    const titleBox = await title.boundingBox();
    expect(titleBox?.width ?? 0).toBeGreaterThan(300);

    await page.getByRole("button", { name: "舆图" }).click();
    await expect(page.locator("canvas.maplibregl-canvas")).toHaveCount(1, {
      timeout: 30_000,
    });
    const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(300);

    await expect(page.getByRole("button", { name: "追问" })).toHaveCount(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
