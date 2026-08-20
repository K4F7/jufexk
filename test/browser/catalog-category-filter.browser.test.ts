import { expect, test, type Page } from "@playwright/test";

async function mockCatalogApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
      });
    if (url.pathname === "/api/courses") {
      const category = url.searchParams.get("category") || "";
      const allowed = new Set(["sports", "english", "ideology", "math"]);
      if (category && !allowed.has(category)) {
        return route.fulfill({
          status: 400,
          json: { error: "公开筛选仅支持 sports、english、ideology、math" },
        });
      }
      const items = [
        {
          id: 8,
          code: "GEN0108",
          name: "中国传统文化导论",
          category: "general",
          department: "人文学院",
          teachers: "测试教师",
          teacher_refs: "9:测试教师",
          review_count: 1,
          rating: 4.6,
          scheme: "",
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
          rating: 4.2,
          scheme: "pe",
        },
        {
          id: 21,
          code: "EN0101",
          name: "大学英语",
          category: "general",
          department: "外国语学院",
          teachers: "英语教师",
          teacher_refs: "22:英语教师",
          review_count: 1,
          rating: 4.1,
          scheme: "english",
        },
        {
          id: 31,
          code: "ID0101",
          name: "思想道德与法治",
          category: "general",
          department: "马克思主义学院",
          teachers: "思政教师",
          teacher_refs: "32:思政教师",
          review_count: 1,
          rating: 4.0,
          scheme: "ideology",
        },
        {
          id: 41,
          code: "MA0101",
          name: "高等数学",
          category: "general",
          department: "统计学院",
          teachers: "数学教师",
          teacher_refs: "42:数学教师",
          review_count: 1,
          rating: 4.3,
          scheme: "math",
        },
      ]
        .filter((item) => {
          if (!category) return true;
          if (category === "sports")
            return item.category === "sports" || item.scheme === "pe";
          return item.scheme === category;
        })
        .map(({ scheme: _scheme, ...item }) => item);
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

function catalogFirstRow(page: Page) {
  return page.getByRole("grid", { name: "课程目录" }).getByRole("row").nth(1);
}

test.beforeEach(async ({ page }) => mockCatalogApi(page));

test("course catalog exposes sports, english, ideology, and math filters", async ({
  page,
}) => {
  await page.goto("/courses");
  const categoryBar = page.getByRole("search", { name: "课程目录筛选" });
  await expect(categoryBar.getByRole("button", { name: "全部" })).toBeVisible();
  await expect(categoryBar.getByRole("button", { name: "体育课" })).toBeVisible();
  await expect(categoryBar.getByRole("button", { name: "英语课" })).toBeVisible();
  await expect(categoryBar.getByRole("button", { name: "思政课" })).toBeVisible();
  await expect(categoryBar.getByRole("button", { name: "数学课" })).toBeVisible();
  await expect(categoryBar.getByRole("button", { name: "专业课" })).toHaveCount(0);
  await expect(categoryBar.getByRole("button", { name: "公共选修" })).toHaveCount(0);
  await expect(categoryBar.getByRole("button", { name: /sports/i })).toHaveCount(0);

  await categoryBar.getByRole("button", { name: "英语课" }).click();
  await expect(page).toHaveURL(/category=english/);
  await expect(page.getByRole("link", { name: "大学英语" })).toBeVisible();
  await expect(page.getByRole("link", { name: "篮球" })).toHaveCount(0);
  await expect(page.getByText(/公开筛选仅支持/)).toHaveCount(0);

  await categoryBar.getByRole("button", { name: "思政课" }).click();
  await expect(page).toHaveURL(/category=ideology/);
  await expect(page.getByRole("link", { name: "思想道德与法治" })).toBeVisible();
  await expect(page.getByText(/公开筛选仅支持/)).toHaveCount(0);

  await categoryBar.getByRole("button", { name: "数学课" }).click();
  await expect(page).toHaveURL(/category=math/);
  await expect(page.getByRole("link", { name: "高等数学" })).toBeVisible();
  await expect(page.getByText(/公开筛选仅支持/)).toHaveCount(0);
});

test("sports category deep link still works", async ({ page }) => {
  await page.goto("/courses?category=sports");
  await expect(page).toHaveURL(/category=sports/);
  await expect(catalogFirstRow(page)).toContainText("篮球");
  await expect(page.getByRole("link", { name: "中国传统文化导论" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "大学英语" })).toHaveCount(0);
  await expect(page.getByText(/公开筛选仅支持/)).toHaveCount(0);
});

test("obsolete category query params do not request the public API", async ({
  page,
}) => {
  const courseRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/courses") courseRequests.push(url.search);
  });

  await page.goto("/courses?category=major");
  await expect(page.getByRole("link", { name: "中国传统文化导论" })).toBeVisible();
  await expect(page.getByRole("link", { name: "篮球" })).toBeVisible();
  await expect(page).not.toHaveURL(/category=/);
  expect(courseRequests.some((search) => search.includes("category=major"))).toBe(
    false,
  );
});
