import { expect, test, type Page } from "@playwright/test";

const reviews = Array.from({ length: 21 }, (_, index) => ({
  id: `historical:review-${String(index + 1).padStart(2, "0")}`,
  course_id: 8,
  teacher_id: 9,
  course_name: "中国传统文化导论",
  course_code: "GEN0108",
  teacher_name: "测试教师",
  comment: `匿名评价 ${index + 1}，正文包含足够长的内容用于验证窄屏布局不会溢出或覆盖目录上下文。`,
  endorsement_count: 0,
  endorsable: false,
}));

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
      });
    if (url.pathname === "/api/user/session")
      return route.fulfill({
        json: {
          authenticated: false,
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    if (url.pathname === "/api/courses") {
      const searched = url.searchParams.has("q") && url.searchParams.get("q") !== "";
      const items = [
        {
          id: 8,
          code: "GEN0108",
          name: "中国传统文化导论",
          category: "general",
          department: "人文学院",
          teachers: "测试教师",
          teacher_refs: "9:测试教师",
          review_count: 21,
          rating: 4.6,
        },
        {
          id: 10,
          code: "EMPTY",
          name: "暂无文字评价课程",
          category: "general",
          department: "测试学院",
          teachers: null,
          teacher_refs: null,
          review_count: 0,
          rating: null,
        },
      ];
      return route.fulfill({
        json: {
          items: searched ? [items[1], items[0]] : items,
          page: 1,
          pageSize: 20,
          total: 2,
          pages: 1,
        },
      });
    }
    if (url.pathname === "/api/teachers") {
      const searched = url.searchParams.has("q") && url.searchParams.get("q") !== "";
      const items = [
        {
          id: 9,
          name: "测试教师",
          department: "人文学院",
          title: "讲师",
          review_count: 21,
          rating: 4.6,
          course_count: 1,
        },
        {
          id: 11,
          name: "零评价教师",
          department: "测试学院",
          title: "讲师",
          review_count: 0,
          rating: null,
          course_count: 0,
        },
      ];
      return route.fulfill({
        json: {
          items: searched ? [items[1], items[0]] : items,
          page: 1,
          pageSize: 20,
          total: 2,
          pages: 1,
        },
      });
    }
    if (url.pathname === "/api/courses/8")
      return route.fulfill({
        json: {
          course: {
            id: 8,
            code: "GEN0108",
            name: "中国传统文化导论",
            category: "general",
            department: "人文学院",
            teachers: [
              { id: 9, name: "测试教师", review_count: 21, rating: 4.6 },
            ],
          },
          reviewCount: 21,
        },
      });
    if (url.pathname === "/api/courses/8/reviews") {
      if (url.searchParams.get("teacherId") !== "9")
        return route.fulfill({
          status: 400,
          json: { error: "课程评价需先指定任课教师（teacherId）" },
        });
      if (url.searchParams.has("cursor"))
        return route.fulfill({
          json: { items: reviews.slice(20), nextCursor: null },
        });
      return route.fulfill({
        json: { items: reviews.slice(0, 20), nextCursor: "next-page" },
      });
    }
    if (url.pathname === "/api/courses/10")
      return route.fulfill({
        json: {
          course: {
            id: 10,
            code: "EMPTY",
            name: "暂无文字评价课程",
            category: "general",
            department: "测试学院",
            teachers: [],
          },
          reviewCount: 0,
        },
      });
    if (url.pathname === "/api/teachers/9")
      return route.fulfill({
        json: {
          teacher: { id: 9, name: "测试教师", department: "人文学院", title: "讲师" },
          courses: [
            {
              id: 8,
              code: "GEN0108",
              name: "中国传统文化导论",
              category: "general",
              department: "人文学院",
            },
          ],
          reviews: reviews.slice(0, 20),
          reviewCount: 21,
          nextReviewCursor: "next-page",
        },
      });
    if (url.pathname === "/api/teachers/11")
      return route.fulfill({
        json: {
          teacher: { id: 11, name: "零评价教师", department: "测试学院", title: "讲师" },
          courses: [],
          reviews: [],
          reviewCount: 0,
          nextReviewCursor: null,
        },
      });
    if (url.pathname === "/api/teachers/9/reviews")
      return route.fulfill({ json: { items: reviews.slice(20), nextCursor: null } });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test.beforeEach(async ({ page }) => mockApi(page));

function reviewItems(page: Page) {
  return page.getByRole("list", { name: "评价列表" }).getByRole("listitem");
}

test("course detail gates reviews behind teacher selection", async ({ page }) => {
  await page.goto("/courses/8");
  // 未选教师：评价流不出现，显示引导空态；摘要仍展示评价总数。
  await expect(reviewItems(page)).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "选择一位任课教师" }),
  ).toBeVisible();
  await expect(page.getByText("21", { exact: true })).toBeVisible();

  // 点击 Footer「查看评价」选中该教师，加载 课程×教师 评价流。
  await page.getByRole("link", { name: "查看测试教师的评价" }).click();
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(page.getByText("21 条", { exact: true })).toBeVisible();
  await expect(reviewItems(page)).toHaveCount(20);
  // 课程×教师 流整流同属所选教师，条目不再重复教师身份「昵称」。
  const feed = page.getByRole("list", { name: "评价列表" });
  await expect(feed.getByRole("link")).toHaveCount(0);
  await expect(feed.getByRole("listitem").first()).toContainText("匿名评价 1");
  await page.getByRole("button", { name: "继续加载" }).click();
  await expect(reviewItems(page)).toHaveCount(21);
  await expect(page.getByRole("button", { name: "继续加载" })).toHaveCount(0);
  await expect(page.getByText("来源", { exact: true })).toHaveCount(0);
  await expect(page.getByText("历史评价", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /认可/ })).toHaveCount(0);

  // Footer「取消选择」去掉教师筛选，回到引导空态。
  await page.getByRole("link", { name: "取消选择测试教师（当前选中，正在展示其评价）" }).click();
  await expect(page).toHaveURL(/\/courses\/8$/);
  await expect(reviewItems(page)).toHaveCount(0);

  // 教师详情页保持原有统一文字流。
  await page.goto("/teachers/9");
  await expect(reviewItems(page)).toHaveCount(20);
  await expect(page.getByRole("link", { name: "中国传统文化导论（GEN0108）" }).first()).toBeVisible();
});

test("empty and mobile states remain accessible without overflow", async ({ page }) => {
  await page.goto("/courses/10");
  await expect(page.getByRole("status").filter({ hasText: "暂无评价" })).toBeVisible();

  await page.goto("/courses/8?teacher=9");
  await expect(reviewItems(page)).toHaveCount(20);
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
});

test("course and teacher catalogs preserve default and search result order", async ({ page }) => {
  await page.goto("/courses");
  await expect(page.getByRole("row").nth(1)).toContainText("中国传统文化导论");
  await expect(page.getByRole("row").nth(1)).toContainText(/21.*投/);
  await expect(page.getByRole("link", { name: "暂无文字评价课程" })).toBeVisible();

  await page.goto("/courses?q=暂无");
  await expect(page.getByRole("row").nth(1)).toContainText("暂无文字评价课程");
  await page.getByRole("link", { name: "暂无文字评价课程" }).click();
  await expect(page).toHaveURL(/\/courses\/10/);
  await expect(page.getByRole("status").filter({ hasText: "暂无评价" })).toBeVisible();

  await page.goto("/teachers");
  await expect(page.getByRole("row").nth(1)).toContainText("测试教师");
  await expect(page.getByRole("row").nth(1)).toContainText(/21.*投/);

  await page.goto("/teachers?q=零评价");
  await expect(page.getByRole("row").nth(1)).toContainText("零评价教师");
  await page.getByRole("link", { name: "零评价教师" }).click();
  await expect(page).toHaveURL(/\/teachers\/11/);
  await expect(page.getByText("暂无评价", { exact: true })).toBeVisible();
});
