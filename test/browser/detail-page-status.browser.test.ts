import { expect, test, type Page } from "@playwright/test";

const COURSE = {
  id: 8,
  code: "GEN0108",
  name: "中国传统文化导论",
  category: "general",
  department: "人文学院",
  admin_notice: "本周课程改为线上进行。",
  admin_notice_updated_at: "2026-08-24 10:30:00",
  teachers: [{ id: 9, name: "测试教师", review_count: 0 }],
};

async function mockBase(page: Page) {
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
    if (url.pathname === "/api/courses") {
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    }
    if (url.pathname === "/api/teachers") {
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 50, total: 0, pages: 1 },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test.beforeEach(async ({ page }) => mockBase(page));

test("course detail page error uses official Alert", async ({ page }) => {
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({ status: 500, json: { error: "课程接口失败" } }),
  );
  await page.goto("/courses/8");
  await expect(page.getByRole("alert")).toContainText("课程加载失败");
  await expect(page.getByRole("alert")).toContainText("课程接口失败");
  await expect(page.getByRole("status", { name: "加载中…", exact: true })).toHaveCount(0);
});

test("course detail first load uses a reserved-height skeleton", async ({ page }) => {
  await page.route("**/api/courses/8", () => new Promise(() => {}));
  await page.goto("/courses/8");
  await expect(page.getByRole("status", { name: "课程加载中…" })).toBeVisible();
  await expect(page.locator("[data-detail-skeleton-row]")).toHaveCount(12);
  await expect(page.getByRole("status", { name: "加载中…", exact: true })).toHaveCount(0);
});

test("course review feed error uses official Alert", async ({ page }) => {
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({
      json: { course: COURSE, reviewCount: 3 },
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/courses/8/reviews",
    (route) =>
      route.fulfill({ status: 500, json: { error: "评价接口失败" } }),
  );
  await page.goto("/courses/8?teacher=9");
  await expect(page.getByRole("heading", { name: "中国传统文化导论" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("评价加载失败");
  await expect(page.getByRole("alert")).toContainText("评价接口失败");
});

test("course detail displays the course administrator notice", async ({ page }) => {
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({ json: { course: COURSE, reviewCount: 0 } }),
  );
  await page.route(
    (url) => url.pathname === "/api/courses/8/reviews",
    (route) => route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/courses/8?teacher=9");
  await expect(page.getByText("管理员公告", { exact: true })).toBeVisible();
  await expect(page.getByText("本周课程改为线上进行。", { exact: true })).toBeVisible();
  await expect(page.getByText("更新于 2026-08-24 10:30:00", { exact: true })).toBeVisible();
});

test("teacher detail first load uses a reserved-height skeleton", async ({ page }) => {
  await page.route("**/api/teachers/9", () => new Promise(() => {}));
  await page.goto("/teachers/9");
  await expect(page.getByRole("status", { name: "教师资料加载中…" })).toBeVisible();
  await expect(page.locator("[data-detail-skeleton-row]")).toHaveCount(12);
  await expect(page.getByRole("status", { name: "加载中…", exact: true })).toHaveCount(0);
});

test("teacher detail page error uses official Alert", async ({ page }) => {
  await page.route("**/api/teachers/9", (route) =>
    route.fulfill({ status: 500, json: { error: "教师接口失败" } }),
  );
  await page.goto("/teachers/9");
  await expect(page.getByRole("alert")).toContainText("教师资料加载失败");
  await expect(page.getByRole("alert")).toContainText("教师接口失败");
  await expect(page.getByRole("status", { name: "加载中…", exact: true })).toHaveCount(0);
});

test("empty review stream still uses the frozen empty copy", async ({ page }) => {
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({
      json: { course: COURSE, reviewCount: 0 },
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/courses/8/reviews",
    (route) => route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/courses/8?teacher=9");
  await expect(page.getByRole("status").filter({ hasText: "暂无评价" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("course teacher card opens the teacher page", async ({ page }) => {
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({
      json: { course: COURSE, reviewCount: 0 },
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/courses/8/reviews",
    (route) => route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/teachers/9", (route) =>
    route.fulfill({
      json: {
        teacher: {
          id: 9,
          name: "测试教师",
          department: "人文学院",
          title: "讲师",
          bio: "",
          course_count: 1,
        },
        courses: [
          {
            id: 8,
            code: "GEN0108",
            name: "中国传统文化导论",
            category: "general",
            department: "人文学院",
            rating: 4.2,
            review_count: 3,
          },
        ],
        reviews: [],
        reviewCount: 3,
        nextReviewCursor: null,
      },
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/teachers/9/reviews",
    (route) => route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/courses/8?teacher=9");
  await page.getByRole("link", { name: "测试教师的教师主页" }).click();
  await expect(page).toHaveURL(/\/teachers\/9$/);
  await expect(
    page.getByRole("heading", { name: "课程（共 1 门）" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "测试教师", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /中国传统文化导论/ })).toBeVisible();
});
