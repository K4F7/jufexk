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
    if (url.pathname === "/api/courses" || url.pathname === "/api/teachers") {
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test("main nav items are single links without nested buttons", async ({
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
  const teacherLink = nav.getByRole("link", { name: "教师" });

  await expect(courseLink).toBeVisible();
  await expect(teacherLink).toBeVisible();
  const submitLink = nav.getByRole("link", { name: "写评价", exact: true });
  await expect(submitLink).toBeVisible();
  await expect(nav.getByText("需要登录")).toHaveCount(0);
  await expect(nav.getByRole("link")).toHaveCount(3);
  await expect(nav.getByRole("button")).toHaveCount(0);
  await expect(nav.locator("a button")).toHaveCount(0);
  await expect(courseLink).toHaveAttribute("aria-current", "page");
  await expect(teacherLink).not.toHaveAttribute("aria-current", "page");

  const focusableCount = await nav
    .locator('a, button, [tabindex]:not([tabindex="-1"])')
    .count();
  expect(focusableCount).toBe(3);

  await teacherLink.click();
  await expect(page).toHaveURL(/\/teachers$/);
  await expect(teacherLink).toHaveAttribute("aria-current", "page");
  await expect(courseLink).not.toHaveAttribute("aria-current", "page");
  expect(renderWarnings).toEqual([]);
});

test("write-review nav stays visible without a login gate", async ({
  page,
}) => {
  await mockShellApi(page);
  await page.goto("/courses");

  const nav = page.getByRole("navigation", { name: "主导航" });
  const submitLink = nav.getByRole("link", { name: "写评价", exact: true });
  await expect(submitLink).toBeVisible();
  await expect(nav.getByRole("link")).toHaveCount(3);

  await submitLink.click();
  await expect(page).toHaveURL(/\/login\?from=%2Fsubmit$/);
});
