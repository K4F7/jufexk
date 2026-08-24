import { expect, test, type Page } from "@playwright/test";

async function mockShellApi(
  page: Page,
  options: { campusEnabled?: boolean } = {},
) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
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
        json: options.campusEnabled
          ? {
              enabled: true,
              reason: "live",
              loginPath: "/login",
              logoutPath: "/logout",
              callbackPath: "/api/auth/callback",
              appId: "jufexk",
              authBridgeBaseUrl: "https://authbridge.example",
            }
          : {
              enabled: false,
              reason: "not_whitelisted",
              loginPath: "/login",
              logoutPath: "/logout",
              callbackPath: "/api/auth/callback",
            },
      });
    }
    if (url.pathname === "/api/site/banner") {
      return route.fulfill({
        json: { desktopHtml: "", mobileHtml: "", updatedAt: null },
      });
    }
    if (url.pathname === "/api/courses" || url.pathname === "/api/teachers") {
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test("main nav is 课程/课评/排课模拟/导师 with a center course search", async ({
  page,
}) => {
  const renderWarnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning" && msg.text().includes("Unexpected DOM element")) {
      renderWarnings.push(msg.text());
    }
  });

  await mockShellApi(page);
  await page.goto("/courses");

  const nav = page.getByRole("navigation", { name: "主导航" });
  const courseLink = nav.getByRole("link", { name: "课程" });
  const latestLink = nav.getByRole("link", { name: "课评" });
  const scheduleLink = nav.getByRole("link", { name: "排课模拟" });
  const mentorLink = nav.getByRole("link", { name: "导师" });

  await expect(courseLink).toBeVisible();
  await expect(latestLink).toBeVisible();
  await expect(scheduleLink).toBeVisible();
  await expect(mentorLink).toBeVisible();
  // 教师 / 写评价 导航项已下线：写评价只从课程页「写点评」进入。
  await expect(nav.getByRole("link", { name: "教师" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "写评价", exact: true })).toHaveCount(0);
  const navLinks = nav.getByRole("link");
  await expect(navLinks).toHaveCount(4);
  await expect(navLinks.nth(0)).toHaveText("课程");
  await expect(navLinks.nth(1)).toHaveText("课评");
  await expect(navLinks.nth(2)).toHaveText("排课模拟");
  await expect(navLinks.nth(3)).toHaveText("导师");
  await expect(nav.getByRole("button")).toHaveCount(0);
  await expect(nav.locator("a button")).toHaveCount(0);

  // 导师外链新标签打开，带 noreferrer。
  await expect(mentorLink).toHaveAttribute(
    "href",
    "https://pi-review.com/universities/661",
  );
  await expect(mentorLink).toHaveAttribute("target", "_blank");
  await expect(mentorLink).toHaveAttribute("rel", /noreferrer/);

  await expect(courseLink).toHaveAttribute("aria-current", "page");
  await expect(latestLink).not.toHaveAttribute("aria-current", "page");

  // 居中搜索提交到 /courses?q=...。
  const search = page.getByRole("searchbox", { name: "搜索课程" });
  await expect(search).toBeVisible();
  await search.fill("高等数学");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/courses\?q=/);
  await expect(search).toHaveValue("高等数学");

  // 课评 → /latest；进入后课评高亮、课程不再高亮。
  await latestLink.click();
  await expect(page).toHaveURL(/\/latest$/);
  await expect(
    page.getByRole("heading", { name: "最新课评" }),
  ).toBeVisible();
  await expect(latestLink).toHaveAttribute("aria-current", "page");
  await expect(courseLink).not.toHaveAttribute("aria-current", "page");

  await scheduleLink.click();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(page.getByRole("heading", { name: "排课模拟" })).toBeVisible();
  await expect(scheduleLink).toHaveAttribute("aria-current", "page");
  await expect(latestLink).not.toHaveAttribute("aria-current", "page");
  expect(renderWarnings).toEqual([]);
});

test("brand link uses the site name and goes to /courses", async ({ page }) => {
  await mockShellApi(page);
  await page.goto("/latest");

  const brand = page.getByRole("banner").getByRole("link", { name: "选课志" });
  await expect(brand).toBeVisible();
  await expect(brand).toHaveAttribute("href", "/courses");
  await brand.click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(
    page.getByRole("searchbox", { name: "搜索课程" }),
  ).toBeVisible();
});

test("guests get a real login link outside the nav", async ({ page }) => {
  await mockShellApi(page);
  await page.goto("/courses");

  const nav = page.getByRole("navigation", { name: "主导航" });
  await expect(nav.getByRole("link", { name: "登录" })).toHaveCount(0);
  const login = page.getByRole("link", { name: "登录" });
  await expect(login).toBeVisible();
  await login.click();
  await expect(page).toHaveURL(/\/login\?from=%2Fcourses$/);
  await expect(
    page.getByRole("heading", { name: "登录", exact: true }),
  ).toBeVisible();
});
