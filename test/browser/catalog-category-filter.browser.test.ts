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
      if (category && category !== "sports") {
        return route.fulfill({
          status: 400,
          json: { error: "公开筛选仅支持 sports" },
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
        },
      ].filter((item) => !category || item.category === category);
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

test("course catalog only exposes the sports public category filter", async ({
  page,
}) => {
  await page.goto("/courses");
  const categoryBar = page.getByRole("search", { name: "课程目录筛选" });
  await expect(categoryBar.getByRole("button", { name: "全部" })).toBeVisible();
  await expect(categoryBar.getByRole("button", { name: "体育课" })).toBeVisible();
  await expect(categoryBar.getByRole("button", { name: "专业课" })).toHaveCount(0);
  await expect(categoryBar.getByRole("button", { name: "公共选修" })).toHaveCount(0);
  await expect(categoryBar.getByRole("button", { name: /sports/i })).toHaveCount(0);

  await categoryBar.getByRole("button", { name: "体育课" }).click();
  await expect(page).toHaveURL(/category=sports/);
  await expect(page.getByRole("row").nth(1)).toContainText("篮球");
  await expect(page.getByRole("link", { name: "中国传统文化导论" })).toHaveCount(0);
  await expect(page.getByText("公开筛选仅支持 sports")).toHaveCount(0);
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
