import { expect, test, type Page } from "@playwright/test";

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

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
      });
    if (url.pathname === "/api/auth/campus")
      return route.fulfill({
        json: {
          enabled: false,
          reason: "not_whitelisted",
          loginPath: "/login",
          logoutPath: "/logout",
          callbackPath: "/api/auth/callback",
        },
      });
    if (url.pathname === "/api/user/session")
      return route.fulfill({
        json: {
          authenticated: false,
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    if (url.pathname === "/api/auth/cas")
      return route.fulfill({
        json: {
          authenticated: true,
          csrfToken: "csrf-user",
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    if (url.pathname === "/api/auth/cas/mfa")
      return route.fulfill({
        json: {
          authenticated: true,
          csrfToken: "csrf-user",
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    if (url.pathname === "/api/auth/email")
      return route.fulfill({ json: { ok: true } });
    if (url.pathname === "/api/auth/verify")
      return route.fulfill({
        json: {
          authenticated: true,
          csrfToken: "csrf-user",
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    if (url.pathname === "/api/courses")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    if (url.pathname === "/api/courses/8")
      return route.fulfill({
        json: {
          course: {
            id: 8,
            code: "GEN0108",
            name: "中国传统文化导论",
            category: "general",
            department: "人文学院",
            teachers: [{ id: 9, name: "测试教师", review_count: 1 }],
          },
          reviewCount: 1,
        },
      });
    if (url.pathname === "/api/courses/8/reviews")
      return route.fulfill({
        json: { items: [ENDORSABLE_REVIEW], nextCursor: null },
      });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test.beforeEach(async ({ page }) => mockApi(page));

test("direct visit shows the CAS form without extra copy or a back link", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByLabel("学号")).toBeVisible();
  await expect(page.getByLabel("校园密码")).toBeVisible();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "使用校学生邮箱验证" })).toHaveCount(0);
  await expect(page.getByText("也可以改用校学生邮箱验证")).toHaveCount(0);
  await expect(page.getByText("校园 JWT 登录尚未开放")).toHaveCount(0);
  await expect(page.getByText("大多数访问者是游客")).toHaveCount(0);
  await expect(page.getByText("本站不保存校园口令")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回继续浏览" })).toHaveCount(0);
});

test("hides the school-email login entry on the ordinary-user card", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "使用校学生邮箱验证" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("textbox", { name: /校学生邮箱/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送验证信" })).toHaveCount(0);
});

test("MFA step drops a leftover password error and names 企业微信", async ({
  page,
}) => {
  let casCount = 0;
  let mfaPayload = "";
  await page.route("**/api/auth/cas", async (route) => {
    casCount += 1;
    if (casCount === 1) {
      return route.fulfill({
        status: 401,
        json: { error: "学号或密码不正确" },
      });
    }
    return route.fulfill({
      json: {
        needsMfa: true,
        challenge: "ab".repeat(16),
        maskedPhone: "135****5634",
      },
    });
  });
  await page.route("**/api/auth/cas/mfa", async (route) => {
    mfaPayload = route.request().postData() || "";
    return route.fulfill({
      json: {
        authenticated: true,
        csrfToken: "csrf-user",
        loginPath: "/login",
        logoutPath: "/logout",
      },
    });
  });

  await page.goto("/login");
  await page.getByLabel("学号").fill("2202100001");
  await page.getByLabel("校园密码").fill("secret-pass");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("学号或密码不正确")).toBeVisible();

  await page.getByLabel("校园密码").fill("secret-pass");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("学号或密码不正确")).toHaveCount(0);
  await expect(page.getByText("请输入验证码")).toBeVisible();
  await expect(page.getByText(/企业微信/)).toBeVisible();
  await expect(page.getByText(/不是本站短信/)).toBeVisible();
  await expect(page.getByText("短信验证码")).toHaveCount(0);
  await expect(page.getByText("验证码已发送到")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "使用校学生邮箱验证" })).toHaveCount(
    0,
  );

  await page.getByLabel("验证码").fill("8765");
  await page.getByRole("button", { name: "完成登录" }).click();
  await expect(page).toHaveURL(/\/courses$/);
  expect(mfaPayload).toContain("8765");
});

test("post-OTP password failure returns to the credential form", async ({
  page,
}) => {
  await page.route("**/api/auth/cas", async (route) => {
    return route.fulfill({
      json: {
        needsMfa: true,
        challenge: "cd".repeat(16),
        maskedPhone: "135****5634",
      },
    });
  });
  await page.route("**/api/auth/cas/mfa", async (route) => {
    return route.fulfill({
      status: 401,
      json: {
        error: "验证码已核销，但学号或密码未通过。请确认后重新登录。",
      },
    });
  });

  await page.goto("/login");
  await page.getByLabel("学号").fill("2202100001");
  await page.getByLabel("校园密码").fill("secret-pass");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByLabel("验证码").fill("8765");
  await page.getByRole("button", { name: "完成登录" }).click();
  await expect(page.getByLabel("学号")).toBeVisible();
  await expect(page.getByLabel("校园密码")).toBeVisible();
  await expect(page.getByText("请确认后重新登录")).toBeVisible();
  await expect(page.getByLabel("验证码")).toHaveCount(0);
});

test("submitting campus credentials shows the CAS login control", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("学号").fill("2202100001");
  await page.getByLabel("校园密码").fill("secret-pass");
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
});

test("session bootstrap shows a loading status before the form", async ({
  page,
}) => {
  let releaseSession!: () => void;
  const sessionHeld = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await page.route("**/api/user/session", async (route) => {
    await sessionHeld;
    return route.fulfill({
      json: {
        authenticated: false,
        loginPath: "/login",
        logoutPath: "/logout",
      },
    });
  });

  await page.goto("/login");
  await expect(page.getByText("正在读取登录状态…")).toBeVisible();
  await expect(page.getByLabel("学号")).toHaveCount(0);
  releaseSession();
  await expect(page.getByLabel("学号")).toBeVisible();
});

test("CAS submit shows a pending alert and button while waiting", async ({
  page,
}) => {
  let releaseCas!: () => void;
  const casHeld = new Promise<void>((resolve) => {
    releaseCas = resolve;
  });
  await page.route("**/api/auth/cas", async (route) => {
    await casHeld;
    return route.fulfill({
      json: {
        authenticated: true,
        csrfToken: "csrf-user",
        loginPath: "/login",
        logoutPath: "/logout",
      },
    });
  });

  await page.goto("/login");
  await page.getByLabel("学号").fill("2202100001");
  await page.getByLabel("校园密码").fill("secret-pass");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByText("正在登录", { exact: true })).toBeVisible();
  await expect(page.getByText("请稍候，通常需要几秒。")).toBeVisible();
  await expect(page.getByRole("button", { name: "正在登录…" })).toBeVisible();
  await expect(page.getByLabel("学号")).toBeDisabled();
  await expect(page.getByLabel("校园密码")).toBeDisabled();

  releaseCas();
  await expect(page).toHaveURL(/\/courses$/);
});

test("MFA submit shows a pending alert while the code is checked", async ({
  page,
}) => {
  let releaseMfa!: () => void;
  const mfaHeld = new Promise<void>((resolve) => {
    releaseMfa = resolve;
  });
  await page.route("**/api/auth/cas", async (route) => {
    return route.fulfill({
      json: {
        needsMfa: true,
        challenge: "ef".repeat(16),
        maskedPhone: "135****5634",
      },
    });
  });
  await page.route("**/api/auth/cas/mfa", async (route) => {
    await mfaHeld;
    return route.fulfill({
      json: {
        authenticated: true,
        csrfToken: "csrf-user",
        loginPath: "/login",
        logoutPath: "/logout",
      },
    });
  });

  await page.goto("/login");
  await page.getByLabel("学号").fill("2202100001");
  await page.getByLabel("校园密码").fill("secret-pass");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByLabel("验证码").fill("8765");
  await page.getByRole("button", { name: "完成登录" }).click();

  await expect(page.getByText("正在确认验证码")).toBeVisible();
  await expect(page.getByText("请稍候。")).toBeVisible();
  await expect(page.getByRole("button", { name: "正在完成登录…" })).toBeVisible();
  await expect(page.getByLabel("验证码")).toBeDisabled();

  releaseMfa();
  await expect(page).toHaveURL(/\/courses$/);
});

test("school CAS tips appear on the login card", async ({ page }) => {
  await page.route("**/api/auth/cas", async (route) => {
    return route.fulfill({
      status: 401,
      json: { error: "账号已被锁定，请稍后再试" },
    });
  });

  await page.goto("/login");
  await page.getByLabel("学号").fill("2202100001");
  await page.getByLabel("校园密码").fill("secret-pass");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByText("账号暂时无法登录")).toBeVisible();
  await expect(page.getByText("账号已被锁定，请稍后再试")).toBeVisible();
  await expect(page.getByLabel("学号")).toBeVisible();
});

test("email magic-link redeeming uses the official progress alert", async ({
  page,
}) => {
  let releaseVerify!: () => void;
  const verifyHeld = new Promise<void>((resolve) => {
    releaseVerify = resolve;
  });
  await page.route("**/api/auth/verify", async (route) => {
    await verifyHeld;
    return route.fulfill({
      json: {
        authenticated: true,
        csrfToken: "csrf-user",
        loginPath: "/login",
        logoutPath: "/logout",
      },
    });
  });

  await page.goto("/login?token=magic-link-token");
  await expect(page.getByText("正在完成登录")).toBeVisible();
  await expect(page.getByText("请稍候。")).toBeVisible();
  await expect(page.getByLabel("学号")).toHaveCount(0);

  releaseVerify();
  await expect(page).toHaveURL(/\/courses$/);
});

async function submitCampusLogin(page: Page) {
  await page.getByLabel("学号").fill("2202100001");
  await page.getByLabel("校园密码").fill("secret-pass");
  await page.getByRole("button", { name: "登录" }).click();
}

test("returns to the internal source page given by from", async ({ page }) => {
  await page.goto("/login?from=/courses/8");
  await submitCampusLogin(page);
  await expect(page).toHaveURL(/\/courses\/8$/);
  await expect(
    page.getByRole("heading", { name: "中国传统文化导论" }),
  ).toBeVisible();
});

test("external or looping from values fall back to the catalog", async ({
  page,
}) => {
  await page.goto("/login?from=https://evil.example/phish");
  await submitCampusLogin(page);
  await expect(page).toHaveURL(/\/courses$/);

  await page.goto("/login?from=//evil.example");
  await submitCampusLogin(page);
  await expect(page).toHaveURL(/\/courses$/);

  await page.goto("/login?from=/login");
  await submitCampusLogin(page);
  await expect(page).toHaveURL(/\/courses$/);

  await page.goto("/login?from=/login/");
  await submitCampusLogin(page);
  await expect(page).toHaveURL(/\/courses$/);
});

test("guest recognition prompt reaches login and returns to the source page", async ({
  page,
}) => {
  await page.goto("/courses/8?teacher=9");
  await page
    .getByRole("button", { name: "认可这条评价，还没有人认可" })
    .click();

  const loginLink = page.getByRole("link", { name: "使用普通用户登录" });
  await expect(loginLink).toBeVisible();
  await loginLink.click();
  await expect(page).toHaveURL(/\/login\?from=%2Fcourses%2F8%3Fteacher%3D9$/);
  await expect(page.getByRole("heading", { name: "登录", exact: true })).toBeVisible();

  await submitCampusLogin(page);
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(
    page.getByRole("button", { name: "认可这条评价，还没有人认可" }),
  ).toBeVisible();
});
