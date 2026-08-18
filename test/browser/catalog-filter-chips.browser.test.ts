import { expect, test, type Page } from "@playwright/test";

async function mockCatalogApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
      });
    }
    if (url.pathname === "/api/auth/campus") {
      return route.fulfill({
        json: {
          enabled: false,
          reason: "not_whitelisted",
          loginPath: "/login",
          logoutPath: "/logout",
        },
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
    if (url.pathname === "/api/courses/departments") {
      return route.fulfill({ json: { items: ["人文学院", "体育学院"] } });
    }
    if (url.pathname === "/api/teachers") {
      return route.fulfill({
        json: {
          items: [{ id: 9, name: "测试教师", department: "人文学院" }],
          page: 1,
          pageSize: 50,
          total: 1,
          pages: 1,
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

test.beforeEach(async ({ page }) => mockCatalogApi(page));

test("current filters render as removable official tags", async ({ page }) => {
  await page.goto("/courses?q=篮球&category=sports&department=体育学院");
  const summary = page.getByLabel("当前筛选");
  await expect(summary.getByText("关键词“篮球”")).toBeVisible();
  await expect(summary.getByText("体育课")).toBeVisible();
  await expect(summary.getByText("院系“体育学院”")).toBeVisible();

  await page.getByRole("button", { name: "移除关键词“篮球”" }).click();
  await expect(page).toHaveURL(/category=sports/);
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(summary.getByText("关键词“篮球”")).toHaveCount(0);
  await expect(summary.getByText("体育课")).toBeVisible();
});
