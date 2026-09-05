/**
 * Browser coverage for catalog search.
 * Issue #402 后课程目录的页内搜索上移到顶栏（纯提交，无建议）。
 */
import { expect, test, type Page } from "@playwright/test";

async function mockCatalogApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: { siteName: "非官方课评@JUFE", universityName: "江西财经大学", admin: false },
      });
    }
    if (url.pathname === "/api/user/session") {
      return route.fulfill({
        json: {
          authenticated: false,
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    }
    if (url.pathname === "/api/courses") {
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

async function searchQuery(page: Page) {
  return new URL(page.url()).searchParams.get("q");
}

test("shell course search submits to /courses?q= without suggestions @pr-smoke", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/courses");
  const search = page.getByRole("searchbox", { name: "搜索课程" });
  await expect(search).toBeVisible();
  await search.fill("高等");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await search.press("Enter");
  await expect.poll(() => searchQuery(page)).toBe("高等");
});
