import { expect, test, type Page } from "@playwright/test";

type AdminMock = {
  viewerAuthenticated: boolean;
  adminAuthed: boolean;
  bindCalls: Array<string | null>;
};

async function mockAdminApi(page: Page, mock: AdminMock) {
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
          authenticated: mock.viewerAuthenticated,
          csrfToken: mock.viewerAuthenticated ? "csrf-user" : undefined,
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
      return route.fulfill({ json: null });
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
    if (url.pathname === "/api/admin/logout") {
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test("guest /admin has no password form and links to campus login", async ({
  page,
}) => {
  await mockAdminApi(page, {
    viewerAuthenticated: false,
    adminAuthed: false,
    bindCalls: [],
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "管理后台" })).toBeVisible();
  await expect(page.getByText("第一个校园登录打开本页的人会成为首位管理员")).toBeVisible();
  await expect(page.getByRole("link", { name: "去登录" })).toHaveAttribute(
    "href",
    "/login?from=/admin",
  );
  await expect(page.getByLabel("管理员口令")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登录" })).toHaveCount(0);
});

test("unbound campus session cannot open the admin hub", async ({ page }) => {
  await mockAdminApi(page, {
    viewerAuthenticated: true,
    adminAuthed: false,
    bindCalls: [],
  });
  await page.goto("/admin");
  await expect(
    page.getByText("当前校园登录未绑定为管理员"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "去登录" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "管理员学号" })).toHaveCount(0);
});

test("bound admin can add student IDs without seeing them echoed", async ({
  page,
}) => {
  const mock: AdminMock = {
    viewerAuthenticated: true,
    adminAuthed: true,
    bindCalls: [],
  };
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
