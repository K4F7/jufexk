import { expect, test, type Page } from "@playwright/test";
import {
  CONTACT_EMAIL,
  GITHUB_ISSUES_URL,
  GITHUB_REPO_URL,
  SITE_OFFICIAL_CHANNELS,
  statusBadgeUrl,
} from "../../src/lib/site-links";

async function mockPublicApi(page: Page) {
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
    if (url.pathname === "/api/announcements") {
      return route.fulfill({ json: { items: [] } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test.beforeEach(async ({ page }) => mockPublicApi(page));

test("footer exposes GitHub, feedback, and site-info links", async ({
  page,
}) => {
  await page.goto("/courses");

  const footer = page.getByRole("contentinfo");
  const footerNav = footer.getByRole("navigation", { name: "页脚" });
  await expect(footer.getByText("选课志 · 江西财经大学")).toBeVisible();

  const repo = footerNav.getByRole("link", { name: "GitHub 仓库" });
  await expect(repo).toBeVisible();
  await expect(repo).toHaveAttribute("href", GITHUB_REPO_URL);
  await expect(repo).toHaveAttribute("target", "_blank");
  await expect(repo).toHaveAttribute("rel", /noreferrer/);

  const feedback = footerNav.getByRole("link", { name: "反馈问题" });
  await expect(feedback).toBeVisible();
  await expect(feedback).toHaveAttribute("href", "/contact");
  await expect(feedback).not.toHaveAttribute("target", "_blank");

  await expect(footerNav.getByRole("link", { name: "关于我们" })).toBeVisible();
  await expect(footerNav.getByRole("link", { name: "联系我们" })).toHaveCount(0);
  await expect(footerNav.getByRole("link", { name: "友情链接" })).toBeVisible();
  await expect(footerNav.getByRole("link", { name: "资源" })).toHaveCount(0);
  await expect(footerNav.getByRole("link", { name: "使用条款" })).toBeVisible();
  await expect(footerNav.getByRole("link", { name: "公告" })).toHaveCount(0);
  await expect(footerNav.getByRole("link", { name: "管理" })).toHaveCount(0);
  await expect(footerNav.getByRole("link", { name: "系统状态" })).toHaveCount(0);
  const badge = footerNav.getByTitle("系统运行状态");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("src", /\/badge\?theme=(light|dark)$/);
  expect([statusBadgeUrl("light"), statusBadgeUrl("dark")]).toContain(
    await badge.getAttribute("src"),
  );
  const separators = footerNav.locator('[data-slot="separator"]');
  await expect(separators).toHaveCount(5);
  for (const separator of await separators.all()) {
    await expect(separator.locator("..")).toHaveAttribute("aria-hidden", "true");
  }

  const badgePair = badge.locator("..");
  await expect(badgePair.locator('[data-slot="separator"]')).toHaveCount(1);
  await expect(badgePair).toHaveCSS("white-space", "nowrap");

  for (const link of await footerNav.getByRole("link").all()) {
    if ((await link.getAttribute("aria-label")) === "GitHub 仓库") continue;
    const pair = link.locator("..");
    await expect(pair.locator('[data-slot="separator"]')).toHaveCount(1);
    await expect(pair).toHaveCSS("white-space", "nowrap");
  }
});

test("footer site-info links open their pages", async ({ page }) => {
  await page.goto("/courses");
  const footerNav = page
    .getByRole("contentinfo")
    .getByRole("navigation", { name: "页脚" });

  await footerNav.getByRole("link", { name: "关于我们" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "关于我们" })).toBeVisible();
  await expect(page.getByText(/非官方课程—教师评价站/)).toBeVisible();
  await expect(page.getByText(/点评会绑到具体任课老师/)).toBeVisible();
  await expect(page.getByText(/公开内容匿名发布，站方可拒绝或撤回/)).toBeVisible();
  await expect(page.getByText(/经人工审核/)).toHaveCount(0);

  await footerNav.getByRole("link", { name: "反馈问题" }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByRole("heading", { name: "反馈问题" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "联系我们" })).toHaveCount(0);
  const issues = page.getByRole("link", { name: "前往 GitHub Issues" });
  await expect(issues).toHaveAttribute("href", GITHUB_ISSUES_URL);
  await expect(issues).toHaveAttribute("target", "_blank");
  const mail = page.getByRole("link", { name: CONTACT_EMAIL });
  await expect(mail).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);

  await footerNav.getByRole("link", { name: "友情链接" }).click();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole("heading", { name: "友情链接" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "资源" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "评知校园" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "USTC-iCourse / ustc-course" }),
  ).toBeVisible();
  for (const channel of SITE_OFFICIAL_CHANNELS) {
    await expect(page.getByRole("link", { name: channel.title })).toHaveAttribute(
      "href",
      channel.href,
    );
  }
  await expect(page.getByText("教务处微信公众号：jxufe-jwc")).toBeVisible();

  await footerNav.getByRole("link", { name: "使用条款" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { name: "使用条款" })).toBeVisible();
  await expect(page.getByText(/不构成学校官方意见/)).toBeVisible();
  await expect(page.getByText(/任课评价匿名公开/)).toBeVisible();
  await expect(page.getByText(/站方可以拒绝、编辑或撤回公开内容/)).toBeVisible();
  await expect(page.getByText(/经审核后/)).toHaveCount(0);
  await expect(page.getByText(/MIT License/)).toBeVisible();
});
