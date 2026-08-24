import { expect, test, type Page } from "@playwright/test";

const relations = [
  {
    course_id: 8,
    code: "MA101",
    name: "高等数学",
    category: "general",
    department: "数学",
    teacher_id: 9,
    teacher_name: "张三",
    rating: 4.2,
    review_count: 6,
  },
  {
    course_id: 10,
    code: "MA102",
    name: "线性代数",
    category: "general",
    department: "数学",
    teacher_id: 11,
    teacher_name: "李四",
    rating: 3.8,
    review_count: 4,
  },
];

async function mockScheduleApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
      });
    }
    if (url.pathname === "/api/site/banner") {
      return route.fulfill({
        json: { desktopHtml: "", mobileHtml: "", updatedAt: null },
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
    if (url.pathname === "/api/auth/campus") {
      return route.fulfill({
        json: {
          enabled: false,
          reason: "not_whitelisted",
          loginPath: "/login",
          logoutPath: "/logout",
          callbackPath: "/api/auth/callback",
        },
      });
    }
    if (url.pathname === "/api/courses") {
      return route.fulfill({
        json: {
          items: url.searchParams.get("q") ? relations : [],
          page: 1,
          pageSize: 20,
          total: url.searchParams.get("q") ? relations.length : 0,
          pages: 1,
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test("search, stage, place two courses on the same slot, and keep the plan", async ({
  page,
}) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");

  const search = page.getByRole("searchbox", { name: "搜索要排的课程" });
  await search.fill("高等数学");
  await search.press("Enter");

  const results = page.getByRole("list", { name: "搜索结果" });
  await expect(results.getByText("高等数学")).toBeVisible();
  await expect(results.getByText("线性代数")).toBeVisible();

  await results.getByRole("button", { name: "加入课表" }).nth(0).click();
  await results.getByRole("button", { name: "加入课表" }).nth(0).click();

  const staged = page.getByLabel("已选课程");
  await expect(staged.getByRole("link", { name: "高等数学（张三）" })).toBeVisible();
  await expect(staged.getByRole("link", { name: "线性代数（李四）" })).toBeVisible();

  await staged.getByRole("button", { name: "排上" }).nth(0).click();
  await staged.getByRole("button", { name: "排上" }).nth(1).click();

  await expect(page.getByRole("alert")).toContainText(
    "高等数学（张三）与线性代数（李四）在周一第1–2节冲突",
  );
  const timetable = page.getByRole("grid", { name: "周课表" });
  await expect(timetable.getByText("冲突").first()).toBeVisible();

  await page.reload();
  await expect(timetable.getByText("高等数学（张三）").first()).toBeVisible();
  await expect(timetable.getByText("线性代数（李四）").first()).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("冲突");
});
