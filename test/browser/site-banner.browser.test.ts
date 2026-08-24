import { expect, test } from "@playwright/test";

test("shows the matching desktop or mobile site banner below the header @mobile-smoke", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/config") {
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学" },
      });
    }
    if (pathname === "/api/site/banner") {
      return route.fulfill({
        json: {
          desktopHtml: "<p>桌面全站公告</p>",
          mobileHtml: "<p>移动全站公告</p>",
          updatedAt: "2026-08-24 00:00:00",
        },
      });
    }
    if (pathname === "/api/user/session") {
      return route.fulfill({
        json: { authenticated: false, loginPath: "/login", logoutPath: "/logout" },
      });
    }
    if (pathname === "/api/courses") {
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });

  await page.goto("/courses");
  const banner = page.getByRole("region", { name: "全站公告" });
  await expect(banner).toBeVisible();
  const isMobile = (page.viewportSize()?.width ?? 0) < 640;
  await expect(banner.getByText(isMobile ? "移动全站公告" : "桌面全站公告")).toBeVisible();
  await expect(
    banner.getByText(isMobile ? "桌面全站公告" : "移动全站公告"),
  ).toBeHidden();
  const headerBottom = await page.getByRole("banner").evaluate((node) =>
    node.getBoundingClientRect().bottom,
  );
  const bannerTop = await banner.evaluate((node) => node.getBoundingClientRect().top);
  expect(bannerTop).toBeGreaterThanOrEqual(headerBottom - 1);
});
