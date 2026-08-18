import { expect, test, type Page } from "@playwright/test";

const teacherNineReviews = Array.from({ length: 21 }, (_, index) => ({
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

const teacherTenReviews = [1, 2].map((index) => ({
  id: `historical:other-${index}`,
  course_id: 8,
  teacher_id: 10,
  course_name: "中国传统文化导论",
  course_code: "GEN0108",
  teacher_name: "另一位教师",
  comment: `另一位教师的评价 ${index}，用于验证同课切换教师时的对照与缓存恢复。`,
  endorsement_count: 0,
  endorsable: false,
}));

const allReviews = [...teacherNineReviews, ...teacherTenReviews];

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
          teachers: "测试教师,另一位教师",
          teacher_refs: "9:测试教师,10:另一位教师",
          review_count: 23,
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
              {
                id: 9,
                name: "测试教师",
                department: "人文学院",
                review_count: 21,
                rating: 4.6,
              },
              {
                id: 10,
                name: "另一位教师",
                department: "信息学院",
                review_count: 2,
                rating: null,
              },
            ],
          },
          reviewCount: 23,
        },
      });
    if (url.pathname === "/api/courses/8/reviews") {
      const teacherId = url.searchParams.get("teacherId");
      if (teacherId === "9") {
        if (url.searchParams.has("cursor"))
          return route.fulfill({
            json: { items: teacherNineReviews.slice(20), nextCursor: null },
          });
        return route.fulfill({
          json: { items: teacherNineReviews.slice(0, 20), nextCursor: "next-page" },
        });
      }
      if (teacherId === "10") {
        return route.fulfill({
          json: { items: teacherTenReviews, nextCursor: null },
        });
      }
      // 未指定教师：返回该课全部公开评价（Issue #201）。
      if (url.searchParams.has("cursor"))
        return route.fulfill({
          json: { items: allReviews.slice(20), nextCursor: null },
        });
      return route.fulfill({
        json: { items: allReviews.slice(0, 20), nextCursor: "all-page-2" },
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
          reviews: teacherNineReviews.slice(0, 20),
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
      return route.fulfill({ json: { items: teacherNineReviews.slice(20), nextCursor: null } });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test.beforeEach(async ({ page }) => mockApi(page));

function reviewItems(page: Page) {
  return page.getByRole("list", { name: "评价列表" }).getByRole("listitem");
}

/** 教师区是官方 Card 网格（`<ul aria-label="任课教师">`），桌面与窄屏同一结构。 */
function teacherRegion(page: Page) {
  return page.getByRole("list", { name: "任课教师" });
}

/** Footer「查看评价」选中教师；已选中则点「取消选择」切回全部评价。 */
async function selectTeacher(page: Page, name: string) {
  const region = teacherRegion(page);
  const cancel = region.getByRole("link", {
    name: `取消选择${name}（当前选中，正在展示其评价）`,
  });
  if ((await cancel.count()) > 0) {
    await cancel.click();
    return;
  }
  await region.getByRole("link", { name: `查看${name}的评价` }).click();
}

test("course detail shows all reviews by default and filters per teacher", async ({
  page,
}) => {
  const reviewRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/courses/8/reviews")
      reviewRequests.push(url.search);
  });

  await page.goto("/courses/8");

  // #201：未选教师时评价区直接展示该课全部评价，不再是空白引导。
  await expect(reviewItems(page)).toHaveCount(20);
  await expect(page.getByText("23 条", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "选择上方一位任课教师" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "继续加载" }).click();
  await expect(reviewItems(page)).toHaveCount(23);

  // #201/#205：提示在教师网格上方、无乘号。
  const hint = page.getByText(
    "选择一位任课教师，查看这位老师在这门课的评价；默认显示全部评价。",
  );
  await expect(hint).toBeVisible();
  const hintBox = await hint.boundingBox();
  const regionBox = await teacherRegion(page).boundingBox();
  expect(hintBox && regionBox && hintBox.y + hintBox.height <= regionBox.y + 2).toBe(
    true,
  );

  // #202：无评分的教师卡片不出现「—」，只有投稿数。
  const region = teacherRegion(page);
  await expect(region.getByText("2 投", { exact: true })).toBeVisible();
  await expect(region.getByText("—", { exact: true })).toHaveCount(0);

  // #201：Footer「查看评价」就地筛选，不离开当前课。
  await selectTeacher(page, "测试教师");
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(reviewItems(page)).toHaveCount(20);
  await expect(page.getByText("21 条", { exact: true })).toBeVisible();

  // #202：切到另一位教师，评价替换为该教师的投稿。
  await selectTeacher(page, "另一位教师");
  await expect(page).toHaveURL(/\/courses\/8\?teacher=10$/);
  await expect(reviewItems(page)).toHaveCount(2);
  await expect(page.getByText("2 条", { exact: true })).toBeVisible();

  // #202：切回第一位教师，缓存命中立即恢复，不再发起请求。
  await selectTeacher(page, "测试教师");
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(reviewItems(page)).toHaveCount(20);
  expect(
    reviewRequests.filter((search) => search.includes("teacherId=9")),
  ).toHaveLength(1);

  // 取消选择回到全部评价（对照视图），命中缓存——且恢复的是已加载的全部
  // 23 条（含此前「继续加载」的第二页，Issue #212）。
  await selectTeacher(page, "测试教师");
  await expect(page).toHaveURL(/\/courses\/8$/);
  await expect(reviewItems(page)).toHaveCount(23);
  expect(reviewRequests.filter((search) => search === "")).toHaveLength(1);
});

test("teacher switch restores fully loaded pages from cache", async ({
  page,
}) => {
  const reviewRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/courses/8/reviews")
      reviewRequests.push(url.search);
  });

  await page.goto("/courses/8");
  await expect(reviewItems(page)).toHaveCount(20);

  // 未选教师的「全部评价」视图：先加载第二页（共 23 条）。
  await page.getByRole("button", { name: "继续加载" }).click();
  await expect(reviewItems(page)).toHaveCount(23);

  // 选测试教师：20 条，再加载第二页 → 21 条。
  await selectTeacher(page, "测试教师");
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(reviewItems(page)).toHaveCount(20);
  // 课程×教师 流整流同属所选教师，条目不再重复教师身份「昵称」。
  const feed = page.getByRole("list", { name: "评价列表" });
  await expect(feed.getByRole("link")).toHaveCount(0);
  await expect(feed.getByRole("listitem").first()).toContainText("匿名评价 1");
  await page.getByRole("button", { name: "继续加载" }).click();
  await expect(reviewItems(page)).toHaveCount(21);

  // 切到另一位教师再切回：21 条完整恢复，不再重新拉取。
  await selectTeacher(page, "另一位教师");
  await expect(reviewItems(page)).toHaveCount(2);
  await selectTeacher(page, "测试教师");
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(reviewItems(page)).toHaveCount(21);
  await expect(page.getByRole("button", { name: "继续加载" })).toHaveCount(0);
  expect(
    reviewRequests.filter((search) => search.includes("teacherId=9")),
  ).toHaveLength(2);

  // 取消选择回到全部评价：23 条（含第二页）完整恢复，同样不重拉。
  await selectTeacher(page, "测试教师");
  await expect(page).toHaveURL(/\/courses\/8$/);
  await expect(reviewItems(page)).toHaveCount(23);
  expect(
    reviewRequests.filter((search) => !search.includes("teacherId")),
  ).toHaveLength(2);
});

test("teacher home link is the only control that leaves the course page", async ({
  page,
}) => {
  await page.goto("/courses/8");
  await expect(reviewItems(page)).toHaveCount(20);

  await page.getByRole("link", { name: "测试教师的教师主页" }).click();
  await expect(page).toHaveURL(/\/teachers\/9$/);
  await expect(
    page.getByRole("heading", { name: "测试教师" }),
  ).toBeVisible();

  // ?teacher= 深链与返回按钮仍可用（Issue #201 验收）。
  await page.goto("/courses/8?teacher=9");
  await expect(reviewItems(page)).toHaveCount(20);
  await expect(page.getByText("21 条", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /认可/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "返回课程目录" }).click();
  await expect(page).toHaveURL(/\/courses$/);
});

test("teacher cards show review counts and omit empty ratings", async ({
  page,
}) => {
  await page.route("**/api/courses/8", (route) =>
    route.fulfill({
      json: {
        course: {
          id: 8,
          code: "GEN0108",
          name: "中国传统文化导论",
          category: "general",
          department: "人文学院",
          teachers: [
            {
              id: 9,
              name: "测试教师",
              department: "人文学院",
              review_count: 21,
              rating: null,
            },
            {
              id: 10,
              name: "另一位教师",
              department: "信息学院",
              review_count: 2,
              rating: null,
            },
          ],
        },
        reviewCount: 23,
      },
    }),
  );
  await page.goto("/courses/8");
  const region = teacherRegion(page);
  await expect(region.getByText("21 投", { exact: true })).toBeVisible();
  await expect(region.getByText("2 投", { exact: true })).toBeVisible();
  await expect(region.getByText("—", { exact: true })).toHaveCount(0);
  // rating 为 null 时不发明评分 Chip（官方卡片直接省略）。
  await expect(region.getByText("4.6", { exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("row").nth(1)).toContainText(/23.*投/);
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

test("teacher detail keeps the unified text stream", async ({ page }) => {
  await page.goto("/teachers/9");
  await expect(reviewItems(page)).toHaveCount(20);
  await expect(
    page.getByRole("link", { name: "中国传统文化导论（GEN0108）" }).first(),
  ).toBeVisible();
});
