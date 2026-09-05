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

test("course detail first load uses a reserved-height skeleton @pr-smoke", async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: /中国传统文化导论（测试教师）/ })).toBeVisible();
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

test("course detail hides the empty administrator notice from guests", async ({
  page,
}) => {
  let adminSessionCalls = 0;
  await page.route("**/api/admin/session", (route) => {
    adminSessionCalls += 1;
    return route.fulfill({ status: 401, json: { error: "unauthorized" } });
  });
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({
      json: {
        course: { ...COURSE, admin_notice: "", admin_notice_updated_at: null },
        reviewCount: 0,
      },
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/courses/8/reviews",
    (route) => route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/courses/8?teacher=9");
  await expect(page.getByRole("heading", { name: /中国传统文化导论（测试教师）/ })).toBeVisible();
  await expect(page.getByText("管理员公告", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("管理员公告（仅管理员可编辑，公开展示）"),
  ).toHaveCount(0);
  await expect(page.getByText("暂无公告", { exact: true })).toHaveCount(0);
  await expect(page.locator("div.mt-4.rounded-md.border.border-dashed")).toHaveCount(0);
  expect(adminSessionCalls).toBe(0);
});

test("course detail shows an empty administrator notice box to admins", async ({
  page,
}) => {
  await page.route("**/api/user/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        csrfToken: "csrf-user",
        loginPath: "/login",
        logoutPath: "/logout",
      },
    }),
  );
  await page.route("**/api/admin/session", (route) =>
    route.fulfill({
      json: { ok: true, kind: "admin", source: "student", csrfToken: "csrf-admin" },
    }),
  );
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({
      json: {
        course: { ...COURSE, admin_notice: "", admin_notice_updated_at: null },
        reviewCount: 0,
      },
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/courses/8/reviews",
    (route) => route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/courses/8?teacher=9");
  await expect(page.getByText("暂无公告", { exact: true })).toBeVisible();
  await expect(
    page.getByText("管理员公告（仅管理员可编辑，公开展示）"),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "设置公告" })).toBeVisible();
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

test("course AI summary shows the generated-content disclaimer beside the heading", async ({
  page,
}) => {
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({
      json: {
        course: COURSE,
        reviewCount: 5,
        summaries: {
          "9": {
            html: "<p>这是一条自动生成的总结正文。</p>",
            updatedAt: "2026-08-24 12:00:00",
          },
        },
      },
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/courses/8/reviews",
    (route) => route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/courses/8?teacher=9");
  await expect(page.getByRole("heading", { name: "AI 总结" })).toBeVisible();
  await expect(page.getByText("这是一条自动生成的总结正文。")).toBeVisible();
  await expect(
    page.getByText("AI 总结为根据点评内容自动生成，仅供参考"),
  ).toBeVisible();
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

test("course teacher card hides a missing official homepage", async ({
  page,
}) => {
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
  const aside = page.locator("aside");
  const teacherName = aside.getByRole("link", { name: "测试教师" });
  await expect(teacherName).toBeVisible();
  await expect(teacherName).toHaveAttribute("href", "/teachers/9");
  await expect(teacherName).not.toHaveAttribute("target", "_blank");
  await expect(aside.getByText("教师主页：")).toHaveCount(0);
  await expect(
    aside.getByRole("link", { name: /教师主页/ }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
});

test("course teacher card keeps an official CTA homepage", async ({ page }) => {
  const officialUrl =
    "https://example.com/home/teacherInfo/detail?fid=1&uid=2";
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({
      json: {
        course: {
          ...COURSE,
          teachers: [
            {
              id: 9,
              name: "测试教师",
              review_count: 0,
              official_homepage_url: officialUrl,
            },
          ],
        },
        reviewCount: 0,
      },
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/courses/8/reviews",
    (route) => route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/courses/8?teacher=9");
  const homepage = page.getByRole("link", { name: `教师主页：${officialUrl}` });
  await expect(homepage).toBeVisible();
  await expect(homepage).toHaveAttribute("href", officialUrl);
  await expect(homepage).toHaveAttribute("target", "_blank");
});

test("PE public identity course page matches mapped detail without a numeric id", async ({
  page,
}) => {
  const peCourse = {
    id: null,
    public_id: "pe:篮球",
    code: "",
    name: "篮球",
    category: "sports",
    department: "体育学院",
    enrollment_category: "",
    teaching_type: "",
    course_level: "",
    teachers: [{ id: 12, name: "体育教师", review_count: 2, rating: 4 }],
  };
  const isPeCourse = (pathname: string) => {
    try {
      return decodeURIComponent(pathname) === "/api/courses/pe:篮球";
    } catch {
      return pathname.endsWith("/api/courses/pe:篮球");
    }
  };
  const isPeReviews = (pathname: string) => {
    try {
      return decodeURIComponent(pathname) === "/api/courses/pe:篮球/reviews";
    } catch {
      return pathname.includes("/api/courses/pe:") && pathname.endsWith("/reviews");
    }
  };
  await page.route(
    (url) => isPeCourse(url.pathname),
    (route) =>
      route.fulfill({
        json: { course: peCourse, reviewCount: 2 },
      }),
  );
  await page.route(
    (url) => isPeReviews(url.pathname),
    (route) =>
      route.fulfill({
        json: { items: [], nextCursor: null, total: 0 },
      }),
  );
  await page.goto(`/courses/${encodeURIComponent("pe:篮球")}?teacher=12`);
  await expect(
    page.getByRole("heading", { name: /篮球（体育教师）/ }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "暂无评价" })).toBeVisible();
});
