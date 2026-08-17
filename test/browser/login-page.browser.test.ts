import { expect, test, type Page } from "@playwright/test";

const ENDORSABLE_REVIEW = {
  id: "review:101",
  course_id: 8,
  teacher_id: 9,
  course_name: "中国传统文化导论",
  course_code: "GEN0108",
  teacher_name: "测试教师",
  comment: "这是一条可认可的任课评价补充说明，内容足够长，用于验证认可入口。",
  endorsement_count: 0,
  endorsable: true,
};

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
      });
    if (url.pathname === "/api/auth/campus")
      return route.fulfill({
        json: {
          enabled: false,
          reason: "not_whitelisted",
          loginPath: "/login",
          logoutPath: "/logout",
          callbackPath: "/api/auth/callback",
        },
      });
    if (url.pathname === "/api/user/session")
      return route.fulfill({
        json: {
          authenticated: false,
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    if (url.pathname === "/api/courses")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    if (url.pathname === "/api/courses/8")
      return route.fulfill({
        json: {
          course: {
            id: 8,
            code: "GEN0108",
            name: "中国传统文化导论",
            category: "general",
            department: "人文学院",
            teachers: [{ id: 9, name: "测试教师" }],
          },
          reviews: [ENDORSABLE_REVIEW],
          reviewCount: 1,
          nextReviewCursor: null,
        },
      });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test.beforeEach(async ({ page }) => mockApi(page));

test("direct visit shows the honest status and a way back to the catalog", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "普通用户登录" })).toBeVisible();
  await expect(page.getByText("校园 JWT 登录尚未开放")).toBeVisible();
  await expect(page.getByText("接入状态：未开放。")).toBeVisible();

  const back = page.getByRole("link", { name: "返回继续浏览" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/courses$/);
});

test("returns to the internal source page given by from", async ({ page }) => {
  await page.goto("/login?from=/courses/8");
  const back = page.getByRole("link", { name: "返回继续浏览" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/courses\/8$/);
  await expect(
    page.getByRole("heading", { name: "中国传统文化导论" }),
  ).toBeVisible();
});

test("external or looping from values fall back to the catalog", async ({
  page,
}) => {
  const back = page.getByRole("link", { name: "返回继续浏览" });

  await page.goto("/login?from=https://evil.example/phish");
  await expect(back).toHaveAttribute("href", "/courses");

  await page.goto("/login?from=//evil.example");
  await expect(back).toHaveAttribute("href", "/courses");

  await page.goto("/login?from=/login");
  await expect(back).toHaveAttribute("href", "/courses");

  await page.goto("/login?from=/login/");
  await expect(back).toHaveAttribute("href", "/courses");
});

test("guest recognition prompt reaches login and returns to the source page", async ({
  page,
}) => {
  await page.goto("/courses/8");
  await page
    .getByRole("button", { name: "认可这条评价，还没有人认可" })
    .click();

  const loginLink = page.getByRole("link", { name: "使用普通用户登录" });
  await expect(loginLink).toBeVisible();
  await loginLink.click();
  await expect(page).toHaveURL(/\/login\?from=%2Fcourses%2F8$/);
  await expect(page.getByRole("heading", { name: "普通用户登录" })).toBeVisible();

  await page.getByRole("link", { name: "返回继续浏览" }).click();
  await expect(page).toHaveURL(/\/courses\/8$/);
  await expect(
    page.getByRole("button", { name: "认可这条评价，还没有人认可" }),
  ).toBeVisible();
});
