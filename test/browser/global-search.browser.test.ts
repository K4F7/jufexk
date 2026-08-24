/**
 * Browser smoke for the DEV-only global-search prototype (issue #303).
 */
import { expect, test, type Page } from "@playwright/test";

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
    if (url.pathname === "/api/courses") {
      return route.fulfill({
        json: {
          items: [
            {
              id: 8,
              code: "GEN0108",
              name: "中国传统文化导论",
              category: "general",
              department: "人文学院",
              teachers: "测试教师",
              review_count: 0,
              rating: null,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          pages: 1,
        },
      });
    }
    if (url.pathname === "/api/teachers") {
      return route.fulfill({
        json: {
          items: [
            {
              id: 12,
              name: "张三",
              department: "人文学院",
              title: "",
              bio: "",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          pages: 1,
        },
      });
    }
    if (url.pathname === "/api/courses/departments") {
      return route.fulfill({ json: { items: ["人文学院"] } });
    }
    if (url.pathname === "/api/teachers/12") {
      return route.fulfill({
        json: {
          teacher: {
            id: 12,
            name: "张三",
            department: "人文学院",
            title: "",
            bio: "",
          },
          courses: [],
          reviews: [],
          reviewCount: 0,
          nextReviewCursor: null,
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

function isMobile(name: string) {
  return name.includes("mobile");
}

test.beforeEach(async ({ page }) => {
  await mockCatalogApi(page);
});

test("variant A keeps search on the catalog page and documents the empty-state rescue", async ({
  page,
}) => {
  await page.goto("/courses?module=global-search&variant=A");
  const note = page.getByRole("note");
  await expect(note.getByText("A — 维持页内")).toBeVisible();
  await expect(note.getByText(/2 次点击/)).toBeVisible();
  await expect(note.getByText(/空态/)).toBeVisible();
  await expect(page.locator("header").getByLabel("搜索课程或教师")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "搜索课程" })).toBeVisible();
});

test("variant B mounts a grouped Autocomplete in the shell @mobile-smoke", async ({
  page,
}, testInfo) => {
  await page.goto("/courses?module=global-search&variant=B");
  await expect(page.getByRole("note").getByText("B — 顶栏分组建议")).toBeVisible();

  if (isMobile(testInfo.project.name)) {
    await page.getByRole("button", { name: "搜索课程与教师" }).click();
    await expect(page.getByRole("dialog", { name: "搜索课程与教师" })).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "搜索课程或教师" }),
    ).toBeVisible();
  } else {
    const field = page.locator("header").getByRole("searchbox", {
      name: "搜索课程或教师",
    });
    await expect(field).toBeVisible();
    await field.fill("张");
    await expect(page.getByRole("option", { name: /中国传统文化导论/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /张三/ })).toBeVisible();
    await page.getByRole("option", { name: /张三/ }).click();
    await expect(page).toHaveURL(/\/teachers\/12/);
    await expect(page).toHaveURL(/module=global-search/);
    await expect(page).toHaveURL(/variant=B/);
  }
});

test("variant C jumps to the current catalog and shows the opposite-catalog link @mobile-smoke", async ({
  page,
}, testInfo) => {
  await page.goto("/courses?q=%E5%BC%A0&module=global-search&variant=C");
  await expect(page.getByRole("note").getByText("C — 顶栏只跳转")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "也在教师资料中搜「张」" }),
  ).toBeVisible();

  if (isMobile(testInfo.project.name)) {
    await page.getByRole("button", { name: "搜索当前目录" }).click();
    await expect(page.getByRole("dialog", { name: "搜索当前目录" })).toBeVisible();
  } else {
    const field = page.locator("header").getByRole("searchbox", {
      name: "搜索课程或教师",
    });
    await expect(field).toBeVisible();
    await field.fill("导论");
    await field.press("Enter");
    await expect(page).toHaveURL(/\/courses/);
    await expect(page).toHaveURL(/q=%E5%AF%BC%E8%AE%BA|q=导论/);
    await expect(page).toHaveURL(/module=global-search/);
  }
});
