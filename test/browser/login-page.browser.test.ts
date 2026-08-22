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

test("direct visit shows the CAS form and a way back to the catalog", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "普通用户登录" })).toBeVisible();
  await expect(page.getByLabel("学号")).toBeVisible();
  await expect(page.getByLabel("校园密码")).toBeVisible();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "使用校学生邮箱验证" })).toHaveCount(0);
  await expect(page.getByText("也可以改用校学生邮箱验证")).toHaveCount(0);
  await expect(page.getByText("校园 JWT 登录尚未开放")).toHaveCount(0);

  const back = page.getByRole("link", { name: "返回继续浏览" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/courses$/);
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

test("returns to the internal source page given by from", async ({ page }) => {
  await page.goto("/login?from=/courses/8");
  const back = page.getByRole("link", { name: "返回继续浏览" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/courses\/8$/);
  await expect(
    page.getByRole("heading", { name: "中国传统文化导论" }),
  ).toBeVisible();
});

test("external or looping from values fall back to the catalog", async ({
  page,
}) => {
  const back = page.getByRole("link", { name: "返回继续浏览" });

  await page.goto("/login?from=https://evil.example/phish");
  await expect(back).toHaveAttribute("href", "/courses");

  await page.goto("/login?from=//evil.example");
  await expect(back).toHaveAttribute("href", "/courses");

  await page.goto("/login?from=/login");
  await expect(back).toHaveAttribute("href", "/courses");

  await page.goto("/login?from=/login/");
  await expect(back).toHaveAttribute("href", "/courses");
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
  await expect(page.getByRole("heading", { name: "普通用户登录" })).toBeVisible();

  await page.getByRole("link", { name: "返回继续浏览" }).click();
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9$/);
  await expect(
    page.getByRole("button", { name: "认可这条评价，还没有人认可" }),
  ).toBeVisible();
});
