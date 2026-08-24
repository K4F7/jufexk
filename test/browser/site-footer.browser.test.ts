import { expect, test, type Page } from "@playwright/test";
import {
  CONTACT_EMAIL,
  GITHUB_ISSUES_URL,
  GITHUB_REPO_URL,
  SITE_OFFICIAL_CHANNELS,
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
    if (url.pathname === "/api/admin/session") {
      return route.fulfill({
        status: 401,
        json: { error: "请先用已绑定的学号登录" },
      });
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
  await expect(feedback).toHaveAttribute("href", GITHUB_ISSUES_URL);
  await expect(feedback).toHaveAttribute("target", "_blank");
  await expect(feedback).toHaveAttribute("rel", /noreferrer/);

  await expect(footerNav.getByRole("link", { name: "关于我们" })).toBeVisible();
  await expect(footerNav.getByRole("link", { name: "联系我们" })).toBeVisible();
  await expect(footerNav.getByRole("link", { name: "资源" })).toBeVisible();
  await expect(footerNav.getByRole("link", { name: "使用条款" })).toBeVisible();
  await expect(footerNav.getByRole("link", { name: "公告" })).toBeVisible();
  await expect(footerNav.getByRole("link", { name: "管理" })).toBeVisible();
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
  await expect(page.getByText(/任课评价必须绑定/)).toBeVisible();

  await footerNav.getByRole("link", { name: "联系我们" }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByRole("heading", { name: "联系我们" })).toBeVisible();
  const issues = page.getByRole("link", { name: "前往 GitHub Issues" });
  await expect(issues).toHaveAttribute("href", GITHUB_ISSUES_URL);
  await expect(issues).toHaveAttribute("target", "_blank");
  const mail = page.getByRole("link", { name: CONTACT_EMAIL });
  await expect(mail).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);

  await footerNav.getByRole("link", { name: "资源" }).click();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole("heading", { name: "资源" })).toBeVisible();
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
  await expect(page.getByText(/MIT License/)).toBeVisible();

  await footerNav.getByRole("link", { name: "公告" }).click();
  await expect(page).toHaveURL(/\/announcements$/);
  await expect(page.getByRole("heading", { name: "公告栏" })).toBeVisible();
  await expect(page.getByText("站点运营公告；普通用户只读。")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发布公告" })).toHaveCount(0);

  await footerNav.getByRole("link", { name: "管理" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("当前身份不是管理员。")).toBeVisible();
  await expect(page.getByRole("link", { name: "管理员学号" })).toHaveCount(0);
});
