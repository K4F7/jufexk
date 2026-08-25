import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogScheduleGrades, currentCatalogTermId } from "../../src/lib/catalog-schedule";
import { jwxtSnapshotBookmarkletSource } from "../../src/lib/jwxt-import-bookmarklet";
import { JWXT_MAJOR_REQUIRED_MESSAGE } from "../../src/lib/jwxt-offering";
import { SCHEDULE_MOBILE_NOTICE_KEY } from "../../src/lib/schedule-mobile-notice";
import { SCHEDULE_PLAN_STORAGE_KEY } from "../../src/lib/schedule-plan";

const unselectedHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/jwxt/s2020103-unselected.html"),
  "utf8",
);

const firstGrade = catalogScheduleGrades()[0].label;

const catalogRelations = [
  { course_id: 8, code: "10100001", name: "高等数学", category: "general", department: "数学学院", teacher_id: 9, teacher_name: "教师甲", rating: 4.2, review_count: 6 },
  { course_id: 8, code: "10100001", name: "高等数学", category: "general", department: "数学学院", teacher_id: 12, teacher_name: "教师乙", rating: 4.0, review_count: 3 },
  { course_id: 10, code: "10200001", name: "微观经济学", category: "general", department: "数学学院", teacher_id: 11, teacher_name: "教师辰", rating: 4.3, review_count: 7 },
  { course_id: 14, code: "20100001", name: "冲突课", category: "general", department: "数学学院", teacher_id: 15, teacher_name: "教师丁", rating: 3.8, review_count: 2 },
  { course_id: 16, code: "20200001", name: "数据结构", category: "general", department: "信息管理学院", teacher_id: 17, teacher_name: "教师戊", rating: 4.1, review_count: 4 },
  { course_id: 20, code: "30100001", name: "羽毛球", category: "sports", department: "体育学院", teacher_id: 21, teacher_name: "教师巳", rating: 4.5, review_count: 9 },
];

const offeringSchedules: Record<string, Array<{
  key: string;
  courseCode: string;
  courseName: string;
  termId: string;
  campus: string;
  weekText: string;
  timeText: string;
  place: string;
  teacherName: string;
  catalogCourseId: number;
  catalogTeacherId: number;
}>> = {
  "8": [
    { key: "offering-8-a", courseCode: "10100001", courseName: "高等数学", termId: currentCatalogTermId(), campus: "麦庐园", weekText: "1-16周", timeText: "星期一 第1-2节", place: "一教101", teacherName: "教师甲", catalogCourseId: 8, catalogTeacherId: 9 },
    { key: "offering-8-b", courseCode: "10100001", courseName: "高等数学", termId: currentCatalogTermId(), campus: "麦庐园", weekText: "1-16周", timeText: "星期三 第1-2节", place: "一教103", teacherName: "教师乙", catalogCourseId: 8, catalogTeacherId: 12 },
  ],
  "10": [
    { key: "offering-10-a", courseCode: "10200001", courseName: "微观经济学", termId: currentCatalogTermId(), campus: "麦庐园", weekText: "1-16周", timeText: "星期二 第3-4节", place: "二教202", teacherName: "教师辰", catalogCourseId: 10, catalogTeacherId: 11 },
  ],
  "14": [
    { key: "offering-14-a", courseCode: "20100001", courseName: "冲突课", termId: currentCatalogTermId(), campus: "麦庐园", weekText: "1-16周", timeText: "星期一 第1-2节", place: "一教102", teacherName: "教师丁", catalogCourseId: 14, catalogTeacherId: 15 },
  ],
  "16": [
    { key: "offering-16-a", courseCode: "20200001", courseName: "数据结构", termId: currentCatalogTermId(), campus: "麦庐园", weekText: "1-16周", timeText: "星期四 第1-2节", place: "一教104", teacherName: "教师戊", catalogCourseId: 16, catalogTeacherId: 17 },
  ],
  "20": [
    { key: "offering-20-a", courseCode: "30100001", courseName: "羽毛球", termId: currentCatalogTermId(), campus: "麦庐园", weekText: "1-16周", timeText: "星期五 第6-7节", place: "体育馆", teacherName: "教师巳", catalogCourseId: 20, catalogTeacherId: 21 },
  ],
};

async function rememberMobileNotice(page: Page) {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "1");
  }, SCHEDULE_MOBILE_NOTICE_KEY);
}

function scheduleDesktopNotice(page: Page) {
  return page.getByRole("alertdialog", { name: "本功能只支持电脑端" });
}

async function mockScheduleApi(
  page: Page,
  authenticated = true,
  options?: { showMobileNotice?: boolean },
) {
  if (!options?.showMobileNotice) {
    await rememberMobileNotice(page);
  }
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
      });
    }
    if (url.pathname === "/api/site/banner") {
      return route.fulfill({
        json: { desktopHtml: "", mobileHtml: "", updatedAt: null },
      });
    }
    if (url.pathname === "/api/user/session") {
      return route.fulfill({
        json: {
          authenticated,
          csrfToken: authenticated ? "csrf-user" : undefined,
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
    if (url.pathname.startsWith("/api/jwxt") || url.pathname.startsWith("/api/ehall")) {
      return route.fulfill({ status: 404, json: { error: "jwxt proxy disabled" } });
    }
    if (url.pathname === "/api/courses/departments") {
      return route.fulfill({ json: { items: ["数学学院", "信息管理学院", "体育学院"] } });
    }
    if (url.pathname === "/api/courses") {
      const department = url.searchParams.get("department") || "";
      const category = url.searchParams.get("category") || "";
      const items = catalogRelations.filter((relation) => {
        if (department) return relation.department === department;
        if (category) return relation.category === category;
        return false;
      });
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 50, pages: 1 } });
    }
    if (url.pathname === "/api/schedule-offerings") {
      const courseId = url.searchParams.get("courseId") || "";
      expect(url.searchParams.get("term")).toBe(currentCatalogTermId());
      return route.fulfill({ json: offeringSchedules[courseId] ?? [] });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

async function chooseFilter(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function selectMajor(page: Page, major = "数学学院") {
  await expect(page.getByRole("button", { name: /专业/ })).toBeVisible();
  await chooseFilter(page, "年级", firstGrade);
  await chooseFilter(page, "专业", major);
}

async function openCoursePicker(page: Page) {
  await page.getByRole("button", { name: "选择课程" }).click();
  return page.getByRole("dialog", { name: "选择课程" });
}

function courseList(page: Page) {
  return page.getByRole("grid", { name: "选课列表" });
}

function sectionList(page: Page) {
  return page.getByRole("grid", { name: "开课班" });
}

test("catalog filters, two candidate kinds, place, persist @mobile-smoke", async ({
  page,
}) => {
  const ehallRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/ehall/")) {
      ehallRequests.push(request.url());
    }
  });
  await mockScheduleApi(page);
  await page.goto("/schedule");

  await expect(page.getByText("专业选择", { exact: true })).toBeVisible();
  await expect(page.getByText("选课列表", { exact: true })).toBeVisible();
  await expect(page.getByText("开课班", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无数据").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新教务数据" })).toHaveCount(0);
  await expect(page.getByText(/快照|JSON|书签|还没有教务数据/)).toHaveCount(0);
  expect(ehallRequests).toEqual([]);

  await expect(page.getByRole("button", { name: "选择课程" })).toBeDisabled();
  await selectMajor(page);
  await expect(page.getByRole("button", { name: "选择课程" })).toBeEnabled();

  const picker = await openCoursePicker(page);
  await picker.getByRole("tab", { name: "计划内" }).click();
  const planned = picker.getByLabel("计划内课程");
  await expect(planned).toContainText("高等数学");
  await expect(planned).toContainText("微观经济学");
  await expect(planned).not.toContainText(/班号|容量|A-01/);
  await expect(planned.getByRole("link", { name: "4.2 · 6 条" }).first()).toBeVisible();
  await planned.getByRole("row", { name: /高等数学/ }).getByRole("button", { name: "加入课表" }).first().click();
  await expect(courseList(page)).toContainText("高等数学");

  await planned.getByRole("row", { name: /微观经济学/ }).getByRole("button", { name: "加入课表" }).click();
  await expect(courseList(page)).toContainText("微观经济学");

  await picker.getByRole("tab", { name: "公共选修" }).click();
  await picker.getByLabel("公共选修").getByRole("button", { name: "加入课表" }).click();
  await expect(courseList(page)).toContainText("羽毛球");

  const timetable = page.getByRole("grid", { name: "周课表" });
  await expect(timetable.getByText("高等数学（教师甲）").first()).toBeVisible();
  await expect(timetable.getByText("微观经济学（教师辰）").first()).toBeVisible();
  await expect(timetable.getByText("羽毛球（教师巳）").first()).toBeVisible();

  await picker.getByRole("tab", { name: "计划内" }).click();
  await picker.getByLabel("计划内课程").getByRole("row", { name: /冲突课/ }).getByRole("button", { name: "加入课表" }).click();
  await expect(page.getByRole("alert")).toContainText("冲突课");
  await expect(page.getByRole("alert")).toContainText("未加入");

  await picker.getByRole("button", { name: "完成" }).click();
  await page.getByRole("button", { name: "保存课表" }).click();
  await expect(page.getByText("课表已保存到本机")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学（教师甲）").first()).toBeVisible();
  await expect(courseList(page)).toContainText("微观经济学");
  await expect(courseList(page)).toContainText("羽毛球");

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学（教师甲）").first()).toBeVisible();
  const direction = await page.getByRole("region", { name: "课程与开课班" }).evaluate((el) => getComputedStyle(el).flexDirection);
  expect(direction).toBe("column");
});

test("switches candidate data when the catalog major changes", async ({ page }) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await selectMajor(page, "信息管理学院");

  const picker = await openCoursePicker(page);
  await picker.getByRole("tab", { name: "计划内" }).click();
  await expect(picker.getByLabel("计划内课程")).toContainText("数据结构");
  await expect(picker.getByLabel("计划内课程")).not.toContainText("高等数学");
  await picker.getByRole("button", { name: "完成" }).click();

  await chooseFilter(page, "年级", catalogScheduleGrades()[1].label);
  await expect(page.getByText("请先选择年级和专业")).toBeVisible();
  await expect(page.getByRole("button", { name: "选择课程" })).toBeDisabled();
  await chooseFilter(page, "专业", "数学学院");
  const mathPicker = await openCoursePicker(page);
  await mathPicker.getByRole("tab", { name: "计划内" }).click();
  await expect(mathPicker.getByLabel("计划内课程")).toContainText("高等数学");
  await expect(mathPicker.getByLabel("计划内课程")).not.toContainText("数据结构");
});

test("hides planned and public tables until a major is selected", async ({ page }) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await expect(page.getByText("请先选择年级和专业")).toBeVisible();
  await expect(page.getByRole("button", { name: "选择课程" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "计划内" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "公共选修" })).toHaveCount(0);
  await expect(page.getByText("暂无数据").first()).toBeVisible();
});

test("bookmarklet refuses S2020103 until grade and major are selected", async ({ page }) => {
  const resultUrl = "https://jwxt.jxufe.edu.cn/student/wsxk.xskc.html?menucode=S2020103";
  await page.route(resultUrl, (route) => route.fulfill({
    body: unselectedHtml,
    contentType: "text/html; charset=utf-8",
  }));
  const messages: string[] = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.accept();
  });
  await page.goto(resultUrl);
  const downloads: string[] = [];
  page.on("download", (download) => {
    downloads.push(download.suggestedFilename());
  });
  await page.addScriptTag({ content: jwxtSnapshotBookmarkletSource() });
  await expect.poll(() => messages[0] ?? "").toBe(JWXT_MAJOR_REQUIRED_MESSAGE);
  expect(downloads).toEqual([]);
});

test("guest can browse catalog but must log in to add or save", async ({ page }) => {
  await mockScheduleApi(page, false);
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [
      SCHEDULE_PLAN_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeTermId: currentCatalogTermId(),
        terms: {
          [currentCatalogTermId()]: [
            {
              key: `${currentCatalogTermId()}+10100001+01`,
              termId: currentCatalogTermId(),
              courseCode: "10100001",
              courseName: "高等数学",
              section: "01",
              teacherName: "教师甲",
              origin: "planned",
              included: true,
              slots: [
                {
                  id: "s",
                  weekday: 1,
                  startPeriod: 1,
                  endPeriod: 2,
                  weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
                },
              ],
              credits: 4,
              categoryPath: "",
              campus: "",
              place: "",
              courseId: 8,
              teacherId: 9,
              rating: null,
              reviewCount: 0,
            },
          ],
        },
      }),
    ],
  );
  await page.goto("/schedule");
  await expect(page.getByText("专业选择", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新教务数据" })).toHaveCount(0);
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学（教师甲）").first()).toBeVisible();
  await page.getByRole("button", { name: "保存课表" }).click();
  const loginDialog = page.getByRole("dialog");
  await expect(loginDialog).toContainText("加入课表需要先登录");
  await loginDialog.getByRole("link", { name: "去登录" }).click();
  await expect(page).toHaveURL(/\/login\?from=%2Fschedule/);
});

test("same-course swap is atomic after selecting a catalog section", async ({ page }) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await selectMajor(page);
  const picker = await openCoursePicker(page);
  await picker.getByRole("tab", { name: "计划内" }).click();
  await picker.getByLabel("计划内课程").getByRole("row", { name: /高等数学/ }).getByRole("button", { name: "加入课表" }).first().click();
  await picker.getByRole("button", { name: "完成" }).click();
  await expect(courseList(page)).toContainText("高等数学");
  await courseList(page).getByRole("button", { name: "高等数学" }).click();
  await expect(sectionList(page)).toContainText("教师乙");
  await sectionList(page).getByRole("button", { name: "换班" }).click();
  await expect(courseList(page)).not.toContainText(/班03|班01/);
});

test("shows the desktop-only notice once on a narrow viewport", async ({
  page,
}) => {
  await mockScheduleApi(page, true, { showMobileNotice: true });
  await page.goto("/schedule");
  const notice = scheduleDesktopNotice(page);
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    await expect(notice).toHaveCount(0);
    return;
  }
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("移动端不适配");
  await notice.getByRole("button", { name: "知道了" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(scheduleDesktopNotice(page)).toHaveCount(0);
});
