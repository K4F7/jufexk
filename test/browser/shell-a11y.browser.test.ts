import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function mockPublicShell(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: {
          siteName: "选课志",
          universityName: "江西财经大学",
          admin: false,
        },
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

test.beforeEach(async ({ page }) => mockPublicShell(page));

test("skip link is the first tab stop and moves focus to main @mobile-smoke", async ({
  page,
}) => {
  await page.goto("/courses");

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "跳到主内容" });
  await expect(skip).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page.getByRole("main")).toHaveAttribute("id", "main-content");
});

test("shell icon controls and login form expose accessible names", async ({
  page,
}) => {
  await page.goto("/courses");
  await expect(
    page.getByRole("button", { name: /切换到(暗色|亮色)模式/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "登录" })).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "搜索课程" }),
  ).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();
  await expect(page.getByLabel("学号")).toBeVisible();
  await expect(page.getByLabel("校园密码")).toBeVisible();
});

test("public catalog and login have no axe WCAG A/AA violations except frozen Sky contrast", async ({
  page,
}) => {
  for (const path of ["/courses", "/login"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations, `${path} axe violations`).toEqual([]);
  }
});
