/**
 * Browser coverage for ordinary-user session, login-waiting, logout and
 * account deletion (issue #139).
 *
 * `/api/user/session` is the only viewer-state source; campus auth stays
 * closed in production, so the enabled flow is exercised against a mocked
 * AuthBridge URL with a stubbed window.open.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

type MockState = {
  authenticated: boolean;
  campusEnabled: boolean;
  sessionFails: boolean;
  logoutFails: boolean;
  endorsement401: boolean;
  logoutCalls: number;
  deleteCalls: number;
};

const AUTHBRIDGE_BASE = "https://authbridge.example";

/** Mirrors src/lib/campus-auth.ts so assertions track the real URL build. */
function expectedAuthUrl(from: string) {
  const callback = new URL("/api/auth/callback", "http://127.0.0.1:4174");
  callback.searchParams.set("from", from);
  const url = new URL("login", `${AUTHBRIDGE_BASE}/`);
  url.searchParams.set("appid", "jufexk");
  url.searchParams.set("mode", "callback");
  url.searchParams.set("callback", callback.toString());
  return url.toString();
}

const ENDORSABLE_REVIEW = {
  id: "review:101",
  course_id: 8,
  teacher_id: 9,
  course_name: "中国传统文化导论",
  course_code: "GEN0108",
  teacher_name: "测试教师",
  comment: "这是一条可认可的任课评价补充说明，内容足够长，用于验证认可入口。",
  endorsement_count: 0,
  endorsable: true,
};

function state(overrides: Partial<MockState> = {}): MockState {
  return {
    authenticated: false,
    campusEnabled: false,
    sessionFails: false,
    logoutFails: false,
    endorsement401: false,
    logoutCalls: 0,
    deleteCalls: 0,
    ...overrides,
  };
}

function fulfillJson(route: Route, json: unknown, status = 200) {
  return route.fulfill({ status, json });
}

async function mockApi(page: Page, mock: MockState) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/config")
      return fulfillJson(route, {
        siteName: "选课志",
        universityName: "江西财经大学",
        admin: false,
      });
    if (url.pathname === "/api/user/session") {
      if (mock.sessionFails)
        return fulfillJson(route, { error: "boom" }, 500);
      return fulfillJson(route, {
        authenticated: mock.authenticated,
        csrfToken: mock.authenticated ? "csrf-user" : undefined,
        loginPath: "/login",
        logoutPath: "/logout",
      });
    }
    if (url.pathname === "/api/auth/campus") {
      if (mock.campusEnabled)
        return fulfillJson(route, {
          enabled: true,
          reason: "live",
          loginPath: "/login",
          logoutPath: "/logout",
          callbackPath: "/api/auth/callback",
          appId: "jufexk",
          authBridgeBaseUrl: AUTHBRIDGE_BASE,
        });
      return fulfillJson(route, {
        enabled: false,
        reason: "not_whitelisted",
        loginPath: "/login",
        logoutPath: "/logout",
        callbackPath: "/api/auth/callback",
      });
    }
    if (url.pathname === "/api/user/logout" && request.method() === "POST") {
      mock.logoutCalls += 1;
      if (mock.logoutFails)
        return fulfillJson(route, { error: "boom" }, 500);
      mock.authenticated = false;
      return fulfillJson(route, {
        ok: true,
        authenticated: false,
        loginPath: "/login",
        logoutPath: "/logout",
      });
    }
    if (url.pathname === "/api/user/account" && request.method() === "DELETE") {
      mock.deleteCalls += 1;
      if (!mock.authenticated)
        return fulfillJson(route, { error: "请先登录" }, 401);
      mock.authenticated = false;
      return fulfillJson(route, {
        ok: true,
        status: "pending_deletion",
        recoveryDays: 30,
      });
    }
    if (url.pathname === "/api/courses")
      return fulfillJson(route, {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
        pages: 1,
      });
    if (url.pathname === "/api/courses/8")
      return fulfillJson(route, {
        course: {
          id: 8,
          code: "GEN0108",
          name: "中国传统文化导论",
          category: "general",
          department: "人文学院",
          teachers: [{ id: 9, name: "测试教师", review_count: 1 }],
        },
        reviewCount: 1,
      });
    if (url.pathname === "/api/courses/8/reviews")
      return fulfillJson(route, {
        items: [ENDORSABLE_REVIEW],
        nextCursor: null,
      });
    const endorsement = /\/api\/reviews\/([^/]+)\/endorsement$/.exec(
      url.pathname,
    );
    if (endorsement && request.method() === "PUT") {
      if (mock.endorsement401)
        return fulfillJson(route, { error: "请先登录后再认可" }, 401);
      return fulfillJson(route, { endorsementCount: 1, viewerEndorsed: true });
    }
    return fulfillJson(route, { error: "not mocked" }, 404);
  });
}

async function stubWindowOpen(page: Page, blocked = false) {
  await page.addInitScript((isBlocked) => {
    const opened: string[] = [];
    (window as unknown as { __openedUrls: string[] }).__openedUrls = opened;
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return isBlocked ? null : ({} as Window);
    };
  }, blocked);
}

async function openedUrls(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __openedUrls: string[] }).__openedUrls,
  );
}

test("guest nav offers a low-emphasis login entry that loops back", async ({
  page,
}) => {
  await mockApi(page, state());
  await page.goto("/courses");
  const login = page.getByRole("link", { name: "登录" });
  await expect(login).toBeVisible();
  await login.click();
  await expect(page).toHaveURL(/\/login\?from=%2Fcourses$/);
  await expect(
    page.getByRole("heading", { name: "普通用户登录" }),
  ).toBeVisible();
});

test("signed-in viewer sees the account menu and the logged-in login page", async ({
  page,
}) => {
  await mockApi(page, state({ authenticated: true }));
  await page.goto("/courses");
  await expect(page.getByRole("button", { name: "账号" })).toBeVisible();
  await expect(page.getByRole("link", { name: "登录" })).toHaveCount(0);

  await page.goto("/login");
  await expect(page.getByText("当前已登录")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用校园统一身份认证登录" }),
  ).toHaveCount(0);
});

test("waiting page reopens campus auth and continues once the session lands", async ({
  page,
}) => {
  const mock = state({ campusEnabled: true });
  await mockApi(page, mock);
  await stubWindowOpen(page);
  await page.goto("/login?from=/courses/8");

  await page
    .getByRole("button", { name: "使用校园统一身份认证登录" })
    .click();
  await expect(page.getByText("等待校园认证完成")).toBeVisible();
  expect(await openedUrls(page)).toEqual([expectedAuthUrl("/courses/8")]);

  await page.getByRole("button", { name: "重新打开认证页面" }).click();
  expect((await openedUrls(page)).length).toBe(2);

  // The user finishes CAS in the other tab; returning focus re-checks the
  // session and the page continues to the original target.
  mock.authenticated = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/courses\/8$/);
  await expect(
    page.getByRole("heading", { name: "中国传统文化导论" }),
  ).toBeVisible();
});

test("cancel stops waiting and returns to the login entry", async ({ page }) => {
  await mockApi(page, state({ campusEnabled: true }));
  await stubWindowOpen(page);
  await page.goto("/login");
  await page
    .getByRole("button", { name: "使用校园统一身份认证登录" })
    .click();
  await expect(page.getByText("等待校园认证完成")).toBeVisible();
  await page.getByRole("button", { name: "取消等待" }).click();
  await expect(
    page.getByRole("button", { name: "使用校园统一身份认证登录" }),
  ).toBeVisible();
  expect((await openedUrls(page)).length).toBe(1);
});

test("a blocked popup explains how to reopen the auth page", async ({
  page,
}) => {
  await mockApi(page, state({ campusEnabled: true }));
  await stubWindowOpen(page, true);
  await page.goto("/login");
  await page
    .getByRole("button", { name: "使用校园统一身份认证登录" })
    .click();
  await expect(
    page.getByText("浏览器拦截了新标签页，请点击下方按钮重新打开认证页面。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新打开认证页面" }),
  ).toBeVisible();
});

test("logout from the account menu clears the session and reports the result", async ({
  page,
}) => {
  const mock = state({ authenticated: true });
  await mockApi(page, mock);
  await page.goto("/courses");

  await page.getByRole("button", { name: "账号" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/logout$/);
  // The guide page never signs out on its own; the explicit confirm does.
  expect(mock.logoutCalls).toBe(0);
  await page.getByRole("button", { name: "确认退出登录" }).click();
  await expect(page.getByText("已退出登录")).toBeVisible();
  expect(mock.logoutCalls).toBe(1);
  await expect(
    page.getByRole("link", { name: "登录", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "返回继续浏览" }).click();
  await expect(page).toHaveURL(/\/courses$/);
});

test("logout failure offers a retry that recovers", async ({ page }) => {
  const mock = state({ authenticated: true, logoutFails: true });
  await mockApi(page, mock);
  await page.goto("/logout");
  await page.getByRole("button", { name: "确认退出登录" }).click();
  await expect(page.getByText("退出失败")).toBeVisible();

  mock.logoutFails = false;
  await page.getByRole("button", { name: "重试退出" }).click();
  await expect(page.getByText("已退出登录")).toBeVisible();
  expect(mock.logoutCalls).toBe(2);
});

test("the logout guide page tells guests there is nothing to sign out of", async ({
  page,
}) => {
  const mock = state();
  await mockApi(page, mock);
  await page.goto("/logout");
  await expect(page.getByText("当前未登录")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认退出登录" }),
  ).toHaveCount(0);
  expect(mock.logoutCalls).toBe(0);
});

test("a 401 on a write clears the viewer state and shows the login guide", async ({
  page,
}) => {
  await mockApi(page, state({ authenticated: true, endorsement401: true }));
  await page.goto("/courses/8?teacher=9");
  await expect(page.getByRole("button", { name: "账号" })).toBeVisible();

  await page
    .getByRole("button", { name: "认可这条评价，还没有人认可" })
    .click();
  const prompt = page.getByRole("status").filter({ hasText: "后才能认可评价" });
  await expect(
    prompt.getByRole("link", { name: "使用普通用户登录" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "登录", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "账号", exact: true }),
  ).toHaveCount(0);
});

test("session outage degrades to guest browsing without blocking pages", async ({
  page,
}) => {
  await mockApi(page, state({ sessionFails: true }));
  await page.goto("/courses/8?teacher=9");
  await expect(
    page.getByRole("heading", { name: "中国传统文化导论" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "登录" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "认可这条评价，还没有人认可" }),
  ).toBeEnabled();
});

test("account deletion requires acknowledgement and reports pending_deletion", async ({
  page,
}) => {
  const mock = state({ authenticated: true });
  await mockApi(page, mock);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "账号管理" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "删除账号" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("已批准的任课评价匿名保留", { exact: false }),
  ).toBeVisible();

  const confirm = dialog.getByRole("button", { name: "确认删除账号" });
  await expect(confirm).toBeDisabled();
  // The native input is visually hidden; click its label text instead.
  await dialog.getByText("我已了解以上后果").click();
  await expect(
    dialog.getByRole("checkbox", { name: "我已了解以上后果" }),
  ).toBeChecked();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText("账号已进入删除流程")).toBeVisible();
  await expect(
    page.getByText("30 天恢复期", { exact: false }).first(),
  ).toBeVisible();
  expect(mock.deleteCalls).toBe(1);
  await expect(page.getByRole("link", { name: "登录" })).toBeVisible();
});

test("account deletion can be cancelled without any request", async ({
  page,
}) => {
  const mock = state({ authenticated: true });
  await mockApi(page, mock);
  await page.goto("/account");
  await page.getByRole("button", { name: "删除账号" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.deleteCalls).toBe(0);
  await expect(
    page.getByRole("button", { name: "账号", exact: true }),
  ).toBeVisible();
});

test("account page guides guests to login instead of showing account data", async ({
  page,
}) => {
  await mockApi(page, state());
  await page.goto("/account");
  await expect(page.getByText("当前未登录")).toBeVisible();
  await page.getByRole("link", { name: "前往登录" }).click();
  await expect(page).toHaveURL(/\/login\?from=%2Faccount$/);
});

test("keyboard reaches the account menu, logout, and the deletion confirm", async ({
  page,
}) => {
  const mock = state({ authenticated: true });
  await mockApi(page, mock);
  await page.goto("/courses");

  const account = page.getByRole("button", { name: "账号" });
  await account.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Keyboard open focuses the first item; one ArrowDown reaches 退出登录.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/logout$/);
  const confirmLogout = page.getByRole("button", { name: "确认退出登录" });
  await confirmLogout.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("已退出登录")).toBeVisible();

  mock.authenticated = true;
  await page.goto("/account");
  await page.getByRole("button", { name: "删除账号" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("checkbox", { name: "我已了解以上后果" })
    .focus();
  await page.keyboard.press("Space");
  const confirm = dialog.getByRole("button", { name: "确认删除账号" });
  await expect(confirm).toBeEnabled();
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("账号已进入删除流程")).toBeVisible();
  expect(mock.deleteCalls).toBe(1);
});
