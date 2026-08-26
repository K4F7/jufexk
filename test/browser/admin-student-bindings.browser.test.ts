import { expect, test, type Page } from "@playwright/test";

/**
 * 管理后台只验收桌面端。mobile-chromium 在 playwright.config.ts 里
 * 用 testIgnore 排除本文件，不进移动端 CI。
 */

type AdminMock = {
  viewerAuthenticated: boolean;
  adminAuthed: boolean;
  bindCalls: Array<string | null>;
  bannerPuts: Array<string | null>;
  desktopHtml: string;
  mobileHtml: string;
  bannerHistory: Array<{
    id: number;
    desktopHtml: string;
    mobileHtml: string;
    createdAt: string;
  }>;
};

async function mockAdminApi(page: Page, mock: AdminMock) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: { siteName: "非官方课评@JUFE", universityName: "江西财经大学", admin: false },
      });
    }
    if (url.pathname === "/api/user/session") {
      return route.fulfill({
        json: {
          authenticated: mock.viewerAuthenticated,
          csrfToken: mock.viewerAuthenticated ? "csrf-user" : undefined,
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    }
    if (url.pathname === "/api/site/banner") {
      return route.fulfill({
        json: {
          desktopHtml: mock.desktopHtml,
          mobileHtml: mock.mobileHtml,
          updatedAt: null,
        },
      });
    }
    if (url.pathname === "/api/announcements") {
      return route.fulfill({
        json: {
          items: [
            {
              id: 3,
              title: "维护通知",
              content: "今晚维护",
              author: "站务组",
              time: "2026-08-21 08:00:00",
            },
          ],
        },
      });
    }
    if (url.pathname === "/api/admin/session") {
      if (!mock.adminAuthed) {
        return route.fulfill({
          status: 401,
          json: { error: "请先用已绑定的学号登录" },
        });
      }
      return route.fulfill({
        json: { ok: true, kind: "admin", source: "student", csrfToken: "csrf-admin" },
      });
    }
    if (url.pathname === "/api/admin/student-bindings") {
      if (route.request().method() === "POST") {
        mock.bindCalls.push(route.request().postData());
        return route.fulfill({ json: { ok: true, added: 2, skipped: 0 } });
      }
      return route.fulfill({
        json: {
          items: [{ id: 7, created_at: "2026-08-24 00:00:00" }],
        },
      });
    }
    if (url.pathname === "/api/admin/banners") {
      return route.fulfill({ json: { items: mock.bannerHistory } });
    }
    if (url.pathname === "/api/admin/banner" && route.request().method() === "PUT") {
      mock.bannerPuts.push(route.request().postData());
      const body = JSON.parse(route.request().postData() || "{}") as {
        desktopHtml?: string;
        mobileHtml?: string;
      };
      mock.desktopHtml = body.desktopHtml ?? "";
      mock.mobileHtml = body.mobileHtml ?? "";
      mock.bannerHistory = [
        {
          id: 11,
          desktopHtml: mock.desktopHtml,
          mobileHtml: mock.mobileHtml,
          createdAt: "2026-08-25 00:00:00",
        },
        ...mock.bannerHistory,
      ];
      return route.fulfill({
        json: {
          ok: true,
          banner: {
            desktopHtml: mock.desktopHtml,
            mobileHtml: mock.mobileHtml,
            updatedAt: "2026-08-25 00:00:00",
          },
        },
      });
    }
    const userMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(url.pathname);
    if (userMatch && route.request().method() === "GET") {
      return route.fulfill({
        json: {
          userRef: decodeURIComponent(userMatch[1]),
          blocked: false,
          blockedUntil: null,
        },
      });
    }
    if (url.pathname === "/api/admin/logout") {
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

function emptyMock(overrides: Partial<AdminMock> = {}): AdminMock {
  return {
    viewerAuthenticated: false,
    adminAuthed: false,
    bindCalls: [],
    bannerPuts: [],
    desktopHtml: "",
    mobileHtml: "",
    bannerHistory: [],
    ...overrides,
  };
}

test("guest /admin has no password form and links to campus login", async ({
  page,
}) => {
  await mockAdminApi(page, emptyMock());
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "管理后台" })).toBeVisible();
  await expect(page.getByText("当前身份不是管理员。")).toBeVisible();
  await expect(page.getByText("第一个校园登录打开本页的人会成为首位管理员")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "去登录" })).toHaveAttribute(
    "href",
    "/login?from=/admin",
  );
  await expect(page.getByLabel("管理员口令")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登录" })).toHaveCount(0);
});

test("unbound campus session cannot open the admin hub", async ({ page }) => {
  await mockAdminApi(
    page,
    emptyMock({ viewerAuthenticated: true, adminAuthed: false }),
  );
  await page.goto("/admin");
  await expect(page.getByText("当前身份不是管理员。")).toBeVisible();
  await expect(page.getByRole("link", { name: "去登录" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "管理员学号" })).toHaveCount(0);
});

test("bound admin can add student IDs without seeing them echoed", async ({
  page,
}) => {
  const mock = emptyMock({
    viewerAuthenticated: true,
    adminAuthed: true,
  });
  await mockAdminApi(page, mock);
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "管理员学号" })).toBeVisible();
  await page.getByRole("link", { name: "管理员学号" }).click();
  await expect(page).toHaveURL(/\/admin\/admins$/);
  await expect(page.getByRole("heading", { name: "管理员学号" })).toBeVisible();
  await expect(page.getByText("2026-08-24 00:00:00")).toBeVisible();
  await expect(page.getByText("2021888001")).toHaveCount(0);

  await page.getByRole("textbox", { name: "学号*" }).fill("2021888001\n2021888002");
  await page.getByRole("button", { name: "绑定" }).click();
  await expect(page.getByText("已绑定 2 个学号")).toBeVisible();
  expect(mock.bindCalls).toEqual([
    JSON.stringify({ text: "2021888001\n2021888002" }),
  ]);
});

test("admin hub tabs and account menu reach banner and user mute", async ({
  page,
}) => {
  const mock = emptyMock({
    viewerAuthenticated: true,
    adminAuthed: true,
  });
  await mockAdminApi(page, mock);
  await page.goto("/admin");

  await page.getByRole("button", { name: "账号" }).click();
  await page.getByRole("menuitem", { name: "管理后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole("tab", { name: "Banner" }).click();
  await expect(page).toHaveURL(/\/admin\/banner$/);
  await expect(page.getByRole("heading", { name: "全站 Banner" })).toBeVisible();
  await page.getByRole("textbox", { name: /桌面版 banner/ }).fill("<p>桌面公告</p>");
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.getByText("已保存")).toBeVisible();
  expect(mock.bannerPuts).toEqual([
    JSON.stringify({ desktopHtml: "<p>桌面公告</p>", mobileHtml: "" }),
  ]);

  await page.getByRole("tab", { name: "概览" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("searchbox", { name: "站内用户 ID" }).fill("user-ref-1");
  await page.getByRole("button", { name: "前往" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/user-ref-1$/);
  await expect(page.getByText("未禁言")).toBeVisible();
});

test("announcement list shows the public time field", async ({ page }) => {
  await mockAdminApi(
    page,
    emptyMock({ viewerAuthenticated: true, adminAuthed: true }),
  );
  await page.goto("/announcements");
  await expect(page.getByRole("heading", { name: "维护通知" })).toBeVisible();
  await expect(page.getByText("发表于 2026-08-21")).toBeVisible();
  await expect(page.getByRole("button", { name: "发布公告" })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理首页" })).toHaveAttribute(
    "href",
    "/admin",
  );
});
