import { expect, test, type Page } from "@playwright/test";
import { TIER3_QUESTIONS } from "../review-score-fixtures";

const VALID_NOTE = "老师讲课很清楚，收获很大，推荐给学弟学妹。";

const majorCourse = {
  id: 8,
  code: "GEN0108",
  name: "中国传统文化导论",
  category: "general",
  department: "人文学院",
  teachers: "测试教师",
  schemeKey: "major",
  schemeVersion: 2,
  tags: [] as string[],
  applicableQuestions: TIER3_QUESTIONS,
};

const moocCourse = {
  id: 21,
  code: "MOOC0101",
  name: "思政网课",
  category: "general",
  department: "马克思主义学院",
  teachers: "网课教师",
  schemeKey: "major",
  schemeVersion: 2,
  tags: ["mooc"],
  applicableQuestions: TIER3_QUESTIONS,
};

const peCourse = {
  id: 31,
  code: "PE0031",
  name: "大学体育（篮球）",
  category: "sports",
  department: "体育学院",
  teachers: "体育教师",
  schemeKey: "pe",
  schemeVersion: 2,
  tags: [] as string[],
  applicableQuestions: TIER3_QUESTIONS,
};

async function mockSubmitApi(
  page: Page,
  options: { campusEnabled?: boolean; authenticated?: boolean } = {},
) {
  const posted: Record<string, unknown>[] = [];
  const authenticated = options.authenticated ?? true;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学" },
      });
    if (url.pathname === "/api/user/session")
      return route.fulfill({
        json: {
          authenticated,
          csrfToken: authenticated ? "csrf-submit" : undefined,
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    if (url.pathname === "/api/auth/campus")
      return route.fulfill({
        json: { enabled: Boolean(options.campusEnabled) },
      });
    if (url.pathname === "/api/courses" || url.pathname === "/api/teachers")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    if (url.pathname === "/api/courses/options") {
      const q = url.searchParams.get("q") || "";
      const items = [majorCourse, moocCourse, peCourse].filter(
        (course) =>
          !q || course.name.includes(q) || course.code.includes(q),
      );
      return route.fulfill({
        json: { items, page: 1, pageSize: 20, total: items.length, pages: 1 },
      });
    }
    if (url.pathname === "/api/courses/8")
      return route.fulfill({
        json: {
          course: {
            ...majorCourse,
            teachers: [
              { id: 9, name: "测试教师", department: "人文学院", title: "讲师" },
            ],
          },
          reviewCount: 0,
        },
      });
    if (url.pathname === "/api/courses/21")
      return route.fulfill({
        json: {
          course: {
            ...moocCourse,
            teachers: [
              { id: 22, name: "网课教师", department: "马克思主义学院", title: "讲师" },
            ],
          },
          reviewCount: 0,
        },
      });
    if (url.pathname === "/api/courses/31")
      return route.fulfill({
        json: {
          course: {
            ...peCourse,
            teachers: [
              { id: 32, name: "体育教师", department: "体育学院", title: "讲师" },
            ],
          },
          reviewCount: 0,
        },
      });
    if (url.pathname === "/api/reviews" && route.request().method() === "POST") {
      posted.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { ok: true, message: "评价已发布" } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  return posted;
}

async function passGate(page: Page) {
  const start = page.getByRole("button", { name: "开始填写" });
  await expect(start).toBeVisible();
  await start.click();
}

async function chooseCourse(page: Page, query: string, name: string) {
  const combo = page.getByRole("combobox", { name: "课程" });
  await combo.click();
  await combo.fill(query);
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

async function pickScore(page: Page, label: string, value: string) {
  const group = page.getByRole("radiogroup", { name: label });
  await group.getByText(value, { exact: true }).click();
  await expect(
    group.getByRole("radio", { name: value, exact: true }),
  ).toBeChecked();
}

async function pickTeacher(page: Page, name: string) {
  await page.getByRole("button", { name: /任课教师/ }).click();
  await page.getByRole("option", { name }).click();
}

async function fillNote(page: Page, note: string) {
  await page.getByRole("textbox", { name: "补充说明" }).fill(note);
}

/** 四维 + 推荐度全部作答，补充说明用默认合格文案。 */
async function answerEverything(page: Page) {
  await pickScore(page, "课程难度", "简单");
  await pickScore(page, "作业多少", "中等");
  await pickScore(page, "给分好坏", "杀手");
  await pickScore(page, "收获多少", "一般");
  await pickScore(page, "本次推荐度", "5");
  await fillNote(page, VALID_NOTE);
}

/** 专业课/体育课/网课都应看到的同一套四道三档题（中文档位）。 */
async function expectTier3Questions(page: Page) {
  const difficulty = page.getByRole("radiogroup", { name: "课程难度" });
  await expect(difficulty).toBeVisible();
  await expect(
    difficulty.getByRole("radio", { name: "简单", exact: true }),
  ).toBeVisible();
  await expect(
    difficulty.getByRole("radio", { name: "中等", exact: true }),
  ).toBeVisible();
  await expect(
    difficulty.getByRole("radio", { name: "困难", exact: true }),
  ).toBeVisible();
  // 三档题显示中文文案，不显示成 1/2/3 分。
  await expect(
    difficulty.getByRole("radio", { name: "1", exact: true }),
  ).toHaveCount(0);

  const homework = page.getByRole("radiogroup", { name: "作业多少" });
  await expect(homework.getByRole("radio", { name: "不多", exact: true })).toBeVisible();
  await expect(homework.getByRole("radio", { name: "超多", exact: true })).toBeVisible();

  const grading = page.getByRole("radiogroup", { name: "给分好坏" });
  await expect(grading.getByRole("radio", { name: "超好", exact: true })).toBeVisible();
  await expect(grading.getByRole("radio", { name: "杀手", exact: true })).toBeVisible();

  const gain = page.getByRole("radiogroup", { name: "收获多少" });
  await expect(gain.getByRole("radio", { name: "很多", exact: true })).toBeVisible();
  await expect(gain.getByRole("radio", { name: "没有", exact: true })).toBeVisible();

  await expect(page.getByRole("radiogroup", { name: "本次推荐度" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "点名频率" })).toHaveCount(0);
  await expect(page.getByText(/仅线下适用/)).toHaveCount(0);
}

test("site nav always shows write-review and guests are sent to login", async ({
  page,
}) => {
  await mockSubmitApi(page, { authenticated: false });
  await page.goto("/courses");
  const submitLink = page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "写评价", exact: true });
  await expect(submitLink).toBeVisible();
  await expect(submitLink.getByText("需要登录")).toHaveCount(0);
  await submitLink.click();
  await expect(page).toHaveURL(/\/login\?from=%2Fsubmit$/);
  await expect(page.getByRole("heading", { name: "普通用户登录" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByText("评价已发布")).toHaveCount(0);
});

test("logged-out /submit redirects to login with a sanitized from return", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page, { authenticated: false });
  await page.goto("/submit?courseId=8");
  await expect(page).toHaveURL(/\/login\?from=/);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("from")).toBe("/submit?courseId=8");
  await expect(page.getByRole("heading", { name: "普通用户登录" })).toBeVisible();
  await expect(page.getByText("评价已发布")).toHaveCount(0);
  expect(posted).toHaveLength(0);
});

test("gate comes first and the full form appears after entry", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");

  const start = page.getByRole("button", { name: "开始填写" });
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
  await expect(page.getByText(/评价必须绑定已有任课关系/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "课程" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "提交评价" })).toHaveCount(0);

  await start.click();

  await expect(start).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "课程" })).toBeVisible();
  const teacherSelect = page.getByRole("button", { name: /任课教师/ });
  await expect(teacherSelect).toBeVisible();
  await expect(teacherSelect).toBeDisabled();
  await expectTier3Questions(page);
  await expect(page.getByRole("textbox", { name: "补充说明" })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交评价" })).toBeVisible();

  await chooseCourse(page, "文化", "中国传统文化导论");
  await expect(teacherSelect).toBeEnabled();
  expect(posted).toHaveLength(0);
});

test("deep link prefills course and teacher after the gate", async ({
  page,
}) => {
  await mockSubmitApi(page);
  await page.goto("/submit?courseId=8&teacherId=9");
  await expect(page.getByRole("combobox", { name: "课程" })).toHaveCount(0);

  await passGate(page);

  await expect(page.getByRole("combobox", { name: "课程" })).toHaveValue(
    "中国传统文化导论",
  );
  await expect(
    page.getByRole("button", { name: /任课教师/ }),
  ).toContainText("测试教师");
});

test("full four tiers plus overall and note submit the required payload", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await expectTier3Questions(page);

  await answerEverything(page);
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByRole("status")).toHaveText("评价已发布");
  expect(posted).toEqual([
    {
      courseId: 8,
      teacherId: 9,
      overall: 5,
      scores: { difficulty: 1, homework: 2, grading: 3, gain: 2 },
      comment: VALID_NOTE,
      website: "",
      turnstileToken: "",
    },
  ]);
  // 载荷不含旧维度键。
  expect(posted[0].scores).not.toHaveProperty("teaching");
  expect(posted[0].scores).not.toHaveProperty("attendance");
  expect(posted[0].scores).not.toHaveProperty("workload");

  await expect(page.getByRole("button", { name: "开始填写" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "课程" })).toHaveCount(0);
  await passGate(page);
  await expect(page.getByRole("combobox", { name: "课程" })).toHaveValue("");
  await expect(
    page
      .getByRole("radiogroup", { name: "课程难度" })
      .getByRole("radio", { checked: true }),
  ).toHaveCount(0);
});

test("an unanswered dimension blocks submit until it is picked", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");

  await pickScore(page, "课程难度", "困难");
  await pickScore(page, "作业多少", "不多");
  await pickScore(page, "给分好坏", "超好");
  await pickScore(page, "本次推荐度", "4");
  await fillNote(page, VALID_NOTE);
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByText("请选择收获多少")).toBeVisible();
  expect(posted).toHaveLength(0);

  await pickScore(page, "收获多少", "很多");
  await expect(page.getByText("请选择收获多少")).toHaveCount(0);
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByRole("status")).toHaveText("评价已发布");
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    scores: { difficulty: 3, homework: 1, grading: 1, gain: 1 },
    overall: 4,
  });
});

test("a note shorter than 10 chars after trim blocks submit", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");

  await pickScore(page, "课程难度", "中等");
  await pickScore(page, "作业多少", "超多");
  await pickScore(page, "给分好坏", "一般");
  await pickScore(page, "收获多少", "没有");
  await pickScore(page, "本次推荐度", "3");
  // 去掉首尾空白后只有 9 字，达不到必填下限。
  await fillNote(page, "  123456789  ");
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByText("请填写至少 10 字补充说明")).toBeVisible();
  expect(posted).toHaveLength(0);

  await fillNote(page, VALID_NOTE);
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByRole("status")).toHaveText("评价已发布");
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ comment: VALID_NOTE });
});

test("mooc course keeps the same four tiers without offline-only hints", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
  await chooseCourse(page, "思政", "思政网课");
  await expectTier3Questions(page);

  await pickTeacher(page, "网课教师");
  await answerEverything(page);
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByRole("status")).toHaveText("评价已发布");
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    courseId: 21,
    teacherId: 22,
    scores: { difficulty: 1, homework: 2, grading: 3, gain: 2 },
  });
});

test("pe course shows the same four three-tier questions as major", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
  await chooseCourse(page, "体育", "大学体育");
  await expectTier3Questions(page);
  await expect(
    page.getByRole("button", { name: /任课教师/ }),
  ).toBeEnabled();
  expect(posted).toHaveLength(0);
});
