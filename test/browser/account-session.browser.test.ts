/**
 * Browser coverage for ordinary-user session, logout and account-to-profile
 * routing (issue #139 / #325). `/api/user/session` is the only viewer-state source.
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
    if (url.pathname === "/api/user/profile")
      return fulfillJson(route, { reviews: [], follows: [], review_count: 0, follow_count: 0 });
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

test("guest nav shows a login link into the CAS form", async ({
  page,
}) => {
  await mockApi(page, state());
  await page.goto("/courses");
  const login = page.getByRole("link", { name: "登录" });
  await expect(login).toBeVisible();
  await expect(page.getByText("登录未开放")).toHaveCount(0);
  await login.click();
  await expect(page).toHaveURL(/\/login\?from=%2Fcourses$/);
  await expect(page.getByRole("heading", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByLabel("学号")).toBeVisible();
  await expect(page.getByLabel("校园密码")).toBeVisible();
  await expect(page.getByRole("button", { name: "使用校学生邮箱验证" })).toHaveCount(
    0,
  );
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
  await expect(page.getByRole("button", { name: "发送验证信" })).toHaveCount(0);
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
  await expect(page.getByRole("link", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByText("登录未开放")).toHaveCount(0);

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
  await mockApi(
    page,
    state({ authenticated: true, endorsement401: true, campusEnabled: true }),
  );
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
  await expect(page.getByText("登录未开放")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "认可这条评价，还没有人认可" }),
  ).toBeEnabled();
});

test("signed-in account page goes to the personal homepage", async ({
  page,
}) => {
  await mockApi(page, state({ authenticated: true }));
  await page.goto("/account");
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("button", { name: "删除账号" })).toHaveCount(0);
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

test("keyboard reaches the account menu and logout confirm", async ({
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
  // Keyboard open focuses the first item (我的主页); 消息 / 账号管理 follow,
  // so three ArrowDowns reach 退出登录.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/logout$/);
  const confirmLogout = page.getByRole("button", { name: "确认退出登录" });
  await confirmLogout.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("已退出登录")).toBeVisible();
});
