import { expect, test, type Page } from "@playwright/test";

async function mockPublicApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
      });
    if (url.pathname === "/api/courses")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    if (url.pathname === "/api/teachers")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 50, total: 0, pages: 1 },
      });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test.beforeEach(async ({ page }) => mockPublicApi(page));

test("unknown paths stay on a 404 page instead of redirecting to the catalog", async ({
  page,
}) => {
  await page.goto("/no-such-page");
  await expect(page).toHaveURL(/\/no-such-page$/);
  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回首页" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "课程目录" })).toHaveCount(0);

  await page.getByRole("link", { name: "返回首页" }).click();
  await expect(page).toHaveURL(/\/courses$/);
});
