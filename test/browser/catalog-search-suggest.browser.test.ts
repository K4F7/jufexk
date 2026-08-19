/**
 * Browser coverage for Issue #286: catalog search suggestions.
 */
import { expect, test, type Page } from "@playwright/test";

const COURSE = {
  id: 8,
  code: "GEN0108",
  name: "高等数学",
  category: "general",
  department: "人文学院",
  teachers: "测试教师",
  teacher_refs: "9:测试教师",
  review_count: 1,
  rating: null,
};

const TEACHER = {
  id: 9,
  name: "张三",
  department: "人文学院",
  title: "讲师",
};

async function mockCatalogApi(page: Page, options: { failSuggest?: boolean } = {}) {
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
    if (url.pathname === "/api/courses/departments") {
      return route.fulfill({ json: { items: ["人文学院"] } });
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
    if (url.pathname === "/api/courses") {
      if (options.failSuggest && url.searchParams.get("pageSize") === "8") {
        return route.fulfill({
          status: 500,
          json: { error: "suggest failed" },
        });
      }
      const query = url.searchParams.get("q") || "";
      const items = query && COURSE.name.includes(query) ? [COURSE] : [];
      return route.fulfill({
        json: {
          items,
          page: 1,
          pageSize: Number(url.searchParams.get("pageSize") || 20),
          total: items.length,
          pages: 1,
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test("course search shows suggestions and selecting writes q", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/courses");
  await page.getByRole("searchbox", { name: "搜索课程" }).fill("高等");
  const option = page.getByRole("option", { name: /高等数学/ });
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
  await expect(page).toHaveURL(/q=/);
  expect(decodeURIComponent(page.url())).toContain("q=高等数学");
});

test("teacher search shows suggestions symmetrically", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/teachers");
  await page.getByRole("searchbox", { name: "搜索教师" }).fill("张");
  const option = page.getByRole("option", { name: /张三/ });
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
  expect(decodeURIComponent(page.url())).toContain("q=张三");
});

test("no input does not show a suggestion list", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/courses");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("failed suggestion request stays silent", async ({ page }) => {
  await mockCatalogApi(page, { failSuggest: true });
  await page.goto("/courses");
  await page.getByRole("searchbox", { name: "搜索课程" }).fill("高等");
  await page.waitForTimeout(500);
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("没有匹配的建议")).toHaveCount(0);
});
