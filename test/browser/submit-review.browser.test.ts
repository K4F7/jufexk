import { expect, test, type Page } from "@playwright/test";

const OFFLINE_QUESTIONS = [
  {
    id: "teaching",
    label: "上课表现",
    prompt: "上课表现",
    scale: "1 到 5，分数越高表示上课表现越好",
  },
  {
    id: "attendance",
    label: "点名频率",
    prompt: "点名频率",
    scale: "1 到 5，分数越高表示点名越频繁",
  },
  {
    id: "grading",
    label: "给分情况",
    prompt: "你感受到的给分",
    scale: "1 到 5，分数越高表示你感受到的给分越宽松",
  },
  {
    id: "workload",
    label: "考核压力",
    prompt: "考核压力",
    scale: "1 到 5，分数越高表示考核压力越大",
  },
] as const;

const MOOC_QUESTIONS = OFFLINE_QUESTIONS.filter(
  (question) => question.id !== "attendance",
);

const offlineCourse = {
  id: 8,
  code: "GEN0108",
  name: "中国传统文化导论",
  category: "general",
  department: "人文学院",
  teachers: "测试教师",
  schemeKey: "major",
  schemeVersion: 1,
  tags: [] as string[],
  applicableQuestions: OFFLINE_QUESTIONS,
};

const moocCourse = {
  id: 21,
  code: "MOOC0101",
  name: "思政网课",
  category: "general",
  department: "马克思主义学院",
  teachers: "网课教师",
  schemeKey: "ideology",
  schemeVersion: 1,
  tags: ["mooc"],
  applicableQuestions: MOOC_QUESTIONS,
};

async function mockSubmitApi(page: Page) {
  const posted: Record<string, unknown>[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学" },
      });
    if (url.pathname === "/api/user/session")
      return route.fulfill({
        json: {
          authenticated: false,
          loginPath: "/login",
          logoutPath: "/logout",
        },
      });
    if (url.pathname === "/api/auth/campus")
      return route.fulfill({ json: { enabled: false } });
    if (url.pathname === "/api/courses" || url.pathname === "/api/teachers")
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    if (url.pathname === "/api/courses/options") {
      const q = url.searchParams.get("q") || "";
      const items = [offlineCourse, moocCourse].filter(
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
            ...offlineCourse,
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
  await page
    .getByRole("radiogroup", { name: label })
    .getByRole("radio", { name: value, exact: true })
    .click({ force: true });
}

async function pickTeacher(page: Page, name: string) {
  await page.getByRole("button", { name: /任课教师/ }).click();
  await page.getByRole("option", { name }).click();
}

test("site nav opens the write-review page", async ({ page }) => {
  await mockSubmitApi(page);
  await page.goto("/courses");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "写评价" })
    .click();
  await expect(page).toHaveURL(/\/submit$/);
  await expect(page.getByRole("heading", { name: "写评价" })).toBeVisible();
  await expect(page.getByRole("link", { name: "提交补充申请" })).toHaveCount(0);
});

test("offline course requires the four dimensions plus overall", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await chooseCourse(page, "文化", "中国传统文化导论");
  await pickTeacher(page, "测试教师");

  await expect(page.getByRole("radiogroup", { name: "上课表现" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "点名频率" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "你感受到的给分" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "考核压力" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "本次推荐度" })).toBeVisible();

  await pickScore(page, "上课表现", "4");
  await pickScore(page, "点名频率", "3");
  await pickScore(page, "你感受到的给分", "5");
  await pickScore(page, "本次推荐度", "5");
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByText("请选择考核压力")).toBeVisible();
  expect(posted).toHaveLength(0);

  await pickScore(page, "考核压力", "2");
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByRole("status")).toHaveText("评价已发布");
  expect(posted).toEqual([
    {
      courseId: 8,
      teacherId: 9,
      overall: 5,
      scores: { teaching: 4, attendance: 3, grading: 5, workload: 2 },
      comment: "",
      website: "",
      turnstileToken: "",
    },
  ]);
});

test("mooc course hides attendance and omits it from the payload", async ({
  page,
}) => {
  const posted = await mockSubmitApi(page);
  await page.goto("/submit");
  await chooseCourse(page, "思政", "思政网课");
  await pickTeacher(page, "网课教师");

  await expect(page.getByRole("radiogroup", { name: "上课表现" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "点名频率" })).toHaveCount(0);
  await expect(page.getByText("点名频率")).toHaveCount(0);

  await pickScore(page, "上课表现", "4");
  await pickScore(page, "你感受到的给分", "5");
  await pickScore(page, "考核压力", "2");
  await pickScore(page, "本次推荐度", "4");
  await page.getByRole("button", { name: "提交评价" }).click();
  await expect(page.getByRole("status")).toHaveText("评价已发布");
  expect(posted[0]).toMatchObject({
    courseId: 21,
    teacherId: 22,
    overall: 4,
    scores: { teaching: 4, grading: 5, workload: 2 },
  });
  expect(posted[0].scores).not.toHaveProperty("attendance");
});
