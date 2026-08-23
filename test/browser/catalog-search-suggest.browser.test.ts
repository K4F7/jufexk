/**
 * Browser coverage for Issue #286: catalog search suggestions.
 * Issue #402 后课程目录的页内搜索上移到顶栏（纯提交，无建议）；
 * 建议交互仍在教师目录的页内搜索上。
 */
import { expect, test, type Page } from "@playwright/test";

const TEACHER = {
  id: 9,
  name: "张三",
  department: "人文学院",
  title: "讲师",
};

async function mockCatalogApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
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
    if (url.pathname === "/api/auth/campus") {
      return route.fulfill({
        json: {
          enabled: false,
          reason: "not_whitelisted",
          loginPath: "/login",
          logoutPath: "/logout",
          callbackPath: "/api/auth/callback",
        },
      });
    }
    if (url.pathname === "/api/teachers") {
      const query = url.searchParams.get("q") || "";
      const items = query && TEACHER.name.includes(query) ? [TEACHER] : [];
      return route.fulfill({
        json: {
          items,
          page: 1,
          pageSize: Number(url.searchParams.get("pageSize") || 50),
          total: items.length,
          pages: 1,
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

async function searchQuery(page: Page) {
  return new URL(page.url()).searchParams.get("q");
}

test("teacher search shows suggestions and selecting writes q", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/teachers");
  await page.getByRole("searchbox", { name: "搜索教师" }).fill("张");
  const option = page.getByRole("option", { name: /张三/ });
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
  await expect.poll(() => searchQuery(page)).toBe("张三");
});

test("escape closes suggestions without clearing the field", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/teachers");
  const search = page.getByRole("searchbox", { name: "搜索教师" });
  await search.fill("张");
  await expect(page.getByRole("option", { name: /张三/ })).toBeVisible({
    timeout: 5000,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(search).toHaveValue("张");
});

test("shell course search submits to /courses?q= without suggestions", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/courses");
  const search = page.getByRole("searchbox", { name: "搜索课程" });
  await expect(search).toBeVisible();
  await search.fill("高等");
  // 顶栏搜索不带建议下拉。
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await search.press("Enter");
  await expect.poll(() => searchQuery(page)).toBe("高等");
});
