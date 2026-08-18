/**
 * Browser coverage for Issue #203 (catalog sort control, single teacher
 * combobox, department filter hidden without options) and the Issue #205
 * first-load skeleton / stable catalog header.
 */
import { expect, test, type Page } from "@playwright/test";

const COURSES = [
  {
    id: 8,
    code: "GEN0108",
    name: "中国传统文化导论",
    category: "general",
    department: "人文学院",
    teachers: "测试教师",
    teacher_refs: "9:测试教师",
    review_count: 1,
    rating: null,
  },
  {
    id: 11,
    code: "PE0101",
    name: "篮球",
    category: "sports",
    department: "体育学院",
    teachers: "体育教师",
    teacher_refs: "12:体育教师",
    review_count: 2,
    rating: null,
  },
];

const TEACHERS = [
  { id: 9, name: "测试教师", department: "人文学院", title: "讲师" },
  ...Array.from({ length: 49 }, (_, index) => ({
    id: 100 + index,
    name: `教师${String(index + 1).padStart(2, "0")}`,
    department: "测试学院",
    title: "讲师",
  })),
];

type MockOptions = {
  departments?: string[];
  delayCoursesMs?: number;
};

async function mockCatalogApi(page: Page, options: MockOptions = {}) {
  const departments = options.departments ?? ["人文学院", "体育学院"];
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
    if (url.pathname === "/api/courses/departments")
      return route.fulfill({ json: { items: departments } });
    if (url.pathname === "/api/courses") {
      const sort = url.searchParams.get("sort") || "reviews";
      const department = url.searchParams.get("department") || "";
      const teacherId = url.searchParams.get("teacherId") || "";
      let items = COURSES.filter(
        (item) =>
          (!department || item.department === department) &&
          (!teacherId || item.teacher_refs?.startsWith(`${teacherId}:`)),
      );
      items =
        sort === "name"
          ? [...items].sort((a, b) => (a.name < b.name ? -1 : 1))
          : [...items].sort((a, b) => b.review_count - a.review_count);
      if (options.delayCoursesMs)
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayCoursesMs),
        );
      return route.fulfill({
        json: { items, page: 1, pageSize: 20, total: items.length, pages: 1 },
      });
    }
    if (url.pathname === "/api/teachers") {
      const query = url.searchParams.get("q") || "";
      const items = TEACHERS.filter(
        (teacher) =>
          !query ||
          teacher.name.includes(query) ||
          teacher.department.includes(query),
      );
      return route.fulfill({
        json: { items, page: 1, pageSize: 50, total: items.length, pages: 1 },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

function trackCourseRequests(page: Page) {
  const courseRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/courses") courseRequests.push(url.search);
  });
  return courseRequests;
}

test("sort control marks the default and re-orders the catalog", async ({
  page,
}) => {
  await mockCatalogApi(page);
  const courseRequests = trackCourseRequests(page);
  await page.goto("/courses");

  // 默认按投稿数：篮球（2 投）在前；排序控件标明默认项。
  await expect(page.getByRole("row").nth(1)).toContainText("篮球");
  const sortTrigger = page.getByRole("button", { name: /排序/ });
  await expect(sortTrigger).toBeVisible();
  await expect(sortTrigger).toContainText("投稿数优先");
  await expect(sortTrigger).not.toContainText("默认");

  await sortTrigger.click();
  await expect(
    page.getByRole("option", { name: "投稿数优先（默认）" }),
  ).toBeVisible();
  await page.getByRole("option", { name: "课名", exact: true }).click();

  await expect(page).toHaveURL(/sort=name/);
  await expect(sortTrigger).toHaveText("课名");
  await expect(page.getByRole("row").nth(1)).toContainText("中国传统文化导论");
  await expect
    .poll(() => courseRequests.some((search) => search.includes("sort=name")))
    .toBe(true);

  // 深链刷新后排序控件仍显示当前项。
  await page.reload();
  await expect(sortTrigger).toHaveText("课名");
  await expect(page.getByRole("row").nth(1)).toContainText("中国传统文化导论");
});

test("teacher filter is a single searchable combobox", async ({ page }) => {
  await mockCatalogApi(page);
  const courseRequests = trackCourseRequests(page);
  await page.goto("/courses");

  const combo = page.getByRole("combobox", { name: "任课教师" });
  await expect(combo).toBeVisible();
  // 只剩一套教师筛选交互：不再有独立的教师搜索框。
  await expect(
    page.getByRole("searchbox", { name: "搜索任课教师" }),
  ).toHaveCount(0);
  // 前 50 位说明改写为可搜索补全的指引。
  await expect(
    page.getByText(
      "教师列表最多显示前 50 位；在任课教师框中输入姓名或院系，可搜索全部教师。",
    ),
  ).toBeVisible();

  await combo.click();
  await combo.fill("测试");
  const option = page.getByRole("option", { name: /测试教师/ });
  await expect(option).toBeVisible();
  await expect(
    page.getByText(/教师列表最多显示前 50 位/),
  ).toHaveCount(0);
  await option.click();

  await expect(page).toHaveURL(/teacherId=9/);
  await expect(combo).toHaveValue("测试教师");
  // 课程列表按选中教师过滤：只剩中国传统文化导论。
  await expect(page.getByRole("link", { name: "篮球" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "中国传统文化导论" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      courseRequests.some((search) => search.includes("teacherId=9")),
    )
    .toBe(true);

  // 清空输入即清除教师筛选。
  await combo.fill("");
  await expect(page).not.toHaveURL(/teacherId=/);
});

test("department filter hides when the catalog has no departments", async ({
  page,
}) => {
  await mockCatalogApi(page, { departments: [] });
  await page.goto("/courses");
  await expect(page.getByRole("button", { name: /院系/ })).toHaveCount(0);
  // 其他筛选仍在：教师 ComboBox 与排序不受影响。
  await expect(page.getByRole("combobox", { name: "任课教师" })).toBeVisible();
  await expect(page.getByRole("button", { name: /排序/ })).toBeVisible();
});

test("department filter lists catalog departments and filters", async ({
  page,
}) => {
  await mockCatalogApi(page);
  const courseRequests = trackCourseRequests(page);
  await page.goto("/courses");

  const department = page.getByRole("button", { name: /院系/ });
  await expect(department).toBeVisible();
  await department.click();
  await page.getByRole("option", { name: "人文学院" }).click();

  await expect(page).toHaveURL(/department=/);
  await expect(page.getByRole("row").nth(1)).toContainText("中国传统文化导论");
  await expect(page.getByRole("link", { name: "篮球" })).toHaveCount(0);
  await expect
    .poll(() =>
      courseRequests.some((search) => search.includes("department=")),
    )
    .toBe(true);
});

test("first load shows skeleton rows and keeps the header height stable", async ({
  page,
}) => {
  await mockCatalogApi(page, { delayCoursesMs: 800 });
  const header = page.locator('header[aria-label="目录标题与搜索"]');
  await page.goto("/courses");

  // 首屏加载是骨架行，不再只有一句「加载中…」。
  await expect(page.getByRole("status", { name: "加载中…" })).toBeVisible();
  const before = await header.boundingBox();

  await expect(
    page.getByRole("link", { name: "中国传统文化导论" }),
  ).toBeVisible();
  await expect(page.getByText("2 门课程", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "加载中…" })).toHaveCount(0);

  // 标题/计数区域高度从首开到数据到达保持不变（无 CLS）。
  const after = await header.boundingBox();
  expect(before?.height).toBe(after?.height);
});
