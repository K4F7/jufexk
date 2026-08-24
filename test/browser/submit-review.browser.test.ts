import { expect, test, type Page } from "@playwright/test";
import { TIER3_QUESTIONS, V3_QUESTIONS } from "../review-score-fixtures";

/**
 * 写评价（Issue #402 + #400 + #447 + #371）：入口只从课程页「写点评」；表单对齐 icourse ——
 * 学期 Select（必填，默认最近学期）、v3 五道三档（四维 + 考勤松紧，中文档位文案）、
 * 1–5 星级本次推荐度、Tiptap 详细评价（无工具栏/占位/说明）、选填成绩（grade）、实名提交。
 * mooc 课藏考勤题；发布成功回到该 课程×教师 的详情页。一句话总结字段已下线。
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
  schemeVersion: 3,
  tags: [] as string[],
  applicableQuestions: V3_QUESTIONS,
};

const moocCourse = {
  id: 21,
  code: "MOOC0101",
  name: "思政网课",
  category: "general",
  department: "马克思主义学院",
  teachers: "网课教师",
  schemeKey: "ideology",
  schemeVersion: 3,
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
  schemeVersion: 3,
  tags: [] as string[],
  applicableQuestions: V3_QUESTIONS,
};

const courseDetail = {
  ...offlineCourse,
  teachers: [
    { id: 9, name: "测试教师", department: "人文学院", review_count: 0 },
  ],
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
        term: entry.term,
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

/** 详细评价是 Tiptap 富文本编辑器（contenteditable textbox）。 */
function noteEditor(page: Page) {
  return page.getByRole("textbox", { name: "详细评价" });
}

async function fillComment(page: Page, text: string) {
  await noteEditor(page).fill(text);
}

/** 学期 Select 选第一项（列表随当前日期生成，第一项即最近学期）。 */
async function pickTerm(page: Page) {
  await page.getByRole("button", { name: /学期/ }).click();
  await page.getByRole("option").first().click();
}

async function pickOverall(page: Page, value: string) {
  await page
    .getByRole("radiogroup", { name: "本次推荐度" })
    .getByRole("radio", { name: `${value} 星` })
    .click({ force: true });
}

async function answerTier3AndOverall(
  page: Page,
  overall: string,
) {
  await pickScore(page, "课程难度", "中等");
  await pickScore(page, "作业多少", "超多");
  await pickScore(page, "给分好坏", "一般");
  await pickScore(page, "收获多少", "没有");
  await pickScore(page, "考勤松紧", "一般");
  await pickOverall(page, overall);
}

/** 所有课都应看到的公共核四道三档题（中文档位，#374）。 */
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
  await expect(page.getByText("简单 / 中等 / 困难")).toHaveCount(0);
  await expect(page.getByText("不多 / 中等 / 超多")).toHaveCount(0);
  await expect(page.getByText("超好 / 一般 / 杀手")).toHaveCount(0);
  await expect(page.getByText("很多 / 一般 / 没有")).toHaveCount(0);
  await expect(page.getByText("1 到 5，分数越高表示越推荐")).toHaveCount(0);
}

/** v3 线下课的第五道三档题：考勤松紧（宽松 / 一般 / 严苛，#371 锁定文案）。 */
async function expectAttendanceQuestion(page: Page) {
  const attendance = page.getByRole("radiogroup", { name: "考勤松紧" });
  await expect(attendance).toBeVisible();
  await expect(
    attendance.getByRole("radio", { name: "宽松", exact: true }),
  ).toBeVisible();
  await expect(
    attendance.getByRole("radio", { name: "一般", exact: true }),
  ).toBeVisible();
  await expect(
    attendance.getByRole("radio", { name: "严苛", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("宽松 / 一般 / 严苛")).toHaveCount(0);
}

/** 线下课（含未选课时的公共核预览）：五道三档题，无「仅线下适用」提示。 */
async function expectOfflineQuestions(page: Page) {
  await expectTier3Questions(page);
  await expectAttendanceQuestion(page);
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

test("gate comes first and the icourse-aligned form appears after entry", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");

  const start = page.getByRole("button", { name: "开始填写" });
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
  await expect(page.getByRole("heading", { name: "写评价" })).toBeVisible();
  await expect(page.getByText(/评价必须绑定已有任课关系/)).toHaveCount(0);
  await expect(page.getByText("人机验证已完成。")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "课程" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发布" })).toHaveCount(0);

  await start.click();

  await expect(start).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "课程" })).toBeVisible();
  const teacherSelect = page.getByRole("button", { name: /任课教师/ });
  await expect(teacherSelect).toBeVisible();
  await expect(teacherSelect).toBeDisabled();
  await expect(teacherSelect).toContainText("请选择");
  await expect(page.getByText("Select an item")).toHaveCount(0);
  // 学期 Select 在教师之后，默认最近学期。
  const termSelect = page.getByRole("button", { name: /学期/ });
  await expect(termSelect).toBeVisible();
  await expect(termSelect).toContainText(/\d{4}[春秋]/);
  await expect(
    page.getByText("如果不记得了，可以随便选一个 :)"),
  ).toBeVisible();
  await expect(
    page.getByText("可以搜索课名，老师，课号，选择对应的课"),
  ).toBeVisible();
  await expect(page.getByText("选择对应的老师")).toBeVisible();
  // v3 五道三档（中文档位）+ 本次推荐度。
  await expectOfflineQuestions(page);
  await expect(
    page.getByRole("textbox", { name: "一句话总结本课" }),
  ).toHaveCount(0);
  await expect(noteEditor(page)).toBeVisible();
  await expect(noteEditor(page).locator("[data-placeholder]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加粗" })).toHaveCount(0);
  await expect(page.getByText("已通过人机验证")).toHaveCount(0);
  // 选填成绩在详细评价之后。
  await expect(page.getByRole("textbox", { name: "你的成绩" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "实名提交" })).not.toBeChecked();
  await expect(page.getByText("对外展示为实名")).toBeVisible();
  await expect(page.getByRole("button", { name: "发布" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);

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

test("three-tier options show Chinese labels and submit the full payload", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await expectOfflineQuestions(page);

  await pickTerm(page);

  // 缺题拦截：先答三维 + 推荐度，提交被拦在 收获多少。
  await pickScore(page, "课程难度", "简单");
  await pickScore(page, "作业多少", "中等");
  await pickScore(page, "给分好坏", "超好");
  await pickOverall(page, "5");
  await fillComment(page, LONG_COMMENT);
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("请选择收获多少")).toBeVisible();
  expect(posted).toHaveLength(0);

  // 再答 收获多少，提交被拦在第五题 考勤松紧。
  await pickScore(page, "收获多少", "很多");
  await expect(page.getByText("请选择收获多少")).toHaveCount(0);
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("请选择考勤松紧")).toBeVisible();
  expect(posted).toHaveLength(0);

  await pickScore(page, "考勤松紧", "宽松");
  await expect(page.getByText("请选择考勤松紧")).toHaveCount(0);
  await page.getByRole("button", { name: "发布" }).click();

  // 发布成功：回到该 课程×教师 的详情页并展示提交成功条。
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9/);
  await expect(page.getByText("评价已发布，感谢分享。")).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    courseId: 8,
    teacherId: 9,
    overall: 5,
    scores: { difficulty: 1, homework: 2, grading: 1, gain: 1, attendance: 1 },
    comment: `<p>${LONG_COMMENT}</p>`,
    headline: LONG_COMMENT,
    anonymous: true,
  });
  // 成绩选填：未填时提交空串，服务端存 NULL。
  expect(posted[0].grade).toBe("");
  expect(typeof posted[0].term).toBe("string");
  expect(posted[0].term).not.toBe("");
  // 载荷不含 v1 旧维度键（#374）；v3 起 attendance 是考勤松紧（#371）。
  expect(posted[0].scores).not.toHaveProperty("teaching");
  expect(posted[0].scores).not.toHaveProperty("workload");

  const item = page.getByRole("list", { name: "评价列表" }).getByRole("listitem").first();
  await expect(item.getByText(LONG_COMMENT).first()).toBeVisible();
  await expect(item.getByText(/成绩/)).toHaveCount(0);
});

test("short comment is blocked before submit", async ({ page }) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await pickTerm(page);
  await pickScore(page, "课程难度", "简单");
  await pickScore(page, "作业多少", "中等");
  await pickScore(page, "给分好坏", "超好");
  await pickScore(page, "收获多少", "很多");
  await pickScore(page, "考勤松紧", "严苛");
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
  await passGate(page);
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await pickTerm(page);

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

test("mooc course hides attendance behind the offline-only hint", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
  await chooseCourse(page, "思政", "思政网课");

  // 网课只藏考勤题：公共核四维照答，考勤松紧不出现，并给出「仅线下适用」提示。
  await expectTier3Questions(page);
  await expect(
    page.getByRole("radiogroup", { name: "考勤松紧" }),
  ).toHaveCount(0);
  await expect(page.getByText(/仅线下适用/)).toBeVisible();
  await expect(page.getByText(/仅线下适用/)).toContainText("考勤松紧");

  await pickTeacher(page, "网课教师");
  await pickTerm(page);
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

// #374 + #371：体育课与专业课共用同一套 v3 五道三档题（含考勤松紧）。
test("pe course shows the same five three-tier questions as major", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
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
  await passGate(page);
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await pickTerm(page);
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

// #447：选填成绩随提交进入载荷，并在课程详情条目元信息行展示。
test("optional grade is submitted and shown on the course detail", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await passGate(page);
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");
  await pickTerm(page);
  await answerTier3AndOverall(page, "4");
  await fillComment(page, VALID_NOTE);
  await page.getByRole("textbox", { name: "你的成绩" }).fill("A-");
  await page.getByRole("button", { name: "发布" }).click();

  await expect(page).toHaveURL(/\/courses\/8\?teacher=9/);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    grade: "A-",
    headline: VALID_NOTE,
  });

  const item = page
    .getByRole("list", { name: "评价列表" })
    .getByRole("listitem")
    .first();
  await expect(item.getByText(VALID_NOTE).first()).toBeVisible();
  await expect(item.getByText("成绩 A-", { exact: true })).toBeVisible();
});
