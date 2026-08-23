/**
 * Browser coverage for /latest（Issue #402）：全站最新公开课评流的页面结构。
 * 全站评价流接口属 #410：未上线前页面不请求任何数据接口，只渲染明确
 * 标注的占位状态，并给出前往课程列表的入口。
 */
import { expect, test, type Page } from "@playwright/test";

async function mockShellApi(page: Page) {
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
    if (url.pathname === "/api/courses" || url.pathname === "/api/teachers")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test("latest page renders the clearly-marked placeholder without fetching a feed", async ({
  page,
}) => {
  const feedRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/reviews/latest")
      feedRequests.push(request.url());
  });

  await mockShellApi(page);
  await page.goto("/latest");

  await expect(page.getByRole("heading", { name: "最新课评" })).toBeVisible();
  const placeholder = page.getByRole("status");
  await expect(placeholder).toContainText("最新课评流暂未接入");
  await expect(placeholder).toContainText("写点评");
  // 占位页不渲染投稿条目，也不请求尚未上线的全站流接口。
  await expect(page.locator("article")).toHaveCount(0);
  expect(feedRequests).toEqual([]);

  // 占位文案里的课程列表入口真实可点。
  await placeholder.getByRole("link", { name: "课程列表" }).click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.getByRole("heading", { name: "课程列表" })).toBeVisible();
});
