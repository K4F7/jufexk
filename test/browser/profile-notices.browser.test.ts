/**
 * Browser coverage for /profile 个人主页 and /notices 全部消息
 * (frontend for issues #459 / #460). Backend endpoints are mocked; the pages
 * must degrade to a normal load-error alert when they 404.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

type MockState = {
  authenticated: boolean;
  profile: unknown;
  profileStatus: number;
  avatarFailsRemaining: number;
  avatarError: string;
  notifications: unknown;
  notificationsStatus: number;
  unreadCount: number | null;
  readCalls: number;
};

function state(overrides: Partial<MockState> = {}): MockState {
  return {
    authenticated: true,
    profile: {
      public_code: 1,
      handle: "匿名用户#000001",
      avatar_key: 0,
      reviews: [
        {
          id: 101,
          course_id: 8,
          course_name: "中国传统文化导论",
          teacher_id: 9,
          teacher_name: "测试教师",
          term: "2026 春",
          headline: "收获很大的一门课",
          comment: "这是一条足够长的补充说明摘要，用于个人主页展示。",
          created_at: "2026-08-01 02:00:00",
          status: "approved",
        },
        {
          id: 102,
          course_id: 10,
          course_name: "高等数学",
          teacher_id: 11,
          teacher_name: "数学老师",
          term: "2025 秋",
          headline: "",
          comment: "等待审核的点评摘要。",
          created_at: "2026-08-20 02:00:00",
          status: "pending",
        },
      ],
      follows: [
        {
          course_id: 8,
          course_name: "中国传统文化导论",
          teacher_id: 9,
          teacher_name: "测试教师",
        },
      ],
      review_count: 2,
      follow_count: 1,
    },
    profileStatus: 200,
    avatarFailsRemaining: 0,
    avatarError: "头像保存失败",
    notifications: [
      {
        id: "n1",
        type: "relation_review",
        text: "你关注的「中国传统文化导论」有了新点评",
        href: "/courses/8?teacher=9",
        created_at: "2026-08-21 10:00:00",
        read: false,
      },
      {
        id: "n2",
        type: "review_endorsed",
        text: "你的点评获得了一次认可",
        href: "/courses/8?teacher=9",
        created_at: "2026-08-20 08:00:00",
        read: true,
      },
    ],
    notificationsStatus: 200,
    unreadCount: 2,
    readCalls: 0,
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
    if (url.pathname === "/api/user/session")
      return fulfillJson(route, {
        authenticated: mock.authenticated,
        csrfToken: mock.authenticated ? "csrf-user" : undefined,
        loginPath: "/login",
        logoutPath: "/logout",
      });
    if (url.pathname === "/api/auth/campus")
      return fulfillJson(route, {
        enabled: false,
        reason: "not_whitelisted",
        loginPath: "/login",
        logoutPath: "/logout",
        callbackPath: "/api/auth/callback",
      });
    if (url.pathname === "/api/user/profile")
      return fulfillJson(route, mock.profile, mock.profileStatus);
    if (url.pathname === "/api/user/profile/avatar") {
      if (mock.avatarFailsRemaining > 0) {
        mock.avatarFailsRemaining -= 1;
        return fulfillJson(route, { error: mock.avatarError }, 500);
      }
      const profile = mock.profile as {
        avatar_key?: number;
        public_code?: number;
        handle?: string;
      };
      return fulfillJson(route, {
        ok: true,
        avatar_key: 2,
        public_code: profile.public_code,
        handle: profile.handle,
      });
    }
    if (url.pathname === "/api/user/notifications" && request.method() === "GET")
      return fulfillJson(route, mock.notifications, mock.notificationsStatus);
    if (
      url.pathname === "/api/user/notifications/read" &&
      request.method() === "POST"
    ) {
      mock.readCalls += 1;
      return fulfillJson(route, { ok: true });
    }
    if (url.pathname === "/api/user/notifications/unread-count") {
      if (mock.unreadCount === null)
        return fulfillJson(route, { error: "not mocked" }, 404);
      return fulfillJson(route, { count: mock.unreadCount });
    }
    if (url.pathname === "/api/courses")
      return fulfillJson(route, {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
        pages: 1,
      });
    return fulfillJson(route, { error: "not mocked" }, 404);
  });
}

test("guests are redirected from /notices and /profile to login", async ({
  page,
}) => {
  await mockApi(page, state({ authenticated: false, unreadCount: null }));

  await page.goto("/notices");
  await expect(page).toHaveURL(/\/login\?from=%2Fnotices$/);
  await expect(
    page.getByRole("heading", { name: "登录", exact: true }),
  ).toBeVisible();

  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?from=%2Fprofile$/);
  await expect(
    page.getByRole("heading", { name: "登录", exact: true }),
  ).toBeVisible();
});

test("profile page renders own reviews, follows and stats", async ({
  page,
}) => {
  await mockApi(page, state());
  await page.goto("/profile");

  await expect(
    page.getByRole("heading", { name: "点评（2 门）" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "关注（1 门）" }),
  ).toBeVisible();

  const approved = page.getByRole("link", {
    name: "中国传统文化导论（测试教师）",
  });
  await expect(approved.first()).toHaveAttribute(
    "href",
    "/courses/8?teacher=9",
  );
  await expect(page.getByText("收获很大的一门课")).toBeVisible();
  await expect(page.getByText("2026-08-01")).toBeVisible();

  // 未过审点评带状态 Chip。
  await expect(page.getByText("待审核", { exact: true })).toBeVisible();
  await expect(page.getByText("等待审核的点评摘要。")).toBeVisible();

  // 侧栏公开编号与官方头像；不出现邮箱、学号等标识，也不再导向账号删除。
  await expect(
    page.getByRole("heading", { name: "匿名用户#000001" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "选择官方头像 1" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "更换官方头像" }).click();
  await expect(
    page.getByRole("heading", { name: "选择官方头像" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("radio", { name: "选择官方头像 1" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "选择官方头像 3" }).click();
  await expect(
    page.getByRole("radio", { name: "选择官方头像 3" }),
  ).toHaveCount(0);
  const profileCard = page.getByRole("article", { name: "匿名用户#000001" });
  await expect(profileCard.getByText("点评", { exact: true })).toBeVisible();
  await expect(profileCard.getByText("2 门", { exact: true })).toBeVisible();
  await expect(profileCard.getByText("关注", { exact: true })).toBeVisible();
  await expect(profileCard.getByText("1 门", { exact: true })).toBeVisible();
  await expect(
    page.getByText("公开编号只用于识别作者，不是学号或内部身份。"),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "账号管理" })).toHaveCount(0);
});

test("profile page degrades gracefully when the API is missing", async ({
  page,
}) => {
  await mockApi(
    page,
    state({ profile: { error: "not found" }, profileStatus: 404 }),
  );
  await page.goto("/profile");

  await expect(page.getByText("个人主页暂时加载不了")).toBeVisible();
  await expect(page.getByText("请稍后再试。")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "我的主页" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "我的主页" }).getByText("— 门", { exact: true }).first(),
  ).toBeVisible();
});

test("avatar save failure shows a retryable alert", async ({
  page,
}) => {
  await mockApi(page, state({ avatarFailsRemaining: 1 }));
  await page.goto("/profile");

  await page.getByRole("button", { name: "更换官方头像" }).click();
  await page.getByRole("radio", { name: "选择官方头像 3" }).click();
  await expect(page.getByText("头像未能保存")).toBeVisible();
  await expect(page.getByText("头像保存失败")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "更换官方头像" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("头像未能保存")).toHaveCount(0);
});

test("notices page lists messages and marks all as read", async ({ page }) => {
  const mock = state();
  await mockApi(page, mock);
  await page.goto("/notices");

  await expect(
    page.getByRole("heading", { name: "全部消息" }),
  ).toBeVisible();
  const first = page.getByRole("link", {
    name: "你关注的「中国传统文化导论」有了新点评",
  });
  await expect(first).toHaveAttribute("href", "/courses/8?teacher=9");
  await expect(page.getByText("你的点评获得了一次认可")).toBeVisible();
  await expect(page.getByText("2026-08-21")).toBeVisible();
  // 未读消息带「新」Chip。
  await expect(page.getByText("新", { exact: true })).toBeVisible();

  // 打开页面即调用标记已读，顶栏未读角标清零。
  await expect.poll(() => mock.readCalls).toBe(1);
  await expect(page.getByLabel("2 条未读消息")).toHaveCount(0);
});

test("notices page shows the empty state and survives a missing API", async ({
  page,
}) => {
  const mock = state({ notifications: [], unreadCount: null });
  await mockApi(page, mock);
  await page.goto("/notices");
  await expect(page.getByText("还没有消息哦！")).toBeVisible();
  await expect.poll(() => mock.readCalls).toBe(1);

  const missing = state({
    notifications: { error: "not found" },
    notificationsStatus: 404,
    unreadCount: null,
  });
  await mockApi(page, missing);
  await page.goto("/notices");
  await expect(page.getByText("消息暂时加载不了")).toBeVisible();
  await expect(page.getByText("请稍后再试。")).toBeVisible();
});

test("account menu links to 我的主页 and 消息 with an unread badge", async ({
  page,
}) => {
  await mockApi(page, state({ unreadCount: 3 }));
  await page.goto("/courses");

  await expect(page.getByLabel("3 条未读消息")).toBeVisible();
  await page.getByRole("button", { name: "账号" }).click();
  await expect(
    page.getByRole("menuitem", { name: "我的主页" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /消息/ }),
  ).toBeVisible();

  await page.getByRole("menuitem", { name: "我的主页" }).click();
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByRole("button", { name: "账号" }).click();
  await page.getByRole("menuitem", { name: /消息/ }).click();
  await expect(page).toHaveURL(/\/notices$/);
});

test("account menu hides the badge when unread-count is unavailable", async ({
  page,
}) => {
  await mockApi(page, state({ unreadCount: null }));
  await page.goto("/courses");

  await expect(page.getByRole("button", { name: "账号" })).toBeVisible();
  await expect(page.getByLabel(/条未读消息/)).toHaveCount(0);
  await page.getByRole("button", { name: "账号" }).click();
  await expect(
    page.getByRole("menuitem", { name: "消息", exact: true }),
  ).toBeVisible();
});
