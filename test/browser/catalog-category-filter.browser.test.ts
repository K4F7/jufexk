import { expect, test, type Page } from "@playwright/test";

/**
 * Issue #402 筛选框的类别行：全部 / 专业课 / 公共课 / 体育课 / 英语课 /
 * 思政课 / 数学课（与 #364 的类别集合一致）。URL 继续用 ?category=。
 */
const COURSES = [
  {
    id: 8,
    code: "GEN0108",
    name: "中国传统文化导论",
    category: "general",
    department: "人文学院",
    review_count: 1,
    rating: null,
    teacher_refs: "9:测试教师",
    scheme: "major",
    mooc: false,
  },
  {
    id: 11,
    code: "PE0101",
    name: "篮球",
    category: "sports",
    department: "体育学院",
    review_count: 2,
    rating: null,
    teacher_refs: "12:体育教师",
    scheme: "pe",
    mooc: false,
  },
  {
    id: 21,
    code: "EN0101",
    name: "大学英语",
    category: "general",
    department: "外国语学院",
    review_count: 1,
    rating: null,
    teacher_refs: "22:英语教师",
    scheme: "english",
    mooc: false,
  },
  {
    id: 31,
    code: "ID0101",
    name: "思想道德与法治",
    category: "general",
    department: "马克思主义学院",
    review_count: 1,
    rating: null,
    teacher_refs: "32:思政教师",
    scheme: "ideology",
    mooc: false,
  },
  {
    id: 41,
    code: "MA0101",
    name: "高等数学",
    category: "general",
    department: "统计学院",
    review_count: 1,
    rating: null,
    teacher_refs: "42:数学教师",
    scheme: "math",
    mooc: false,
  },
  {
    id: 51,
    code: "PB0101",
    name: "公共基础导论",
    category: "general",
    department: "教务处",
    review_count: 1,
    rating: null,
    teacher_refs: "52:公共课教师",
    scheme: "public_basic",
    mooc: false,
  },
  {
    id: 61,
    code: "MOOC0101",
    name: "思政网课",
    category: "general",
    department: "马克思主义学院",
    review_count: 1,
    rating: null,
    teacher_refs: "62:网课教师",
    scheme: "ideology",
    mooc: true,
  },
];

async function mockCatalogApi(page: Page) {
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
    if (url.pathname === "/api/courses") {
      const category = url.searchParams.get("category") || "";
      const allowed = new Set([
        "major",
        "public_basic",
        "sports",
        "english",
        "ideology",
        "math",
        "mooc",
      ]);
      if (category && !allowed.has(category)) {
        return route.fulfill({
          status: 400,
          json: {
            error:
              "公开筛选仅支持 major、public_basic、sports、english、ideology、math、mooc",
          },
        });
      }
      const items = COURSES.filter((item) => {
        if (!category) return true;
        if (category === "mooc") return item.mooc;
        if (item.mooc) return false;
        if (category === "sports")
          return item.category === "sports" || item.scheme === "pe";
        return item.scheme === category;
      }).map(({ scheme: _scheme, mooc: _mooc, ...item }) => item);
      return route.fulfill({
        json: {
          items,
          page: 1,
          pageSize: 20,
          total: items.length,
          pages: 1,
        },
      });
    }
    if (url.pathname === "/api/teachers")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 50, total: 0, pages: 1 },
      });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test.beforeEach(async ({ page }) => mockCatalogApi(page));

test("category row exposes the six scheme categories and filters by scheme", async ({
  page,
}) => {
  await page.goto("/courses");
  const filterBox = page.getByRole("search", { name: "课程目录筛选" });
  await expect(
    filterBox.getByRole("button", { name: "全部", exact: true }),
  ).toBeVisible();
  await expect(
    filterBox.getByRole("button", { name: "专业课", exact: true }),
  ).toBeVisible();
  await expect(
    filterBox.getByRole("button", { name: "公共课", exact: true }),
  ).toBeVisible();
  await expect(
    filterBox.getByRole("button", { name: "体育课", exact: true }),
  ).toBeVisible();
  await expect(
    filterBox.getByRole("button", { name: "英语课", exact: true }),
  ).toBeVisible();
  await expect(
    filterBox.getByRole("button", { name: "思政课", exact: true }),
  ).toBeVisible();
  await expect(
    filterBox.getByRole("button", { name: "数学课", exact: true }),
  ).toBeVisible();
  // 网课入口下线（mooc 深链仍被 API 接受）；不展示英文键名。
  await expect(
    filterBox.getByRole("button", { name: "网课" }),
  ).toHaveCount(0);
  await expect(
    filterBox.getByRole("button", { name: /sports/i }),
  ).toHaveCount(0);
  await expect(
    filterBox.getByRole("button", { name: /mooc/i }),
  ).toHaveCount(0);

  await filterBox.getByRole("button", { name: "专业课" }).click();
  await expect(page).toHaveURL(/category=major/);
  await expect(
    page.getByRole("link", { name: /中国传统文化导论/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /篮球/ })).toHaveCount(0);
  await expect(page.getByText(/公开筛选仅支持/)).toHaveCount(0);

  await filterBox.getByRole("button", { name: "公共课" }).click();
  await expect(page).toHaveURL(/category=public_basic/);
  await expect(
    page.getByRole("link", { name: /公共基础导论/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /中国传统文化导论/ }),
  ).toHaveCount(0);

  await filterBox.getByRole("button", { name: "英语课" }).click();
  await expect(page).toHaveURL(/category=english/);
  await expect(page.getByRole("link", { name: /大学英语/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /篮球/ })).toHaveCount(0);

  await filterBox.getByRole("button", { name: "思政课" }).click();
  await expect(page).toHaveURL(/category=ideology/);
  await expect(
    page.getByRole("link", { name: /思想道德与法治/ }),
  ).toBeVisible();
  // mooc 标签课程不进思政课筛选。
  await expect(page.getByRole("link", { name: /思政网课/ })).toHaveCount(0);

  await filterBox.getByRole("button", { name: "数学课" }).click();
  await expect(page).toHaveURL(/category=math/);
  await expect(page.getByRole("link", { name: /高等数学/ })).toBeVisible();
});

test("sports category deep link still works", async ({ page }) => {
  await page.goto("/courses?category=sports");
  await expect(page).toHaveURL(/category=sports/);
  await expect(page.getByRole("link", { name: /篮球/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /中国传统文化导论/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /大学英语/ })).toHaveCount(0);
  await expect(page.getByText(/公开筛选仅支持/)).toHaveCount(0);
});

// #364：major / public_basic 是有效公开筛选，深链不再被当作过期参数清掉。
test("major and public_basic deep links are not treated as stale", async ({
  page,
}) => {
  await page.goto("/courses?category=major");
  await expect(page).toHaveURL(/category=major/);
  await expect(
    page.getByRole("link", { name: /中国传统文化导论/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /公共基础导论/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /篮球/ })).toHaveCount(0);
  await expect(page.getByText(/公开筛选仅支持/)).toHaveCount(0);

  await page.goto("/courses?category=public_basic");
  await expect(page).toHaveURL(/category=public_basic/);
  await expect(page.getByRole("link", { name: /公共基础导论/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /中国传统文化导论/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/公开筛选仅支持/)).toHaveCount(0);
});

test("obsolete category query params get stripped without hitting the API", async ({
  page,
}) => {
  const catalogRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/courses") catalogRequests.push(url.search);
  });

  for (const obsolete of ["general", "pe", "required"]) {
    await page.goto(`/courses?category=${obsolete}`);
    await expect(
      page.getByRole("link", { name: /中国传统文化导论/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /篮球/ })).toBeVisible();
    await expect(page).not.toHaveURL(/category=/);
  }
  expect(
    catalogRequests.some((search) =>
      /category=(general|pe|required)/.test(search),
    ),
  ).toBe(false);
});

test("mooc deep link keeps filtering even without a filter-row button", async ({
  page,
}) => {
  await page.goto("/courses?category=mooc");
  await expect(page).toHaveURL(/category=mooc/);
  await expect(page.getByRole("link", { name: /思政网课/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /思想道德与法治/ }),
  ).toHaveCount(0);
});
