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

/** 深链教师：不在默认前 50 位列表内，只能按 id 拉到（Issue #213）。 */
const DEEP_LINK_TEACHER = {
  id: 999,
  name: "深链教师",
  department: "测试学院",
  title: "讲师",
};
const DEEP_LINK_COURSE = {
  id: 12,
  code: "GEN0201",
  name: "写作与沟通",
  category: "general",
  department: "人文学院",
  teachers: "深链教师",
  teacher_refs: "999:深链教师",
  review_count: 0,
  rating: null,
};

type MockOptions = {
  departments?: string[];
  delayCoursesMs?: number;
  /** Register the deep-linked teacher (id 999) and their course. */
  deepLinkTeacher?: boolean;
  /** Delay the by-id teacher fetch to observe the resolving state. */
  delayTeacherMs?: number;
  /** Pages beyond 1 return no rows but keep the total (deep-linked
   *  out-of-range page; the real API does not clamp page). */
  emptyBeyondFirstPage?: boolean;
};

async function mockCatalogApi(page: Page, options: MockOptions = {}) {
  const departments = options.departments ?? ["人文学院", "体育学院"];
  const catalog = options.deepLinkTeacher
    ? [...COURSES, DEEP_LINK_COURSE]
    : COURSES;
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
      const pageNum = Number(url.searchParams.get("page") || "1");
      let items = catalog.filter(
        (item) =>
          (!department || item.department === department) &&
          (!teacherId || item.teacher_refs?.startsWith(`${teacherId}:`)),
      );
      const total = items.length;
      if (options.emptyBeyondFirstPage && pageNum > 1) {
        return route.fulfill({
          json: { items: [], page: pageNum, pageSize: 20, total, pages: 1 },
        });
      }
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
    if (url.pathname === "/api/teachers/999" && options.deepLinkTeacher) {
      if (options.delayTeacherMs)
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayTeacherMs),
        );
      return route.fulfill({ json: { teacher: DEEP_LINK_TEACHER } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

function catalogFirstRow(page: Page) {
  return page.getByRole("grid", { name: "课程目录" }).getByRole("row").nth(1);
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
  await expect(catalogFirstRow(page)).toContainText("篮球");
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
  await expect(catalogFirstRow(page)).toContainText("中国传统文化导论");
  await expect
    .poll(() => courseRequests.some((search) => search.includes("sort=name")))
    .toBe(true);

  // 深链刷新后排序控件仍显示当前项。
  await page.reload();
  await expect(sortTrigger).toHaveText("课名");
  await expect(catalogFirstRow(page)).toContainText("中国传统文化导论");
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
  await expect(
    page.getByText(/教师列表最多显示前 50 位/),
  ).toHaveCount(0);

  await combo.click();
  await combo.fill("测试");
  const option = page.getByRole("option", { name: /测试教师/ });
  await expect(option).toBeVisible();
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
  await expect(catalogFirstRow(page)).toContainText("中国传统文化导论");
  await expect(page.getByRole("link", { name: "篮球" })).toHaveCount(0);
  await expect
    .poll(() =>
      courseRequests.some((search) => search.includes("department=")),
    )
    .toBe(true);
});

test("deep-linked teacher outside the first page resolves to a name", async ({
  page,
}) => {
  await mockCatalogApi(page, { deepLinkTeacher: true, delayTeacherMs: 600 });
  await page.goto("/courses?teacherId=999");

  const combo = page.getByRole("combobox", { name: "任课教师" });
  // 按 id 拉取期间：筛选摘要不回退显示原始 id。
  await expect(page.getByText("教师载入中…")).toBeVisible();
  // 拉取完成：ComboBox 与摘要都显示姓名；列表按该教师过滤出写作与沟通。
  await expect(combo).toHaveValue("深链教师");
  await expect(page.getByText("教师“深链教师”")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "写作与沟通" }),
  ).toBeVisible();
  await expect(page.getByText(/教师“999”/)).toHaveCount(0);

  // 教师搜索仍可用：输入其他关键词后放弃选择即清除教师筛选。
  await combo.click();
  await combo.fill("零");
  await expect(page).not.toHaveURL(/teacherId=/);
});

test("deep-linked teacher already in the list resolves without a loading chip", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/courses?teacherId=9");
  const combo = page.getByRole("combobox", { name: "任课教师" });
  await expect(combo).toHaveValue("测试教师");
  await expect(page.getByText("教师“测试教师”")).toBeVisible();
  await expect(page.getByText("教师载入中…")).toHaveCount(0);
});

test("deep-linked teacher id that does not exist gets an honest missing label", async ({
  page,
}) => {
  await mockCatalogApi(page);
  // /api/teachers/99999 未 mock → 404 → missing。
  await page.goto("/courses?teacherId=99999");
  const combo = page.getByRole("combobox", { name: "任课教师" });
  await expect(combo).toHaveValue("");
  // 摘要 chip 与空状态文案都会点名该筛选（Issue #276），断言限定在摘要内。
  const summary = page.getByLabel("当前筛选");
  await expect(summary.getByText("教师不存在（99999）")).toBeVisible();
  await expect(page.getByText(/教师“99999”/)).toHaveCount(0);

  // 空状态与清空筛选保持可用；工具条与空状态按钮同文案（Issue #276）。
  await expect(
    page.getByText("没有符合筛选条件的课程"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "清空筛选" }),
  ).toHaveCount(2);
  await page
    .getByRole("status")
    .filter({ hasText: "没有符合筛选条件的课程" })
    .getByRole("button", { name: "清空筛选" })
    .click();
  await expect(page).not.toHaveURL(/teacherId=/);
  await expect(
    page.getByRole("link", { name: "中国传统文化导论" }),
  ).toBeVisible();
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

test("filtered empty state names every active filter and both clear buttons share one label", async ({
  page,
}) => {
  await mockCatalogApi(page, { deepLinkTeacher: true });
  // 关键词 + 类别 + 院系 + 教师叠到 0 条（mock 只按院系/教师过滤）。
  await page.goto(
    "/courses?q=网球&category=sports&department=体育学院&teacherId=999",
  );

  // 空文案点名全部生效筛选，不只提关键词（Issue #276）。
  const empty = page
    .getByRole("status")
    .filter({ hasText: "没有找到匹配「网球」的课程" });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("关键词“网球”");
  await expect(empty).toContainText("体育课");
  await expect(empty).toContainText("院系“体育学院”");
  await expect(empty).toContainText("教师“深链教师”");

  // 工具条与空状态按钮同文案（Issue #276）。
  await expect(
    page.getByRole("button", { name: "清空筛选" }),
  ).toHaveCount(2);

  // 空状态按钮清空全部筛并回到有结果的目录。
  await empty.getByRole("button", { name: "清空筛选" }).click();
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page).not.toHaveURL(/category=/);
  await expect(page).not.toHaveURL(/department=/);
  await expect(page).not.toHaveURL(/teacherId=/);
  await expect(
    page.getByRole("link", { name: "中国传统文化导论" }),
  ).toBeVisible();
});

test("sort select is disabled while the catalog shows 0 courses", async ({
  page,
}) => {
  await mockCatalogApi(page);
  await page.goto("/courses?department=会计学院");

  // 0 门课程：排序控件禁用，不会看似重排了空列表（Issue #278）。
  const sortTrigger = page.getByRole("button", { name: /排序/ });
  await expect(
    page.getByText("没有符合筛选条件的课程"),
  ).toBeVisible();
  await expect(sortTrigger).toBeDisabled();

  // 清空筛选回到有结果的目录后，排序控件恢复可用。
  await page
    .getByRole("search")
    .getByRole("button", { name: "清空筛选" })
    .click();
  await expect(
    page.getByRole("link", { name: "中国传统文化导论" }),
  ).toBeVisible();
  await expect(sortTrigger).toBeEnabled();

  await sortTrigger.click();
  await page.getByRole("option", { name: "课名", exact: true }).click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(catalogFirstRow(page)).toContainText("中国传统文化导论");
});

test("deep-linked sort survives a 0-result filter stack", async ({ page }) => {
  await mockCatalogApi(page);
  await page.goto("/courses?sort=name&department=会计学院");

  // 0 条时排序控件禁用但保留深链值，不丢已选的 sort（Issue #278）。
  const sortTrigger = page.getByRole("button", { name: /排序/ });
  await expect(
    page.getByText("没有符合筛选条件的课程"),
  ).toBeVisible();
  await expect(sortTrigger).toBeDisabled();
  await expect(sortTrigger).toContainText("课名");

  // 清空筛选后结果按深链 sort=name 排序，控件恢复可用。
  await page
    .getByRole("search")
    .getByRole("button", { name: "清空筛选" })
    .click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(sortTrigger).toBeEnabled();
  await expect(catalogFirstRow(page)).toContainText("中国传统文化导论");
});

test("out-of-range deep-linked page keeps the sort control usable", async ({
  page,
}) => {
  await mockCatalogApi(page, { emptyBeyondFirstPage: true });
  await page.goto("/courses?page=2");

  // 深链越界页：items 空但 total>0，排序仍是回到第 1 页的出口（Issue #278）。
  const sortTrigger = page.getByRole("button", { name: /排序/ });
  await expect(sortTrigger).toBeEnabled();
  await sortTrigger.click();
  await page.getByRole("option", { name: "课名", exact: true }).click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(page).toHaveURL(/page=1/);
  await expect(catalogFirstRow(page)).toContainText("中国传统文化导论");
});
