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

/** 教师区是密表（`Table.Content aria-label="任课教师"`）。 */
function teacherRegion(page: Page) {
  return page.getByRole("grid", { name: "任课教师" });
}

/** 点击院系列切换 `?teacher=`，避免点到姓名链接离开课程页。 */
async function selectTeacher(page: Page, name: string) {
  await teacherRegion(page)
    .getByRole("row", { name: new RegExp(name) })
    .getByRole("gridcell")
    .nth(1)
    .click();
}

test("course detail shows teachers or reviews, never both", async ({
  page,
}) => {
  const reviewRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/courses/8/reviews")
      reviewRequests.push(url.search);
  });

  await page.goto("/courses/8");

  // 未选教师：只有任课表，不请求、不渲染评价流。
  await expect(teacherRegion(page)).toBeVisible();
  await expect(reviewItems(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "评价" })).toHaveCount(0);
  expect(reviewRequests).toHaveLength(0);

  const hint = page.getByText(
    "选择一位任课教师，查看这位老师在这门课的评价。",
  );
  await expect(hint).toBeVisible();
  const hintBox = await hint.boundingBox();
  const regionBox = await teacherRegion(page).boundingBox();
  expect(hintBox && regionBox && hintBox.y + hintBox.height <= regionBox.y + 2).toBe(
    true,
  );

  const region = teacherRegion(page);
  await expect(region.getByRole("row", { name: /另一位教师/ })).toContainText(
    "2 投",
  );

  await selectTeacher(page, "测试教师");
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(teacherRegion(page)).toHaveCount(0);
  await expect(reviewItems(page)).toHaveCount(20);
  await expect(page.getByText("21 条", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "返回任课教师" }).click();
  await expect(page).toHaveURL(/\/courses\/8$/);
  await expect(teacherRegion(page)).toBeVisible();
  await expect(reviewItems(page)).toHaveCount(0);
  expect(reviewRequests.filter((search) => search === "")).toHaveLength(0);

  await selectTeacher(page, "另一位教师");
  await expect(page).toHaveURL(/\/courses\/8\?teacher=10$/);
  await expect(teacherRegion(page)).toHaveCount(0);
  await expect(reviewItems(page)).toHaveCount(2);
  await expect(page.getByText("2 条", { exact: true })).toBeVisible();
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
  await selectTeacher(page, "测试教师");
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(reviewItems(page)).toHaveCount(20);
  const feed = page.getByRole("list", { name: "评价列表" });
  await expect(feed.getByRole("link")).toHaveCount(0);
  await expect(feed.getByRole("listitem").first()).toContainText("匿名评价 1");
  await page.getByRole("button", { name: "继续加载" }).click();
  await expect(reviewItems(page)).toHaveCount(21);

  await page.getByRole("link", { name: "返回任课教师" }).click();
  await selectTeacher(page, "另一位教师");
  await expect(reviewItems(page)).toHaveCount(2);

  await page.getByRole("link", { name: "返回任课教师" }).click();
  await selectTeacher(page, "测试教师");
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(reviewItems(page)).toHaveCount(21);
  await expect(page.getByRole("button", { name: "继续加载" })).toHaveCount(0);
  expect(
    reviewRequests.filter((search) => search.includes("teacherId=9")),
  ).toHaveLength(2);
  expect(
    reviewRequests.filter((search) => !search.includes("teacherId")),
  ).toHaveLength(0);
});

test("teacher home link is the only control that leaves the course page", async ({
  page,
}) => {
  await page.goto("/courses/8");
  await expect(reviewItems(page)).toHaveCount(0);

  await teacherRegion(page).getByRole("link", { name: "测试教师" }).click();
  await expect(page).toHaveURL(/\/teachers\/9$/);
  await expect(
    page.getByRole("heading", { name: "测试教师" }),
  ).toBeVisible();

  // ?teacher= 深链与返回按钮仍可用（Issue #201 验收）。
  await page.goto("/courses/8?teacher=9");
  await expect(teacherRegion(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回任课教师" })).toBeVisible();
  await expect(reviewItems(page)).toHaveCount(20);
  await expect(page.getByText("21 条", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /认可/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "返回课程目录" }).click();
  await expect(page).toHaveURL(/\/courses$/);
});

test("teacher table shows review counts via RatingCell", async ({
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
  await expect(region.getByRole("row", { name: /测试教师/ })).toContainText(
    "21 投",
  );
  await expect(region.getByRole("row", { name: /另一位教师/ })).toContainText(
    "2 投",
  );
  // rating 为 null 时不发明评分数字（行无障碍名是「另一位教师…2 投」）。
  await expect(region.getByText("4.6", { exact: true })).toHaveCount(0);
});

test("empty and mobile states remain accessible without overflow", async ({ page }) => {
  await page.goto("/courses/10");
  await expect(page.getByRole("status").filter({ hasText: "教师待补充" })).toBeVisible();
  await expect(reviewItems(page)).toHaveCount(0);

  await page.goto("/courses/8?teacher=9");
  await expect(teacherRegion(page)).toHaveCount(0);
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
  await expect(page.getByRole("status").filter({ hasText: "教师待补充" })).toBeVisible();

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
