/**
 * Browser coverage for the Issue #402 courses page: USTC 对齐的浅蓝筛选框
 * （课程类别行）、一行一条课程×教师关系条目（/api/courses 前端展开）、
 * 分页与骨架/空态。
 *
 * 关系级评分/点评数、四维档位与「排序方式：课程评分」依赖 #410 投影：
 * 未下发前行内为灰星 + 暂无评价/评分统计接入中 + 四维「—」，筛选框没有
 * 排序方式行。
 */
import { expect, test, type Page } from "@playwright/test";

const COURSES = [
  {
    id: 8,
    code: "GEN0108",
    name: "中国传统文化导论",
    category: "general",
    department: "人文学院",
    review_count: 23,
    rating: null,
    teacher_refs: "9:测试教师,10:另一位教师",
  },
  {
    id: 11,
    code: "PE0101",
    name: "篮球",
    category: "sports",
    department: "体育学院",
    review_count: 0,
    rating: null,
    teacher_refs: "12:体育教师",
  },
  {
    id: 14,
    code: "LECT01",
    name: "讲座合集",
    category: "general",
    department: "教务处",
    review_count: 0,
    rating: null,
  },
];

type MockOptions = {
  delayMs?: number;
  /** Pages beyond 1 return no rows but keep the total (deep-linked
   *  out-of-range page; the real API does not clamp page). */
  emptyBeyondFirstPage?: boolean;
};

async function mockCatalogApi(page: Page, options: MockOptions = {}) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
      });
    if (url.pathname === "/api/user/session")
      return route.fulfill({
        json: { authenticated: false, loginPath: "/login", logoutPath: "/logout" },
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
    if (url.pathname === "/api/courses") {
      const category = url.searchParams.get("category") || "";
      const query = url.searchParams.get("q") || "";
      const pageNum = Number(url.searchParams.get("page") || "1");
      const items = COURSES.filter(
        (item) =>
          (!category || item.category === category) &&
          (!query || item.name.includes(query)),
      );
      const total = items.length;
      if (options.emptyBeyondFirstPage && pageNum > 1) {
        return route.fulfill({
          json: { items: [], page: pageNum, pageSize: 20, total, pages: 1 },
        });
      }
      if (options.delayMs)
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return route.fulfill({
        json: { items, page: pageNum, pageSize: 20, total, pages: 1 },
      });
    }
    if (url.pathname === "/api/teachers")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 50, total: 0, pages: 1 },
      });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test("filter box shows the category row and no sort row yet", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/courses");

  await expect(
    page.getByRole("heading", { name: "课程列表" }),
  ).toBeVisible();
  const filterBox = page.getByRole("search", { name: "课程目录筛选" });
  await expect(filterBox.getByText("课程类别：")).toBeVisible();
  for (const label of [
    "全部",
    "专业课",
    "公共课",
    "体育课",
    "英语课",
    "思政课",
    "数学课",
  ]) {
    await expect(
      filterBox.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  }
  // 排序方式行待 #410 的评分投影；旧工具条的院系/教师筛选已下线。
  await expect(filterBox.getByText("排序方式：")).toHaveCount(0);
  await expect(
    filterBox.getByRole("button", { name: "网课" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "任课教师" }),
  ).toHaveCount(0);
  // 页内搜索已上移到顶栏：标题旁不再有目录搜索框，全页只有一个搜索框。
  await expect(page.getByRole("searchbox", { name: "搜索课程" })).toHaveCount(1);
});

test("relation rows expand per teacher with honest placeholders", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/courses");

  // 一门课两名教师 → 两行关系条目。
  const rows = page.getByRole("link", { name: /中国传统文化导论/ });
  await expect(rows).toHaveCount(2);
  const first = rows.first();
  await expect(first).toContainText("中国传统文化导论（测试教师）");
  // 关系级评分未下发：灰星 + 课程有公开文字评价时显示统计占位。
  await expect(first).toContainText("评分统计接入中");
  await expect(first).not.toContainText("人评价");
  // 四维占位：关系级分布投影（#410）落地前一律 —。
  await expect(first).toContainText("课程难度：—");
  await expect(first).toContainText("作业多少：—");
  await expect(first).toContainText("给分好坏：—");
  await expect(first).toContainText("收获多少：—");

  // 零评价课程：灰星 + 暂无评价。
  const pe = page.getByRole("link", { name: /篮球/ });
  await expect(pe).toContainText("篮球（体育教师）");
  await expect(pe).toContainText("暂无评价");
  await expect(pe).not.toContainText("评分统计接入中");

  // 无教师课程保留一行，标注教师待补充。
  const noTeacher = page.getByRole("link", { name: /讲座合集/ });
  await expect(noTeacher).toContainText("教师待补充");

  // 整行是指向 课程×教师 详情的链接。
  await expect(first).toHaveAttribute("href", /\/courses\/8\?.*teacher=9/);
  await first.click();
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
});

test("category row filters the relation list", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/courses");

  const filterBox = page.getByRole("search", { name: "课程目录筛选" });
  await filterBox.getByRole("button", { name: "体育课" }).click();
  await expect(page).toHaveURL(/category=sports/);
  await expect(page.getByRole("link", { name: /篮球/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /中国传统文化导论/ }),
  ).toHaveCount(0);

  await filterBox.getByRole("button", { name: "全部" }).click();
  await expect(page).not.toHaveURL(/category=/);
  await expect(
    page.getByRole("link", { name: /中国传统文化导论/ }).first(),
  ).toBeVisible();
});

test("filtered empty state names the active filters and clears them", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/courses?q=网球&category=sports");

  const empty = page
    .getByRole("status")
    .filter({ hasText: "没有找到匹配「网球」的课程" });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("关键词“网球”");
  await expect(empty).toContainText("体育课");

  await empty.getByRole("button", { name: "清空筛选" }).click();
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page).not.toHaveURL(/category=/);
  await expect(
    page.getByRole("link", { name: /中国传统文化导论/ }).first(),
  ).toBeVisible();
});

test("first load shows skeleton rows and keeps the header height stable", async ({
  page,
}) => {
  // 延迟要盖过并行跑时的页面启动开销，加载态才能被稳定观察到。
  await mockCatalogApi(page, { delayMs: 2500 });
  const header = page.locator('header[aria-label="目录标题"]');
  await page.goto("/courses");

  await expect(page.getByRole("status", { name: "加载中…" })).toBeVisible();
  await expect(page.locator("[data-catalog-skeleton-row]")).toHaveCount(20);
  const before = await header.boundingBox();

  await expect(
    page.getByRole("link", { name: /中国传统文化导论/ }).first(),
  ).toBeVisible();
  await expect(page.getByText("共 3 条", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "加载中…" })).toHaveCount(0);

  const after = await header.boundingBox();
  expect(before?.height).toBe(after?.height);
});

test("out-of-range deep-linked page keeps the filter box usable as a way back", async ({
  page,
}) => {
  await mockCatalogApi(page, { emptyBeyondFirstPage: true });
  await page.goto("/courses?page=2");

  // 越界页没有条目：筛选框仍在，切换类别即回到第 1 页。
  const filterBox = page.getByRole("search", { name: "课程目录筛选" });
  await expect(
    filterBox.getByRole("button", { name: "体育课" }),
  ).toBeEnabled();
  await filterBox.getByRole("button", { name: "体育课" }).click();
  await expect(page).toHaveURL(/category=sports/);
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByRole("link", { name: /篮球/ })).toBeVisible();
});
