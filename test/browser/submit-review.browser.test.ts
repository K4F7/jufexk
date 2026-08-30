import { expect, test, type Page } from "@playwright/test";
import { TIER3_QUESTIONS } from "../review-score-fixtures";

/**
 * 写评价（Issue #402 + #400 + #447）：入口只从课程页「写点评」；表单对齐 icourse ——
 * 课×师已知时用「点评 · 课名（教师）」卡片头；四道三档、
 * 1–5 半星推荐度（默认必填）、纯文本详细评价、选填数字成绩、可保存草稿；
 * 「只写点评不评分」问卷仍显示；勾选后清空并禁用评分，推荐度星星不位移。
 * 带 courseId 进入时等当前 scheme，不先画旧题。详细评价下有官方 Description 说明。
 * 从课程页带入的课/老师不再重选；投稿一律匿名。
 * 线下课与 mooc 同一套四道题；发布成功回到该 课程×教师 的详情页。一句话总结字段已下线。
 *
 * 三档题面与必填详细评价的行为断言承接 #374；编辑器覆盖承接 #400。
 */
const VALID_NOTE = "老师讲课很清楚，收获很大，推荐给学弟学妹。";
const LONG_COMMENT = "老师讲课条理清楚，期末范围给得准，跟着节奏走基本稳。";

const offlineCourse = {
  id: 8,
  code: "GEN0108",
  name: "中国传统文化导论",
  category: "general",
  department: "人文学院",
  teachers: "测试教师",
  schemeKey: "major",
  schemeVersion: 4,
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
  schemeKey: "ideology",
  schemeVersion: 4,
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
  schemeVersion: 4,
  tags: [] as string[],
  applicableQuestions: TIER3_QUESTIONS,
};

const courseDetail = {
  ...offlineCourse,
  teachers: [
    { id: 9, name: "测试教师", department: "人文学院", review_count: 0 },
  ],
};

async function mockSubmitApi(
  page: Page,
  options: { authenticated?: boolean } = {},
) {
  const posted: Record<string, unknown>[] = [];
  const authenticated = options.authenticated ?? true;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "非官方课评@JUFE", universityName: "江西财经大学" },
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
    if (url.pathname === "/api/courses" || url.pathname === "/api/teachers")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    if (url.pathname === "/api/courses/options") {
      const q = url.searchParams.get("q") || "";
      const items = [offlineCourse, moocCourse, peCourse].filter(
        (course) =>
          !q || course.name.includes(q) || course.code.includes(q),
      );
      return route.fulfill({
        json: { items, page: 1, pageSize: 20, total: items.length, pages: 1 },
      });
    }
    if (url.pathname === "/api/courses/8")
      return route.fulfill({
        json: { course: courseDetail, reviewCount: 0 },
      });
    if (url.pathname === "/api/courses/8/reviews") {
      // 发布即公开：详情页点评流回读已提交的条目（含 headline/grade 投影）。
      const items = posted.map((entry, index) => ({
        id: `review:new-${index}`,
        course_id: 8,
        teacher_id: 9,
        comment: entry.comment,
        comment_format: "html",
        headline: entry.headline ?? "",
        ...(entry.grade ? { grade: entry.grade } : {}),
        overall: entry.overall,
        created_at: "2026-08-24 06:00:00",
        endorsement_count: 0,
        endorsable: false,
      }));
      return route.fulfill({
        json: { items, nextCursor: null, total: items.length },
      });
    }
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
    if (url.pathname === "/api/teachers/9")
      return route.fulfill({
        json: {
          teacher: { id: 9, name: "测试教师", department: "人文学院", title: "讲师" },
          courses: [],
          reviews: [],
          reviewCount: 0,
          nextReviewCursor: null,
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

async function chooseCourse(page: Page, query: string, name: string) {
  const combo = page.getByRole("combobox", { name: "课程" });
  await combo.click();
  await combo.fill(query);
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

async function pickScore(page: Page, label: string, value: string) {
  // 三档题是 TagGroup selectionMode="single"：React Aria 暴露 grid + row。
  const group = page.getByRole("grid", { name: label });
  const tag = group.getByRole("row", { name: value, exact: true });
  await tag.click();
  await expect(tag).toHaveAttribute("aria-selected", "true");
}

async function pickTeacher(page: Page, name: string) {
  await page.getByRole("button", { name: /任课教师/ }).click();
  await page.getByRole("option", { name }).click();
}

/** 详细评价是 HeroUI TextArea（原生 multiline textbox）。 */
function noteEditor(page: Page) {
  return page.getByRole("textbox", { name: "详细评价" });
}

async function fillComment(page: Page, text: string) {
  await noteEditor(page).fill(text);
}

async function pickOverall(page: Page, value: string) {
  await page
    .getByRole("radiogroup", { name: "推荐度" })
    .getByRole("radio", { name: `${value} 星`, exact: true })
    .click({ force: true });
}

async function clickLabeledCheckbox(page: Page, name: string) {
  await page.getByRole("checkbox", { name, exact: true }).click();
}

async function answerTier3AndOverall(
  page: Page,
  overall: string,
) {
  await pickScore(page, "课程难度", "中等");
  await pickScore(page, "作业多少", "超多");
  await pickScore(page, "给分好坏", "一般");
  await pickScore(page, "收获多少", "没有");
  await pickOverall(page, overall);
}

/** 所有课都应看到的公共核四道三档题（中文档位，#374）。 */
async function expectTier3Questions(page: Page) {
  const difficulty = page.getByRole("grid", { name: "课程难度" });
  await expect(difficulty).toBeVisible();
  await expect(
    difficulty.getByRole("row", { name: "简单", exact: true }),
  ).toBeVisible();
  await expect(
    difficulty.getByRole("row", { name: "中等", exact: true }),
  ).toBeVisible();
  await expect(
    difficulty.getByRole("row", { name: "困难", exact: true }),
  ).toBeVisible();
  // 三档题显示中文文案，不显示成 1/2/3 分。
  await expect(
    difficulty.getByRole("row", { name: "1", exact: true }),
  ).toHaveCount(0);

  const homework = page.getByRole("grid", { name: "作业多少" });
  await expect(homework.getByRole("row", { name: "不多", exact: true })).toBeVisible();
  await expect(homework.getByRole("row", { name: "超多", exact: true })).toBeVisible();

  const grading = page.getByRole("grid", { name: "给分好坏" });
  await expect(grading.getByRole("row", { name: "超好", exact: true })).toBeVisible();
  await expect(grading.getByRole("row", { name: "杀手", exact: true })).toBeVisible();

  const gain = page.getByRole("grid", { name: "收获多少" });
  await expect(gain.getByRole("row", { name: "很多", exact: true })).toBeVisible();
  await expect(gain.getByRole("row", { name: "没有", exact: true })).toBeVisible();

  const overall = page.getByRole("radiogroup", { name: "推荐度" });
  await expect(overall).toBeVisible();
  await expect(
    overall.getByRole("radio", { name: "0.5 星", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "点名频率" })).toHaveCount(0);
  await expect(page.getByText("简单 / 中等 / 困难")).toHaveCount(0);
  await expect(page.getByText("不多 / 中等 / 超多")).toHaveCount(0);
  await expect(page.getByText("超好 / 一般 / 杀手")).toHaveCount(0);
  await expect(page.getByText("很多 / 一般 / 没有")).toHaveCount(0);
  await expect(page.getByText("1 到 5，分数越高表示越推荐")).toHaveCount(0);
}

/** 线下课与 mooc 同一套四道三档题，无「仅线下适用」提示。 */
async function expectOfflineQuestions(page: Page) {
  await expectTier3Questions(page);
  await expect(page.getByRole("radiogroup", { name: "考勤松紧" })).toHaveCount(0);
  await expect(page.getByText(/仅线下适用/)).toHaveCount(0);
}

test("write-review entry is the course page 写点评 button, not the nav", async ({
  page,
}) => {
  await mockSubmitApi(page, { authenticated: false });
  await page.goto("/courses");
  // 导航里不再有「写评价」。
  await expect(
    page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "写评价", exact: true }),
  ).toHaveCount(0);

  await page.goto("/courses/8?teacher=9");
  await page.getByRole("button", { name: "写点评" }).click();
  // 访客先进登录门，from 带回写评价地址（/submit 只是过门，不做停留断言）。
  await expect(page).toHaveURL(/\/login\?from=/);
  const url = new URL(page.url());
  expect(url.searchParams.get("from")).toBe("/submit?courseId=8&teacherId=9");
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
  await expect(page.getByRole("heading", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByText("评价已发布")).toHaveCount(0);
  expect(posted).toHaveLength(0);
});

test("pending session on /submit stays silent instead of announcing a login redirect", async ({
  page,
}) => {
  await mockSubmitApi(page, { authenticated: false });
  // 压住会话响应，让 viewerReady 一直为 false；后注册的路由先生效。
  let releaseSession: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await page.route("**/api/user/session", async (route) => {
    await gate;
    await route.fulfill({
      json: { authenticated: false, loginPath: "/login", logoutPath: "/logout" },
    });
  });

  try {
    await page.goto("/submit?courseId=8");
    // 会话未决：可能是已登录用户在等响应，不能断言「正在前往登录」。
    await page.waitForTimeout(500);
    await expect(page.getByText("正在前往登录…")).toHaveCount(0);
    expect(page.url()).toContain("/submit");
  } finally {
    releaseSession();
  }

  // 已确认访客才播报并跳转。
  await expect(page).toHaveURL(/\/login\?from=/);
});

test("icourse-aligned form appears immediately @mobile-smoke", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");

  await expect(page.getByRole("button", { name: "开始填写" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "写评价" })).toBeVisible();
  await expect(page.getByText(/评价必须绑定已有任课关系/)).toHaveCount(0);
  await expect(page.getByText("人机验证已完成。")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "课程" })).toBeVisible();
  const teacherSelect = page.getByRole("button", { name: /任课教师/ });
  await expect(teacherSelect).toBeVisible();
  await expect(teacherSelect).toBeDisabled();
  await expect(teacherSelect).toContainText("请选择");
  await expect(page.getByText("Select an item")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /学期/ })).toHaveCount(0);
  await expect(page.getByPlaceholder("选填")).toBeVisible();
  await expect(
    page.getByText("可选. 分享你的成绩有助于同学们进行更全面的判断."),
  ).toBeVisible();
  await expect(
    page.getByText("可以搜索课名、老师或课号，再选出对应的课。"),
  ).toBeVisible();
  await expect(page.getByText("选择这门课的任课老师")).toBeVisible();
  // 四道三档（中文档位）+ 推荐度。
  await expectOfflineQuestions(page);
  await expect(
    page.getByRole("textbox", { name: "一句话总结本课" }),
  ).toHaveCount(0);
  await expect(noteEditor(page)).toBeVisible();
  await expect(
    page.getByText("请畅所欲言, 从讲课方式到作业考试都谈谈."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "测评内容理想上应当富有事实且描述全面. 比如一门课讲得好但考试很难, 二者都说出来更有利于同学们做出全面的选择和判断. 学弟学妹(和挣扎的学长学姐)感谢你们.",
    ),
  ).toBeVisible();
  await expect(noteEditor(page).locator("[data-placeholder]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加粗" })).toHaveCount(0);
  await expect(page.getByText("已通过人机验证")).toHaveCount(0);
  // 选填成绩在详细评价之后。
  await expect(page.getByRole("textbox", { name: "你的成绩" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "实名提交" })).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "只写点评不评分" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "仅限登录用户查看" }),
  ).not.toBeChecked();
  await expect(page.getByRole("button", { name: "保存" })).toBeVisible();
  await expect(page.getByRole("button", { name: "发布" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);

  await chooseCourse(page, "文化", "中国传统文化导论");
  await expect(teacherSelect).toBeEnabled();
  expect(posted).toHaveLength(0);
});

test("deep link prefills course and teacher on the form", async ({
  page,
}) => {
  await mockSubmitApi(page);
  await page.goto("/submit?courseId=8&teacherId=9");
  await expect(page.getByRole("button", { name: "开始填写" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "课程" })).toHaveCount(0);

  const target = page.getByRole("region", {
    name: "点评 · 中国传统文化导论（测试教师）",
  });
  await expect(target).toBeVisible();
  await expect(target.getByText("点评 · 中国传统文化导论（测试教师）")).toBeVisible();
  await expect(target.getByText("课程号：GEN0108")).toBeVisible();
  await expect(target.getByText(/学期：/)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "课程" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /任课教师/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /学期/ })).toHaveCount(0);
});

test("preset submit waits for the course scheme instead of painting a fallback questionnaire", async ({
  page,
}) => {
  await mockSubmitApi(page);
  let releaseCourse: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseCourse = resolve;
  });
  await page.route("**/api/courses/8", async (route) => {
    await gate;
    return route.fulfill({
      json: { course: courseDetail, reviewCount: 0 },
    });
  });

  await page.goto("/submit?courseId=8&teacherId=9");
  await expect(page.getByRole("status", { name: "问卷加载中" })).toBeVisible();
  await expect(page.getByRole("grid", { name: "课程难度" })).toHaveCount(0);
  await expect(page.getByRole("grid", { name: "作业多少" })).toHaveCount(0);
  await expect(page.getByRole("grid", { name: "考勤松紧" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "上课表现" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "点名频率" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "写评价" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "课程" })).toHaveCount(0);

  releaseCourse();
  await expectOfflineQuestions(page);
  await expect(
    page.getByRole("region", {
      name: "点评 · 中国传统文化导论（测试教师）",
    }),
  ).toBeVisible();
  await expect(page.getByRole("status", { name: "问卷加载中" })).toHaveCount(0);
});

test("skip-rating checkbox does not shift the overall stars", async ({
  page,
}) => {
  await mockSubmitApi(page);
  await page.goto("/submit?courseId=8&teacherId=9");
  const firstStar = page
    .getByRole("radiogroup", { name: "推荐度" })
    .getByRole("radio", { name: "1 星", exact: true });
  await expect(firstStar).toBeVisible();
  const before = await firstStar.boundingBox();
  await clickLabeledCheckbox(page, "只写点评不评分");
  await expect(
    page.getByRole("checkbox", { name: "只写点评不评分" }),
  ).toBeChecked();
  const after = await firstStar.boundingBox();
  expect(before).toBeTruthy();
  expect(after).toBeTruthy();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
});

test("skip-rating clears filled scores and disables the rating controls", async ({
  page,
}) => {
  await mockSubmitApi(page);
  await page.goto("/submit?courseId=8&teacherId=9");
  await answerTier3AndOverall(page, "0.5");
  await expect(page.getByText("快跑")).toBeVisible();
  await expect(
    page.getByRole("grid", { name: "课程难度" }).getByRole("row", {
      name: "中等",
      exact: true,
    }),
  ).toHaveAttribute("aria-selected", "true");

  await clickLabeledCheckbox(page, "只写点评不评分");
  for (const label of ["课程难度", "作业多少", "给分好坏", "收获多少"]) {
    const group = page.getByRole("grid", { name: label });
    await expect(group.getByRole("row").first()).toBeDisabled();
    await expect(group.getByRole("row", { selected: true })).toHaveCount(0);
  }
  const stars = page.getByRole("radiogroup", { name: "推荐度" });
  await expect(stars).toBeDisabled();
  await expect(stars.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(page.getByText("快跑")).toHaveCount(0);
  await expect(page.getByText("很推荐")).toHaveCount(0);
  await expect(page.getByText("必选")).toHaveCount(0);

  await clickLabeledCheckbox(page, "只写点评不评分");
  await expect(
    page.getByRole("checkbox", { name: "只写点评不评分" }),
  ).not.toBeChecked();
  const difficulty = page.getByRole("grid", { name: "课程难度" });
  await expect(difficulty.getByRole("row").first()).toBeEnabled();
  await expect(difficulty.getByRole("row", { selected: true })).toHaveCount(0);
  await expect(stars).toBeEnabled();
  await expect(stars.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(page.getByText("快跑")).toHaveCount(0);
  await pickScore(page, "课程难度", "简单");
  await expect(
    difficulty.getByRole("row", { name: "简单", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("save keeps a draft for the same course and teacher", async ({ page }) => {
  await mockSubmitApi(page);
  await page.goto("/submit?courseId=8&teacherId=9");
  await fillComment(page, VALID_NOTE);
  await clickLabeledCheckbox(page, "只写点评不评分");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已保存，可稍后继续填写")).toBeVisible();

  await page.reload();
  await expect(noteEditor(page)).toHaveValue(VALID_NOTE);
  await expect(
    page.getByRole("checkbox", { name: "只写点评不评分" }),
  ).toBeChecked();
  await expect(page.getByRole("radiogroup", { name: "推荐度" })).toBeDisabled();
});

test("three-tier options show Chinese labels and submit the full payload @mobile-smoke", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await expectOfflineQuestions(page);

  // 缺题拦截：先答三维 + 推荐度，提交被拦在 收获多少。
  await pickScore(page, "课程难度", "简单");
  await pickScore(page, "作业多少", "中等");
  await pickScore(page, "给分好坏", "超好");
  await pickOverall(page, "5");
  await expect(page.getByText("必选")).toBeVisible();
  await fillComment(page, LONG_COMMENT);
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("请选择收获多少")).toBeVisible();
  expect(posted).toHaveLength(0);

  await pickScore(page, "收获多少", "很多");
  await expect(page.getByText("请选择收获多少")).toHaveCount(0);
  await page.getByRole("button", { name: "发布" }).click();

  // 发布成功：回到该 课程×教师 的详情页并展示提交成功条。
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9/);
  await expect(page.getByText("评价已发布，感谢分享。")).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    courseId: 8,
    teacherId: 9,
    overall: 5,
    scores: { difficulty: 1, homework: 2, grading: 1, gain: 1 },
    comment: `<p>${LONG_COMMENT}</p>`,
    headline: LONG_COMMENT,
  });
  // 成绩选填：未填时提交空串，服务端存 NULL。
  expect(posted[0].grade).toBe("");
  expect(posted[0]).not.toHaveProperty("term");
  // 载荷不含 v1 旧维度键（#374），也不再带考勤。
  expect(posted[0].scores).not.toHaveProperty("teaching");
  expect(posted[0].scores).not.toHaveProperty("workload");
  expect(posted[0].scores).not.toHaveProperty("attendance");

  const item = page.getByRole("list", { name: "评价列表" }).getByRole("listitem").first();
  await expect(item.getByText(LONG_COMMENT).first()).toBeVisible();
  await expect(item.getByText(/成绩/)).toHaveCount(0);
});

test("short comment is blocked before submit", async ({ page }) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await pickScore(page, "课程难度", "简单");
  await pickScore(page, "作业多少", "中等");
  await pickScore(page, "给分好坏", "超好");
  await pickScore(page, "收获多少", "很多");
  await pickOverall(page, "4");
  await fillComment(page, "太短");
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("字数不够")).toBeVisible();
  expect(posted).toHaveLength(0);
});

// #374：详细评价按去空白后的长度计，9 字拦截；合格文案放行。
test("a note shorter than 10 chars after trim blocks submit", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");

  await answerTier3AndOverall(page, "3");
  // 去掉首尾空白后只有 9 字，达不到必填下限。
  await fillComment(page, "  123456789  ");
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("字数不够")).toBeVisible();
  expect(posted).toHaveLength(0);

  await fillComment(page, VALID_NOTE);
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9/);
  await expect(page.getByText("评价已发布，感谢分享。")).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ comment: `<p>${VALID_NOTE}</p>` });
});

test("mooc course shows the same four questions without an offline-only hint", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await chooseCourse(page, "思政", "思政网课");

  await expectOfflineQuestions(page);

  await pickTeacher(page, "网课教师");
  await pickScore(page, "课程难度", "中等");
  await pickScore(page, "作业多少", "超多");
  await pickScore(page, "给分好坏", "一般");
  await pickScore(page, "收获多少", "一般");
  await pickOverall(page, "4");
  await fillComment(page, LONG_COMMENT);
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page).toHaveURL(/\/courses\/21\?teacher=22/);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    courseId: 21,
    teacherId: 22,
    overall: 4,
    scores: { difficulty: 2, homework: 3, grading: 2, gain: 2 },
    headline: LONG_COMMENT,
  });
  expect(posted[0].scores).not.toHaveProperty("attendance");
});

// #374：体育课与专业课共用同一套四道三档题。
test("pe course shows the same four three-tier questions as major", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await chooseCourse(page, "体育", "大学体育");
  await expectOfflineQuestions(page);
  await expect(
    page.getByRole("button", { name: /任课教师/ }),
  ).toBeEnabled();
  expect(posted).toHaveLength(0);
});

test("typed note is submitted without a formatting toolbar", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await answerTier3AndOverall(page, "5");

  const editor = noteEditor(page);
  await editor.click();
  await editor.fill("这门课给分宽松，值得推荐");
  await expect(page.getByRole("button", { name: "加粗" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "无序列表" })).toHaveCount(0);

  await page.getByRole("button", { name: "发布" }).click();
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9/);
  expect(posted).toHaveLength(1);
  expect(posted[0].comment).toBe("<p>这门课给分宽松，值得推荐</p>");
  expect(posted[0].headline).toBe("这门课给分宽松，值得推荐");
});

// #447：选填成绩随提交进入载荷，并在课程详情条目正文后单独一行展示。
test("optional grade is submitted and shown on the course detail", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await answerTier3AndOverall(page, "4");
  await fillComment(page, VALID_NOTE);
  await page.getByRole("textbox", { name: "你的成绩" }).fill("90");
  await page.getByRole("button", { name: "发布" }).click();

  await expect(page).toHaveURL(/\/courses\/8\?teacher=9/);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    grade: "90",
    headline: VALID_NOTE,
  });

  const item = page
    .getByRole("list", { name: "评价列表" })
    .getByRole("listitem")
    .first();
  await expect(item.getByText(VALID_NOTE).first()).toBeVisible();
  await expect(item.getByText("成绩：90", { exact: true })).toBeVisible();
});

test("review-only submit keeps the questionnaire optional", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit?courseId=8&teacherId=9");
  const skipRatings = page.getByRole("checkbox", { name: "只写点评不评分" });
  await expect(skipRatings).not.toBeChecked();
  await clickLabeledCheckbox(page, "只写点评不评分");
  await expect(skipRatings).toBeChecked();
  await expect(
    page.getByRole("grid", { name: "课程难度" }).getByRole("row").first(),
  ).toBeDisabled();
  await expect(page.getByRole("radiogroup", { name: "推荐度" })).toBeDisabled();
  await expect(
    page.getByText("建议尽量评分，方便同学比较选课"),
  ).toHaveCount(0);

  await fillComment(page, VALID_NOTE);
  await page.getByRole("button", { name: "发布" }).click();

  await expect(page).toHaveURL(/\/courses\/8\?teacher=9/);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    courseId: 8,
    teacherId: 9,
    overall: null,
    scores: null,
    reviewOnly: true,
    comment: `<p>${VALID_NOTE}</p>`,
  });

  const item = page
    .getByRole("list", { name: "评价列表" })
    .getByRole("listitem")
    .first();
  await expect(item.getByText(VALID_NOTE).first()).toBeVisible();
});
