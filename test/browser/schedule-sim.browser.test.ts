import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jwxtSnapshotBookmarkletSource } from "../../src/lib/jwxt-import-bookmarklet";
import { JWXT_MAJOR_REQUIRED_MESSAGE } from "../../src/lib/jwxt-offering";
import { SCHEDULE_MOBILE_NOTICE_KEY } from "../../src/lib/schedule-mobile-notice";
import { SCHEDULE_PLAN_STORAGE_KEY } from "../../src/lib/schedule-plan";
import { emptyPlan, mergeEnrolledRefresh } from "../../src/lib/jwxt-plan";
import type { JwxtSnapshotV1 } from "../../src/lib/jwxt-snapshot";

const unselectedHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/jwxt/s2020103-unselected.html"),
  "utf8",
);

const snapshotJson = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/jwxt/snapshot.v1.json"),
  "utf8",
);
const secondSelectionJson = JSON.stringify({
  ...JSON.parse(snapshotJson),
  grade: { id: "2023", label: "2023" },
  planned: [
    {
      ...JSON.parse(snapshotJson).planned[1],
      courseCode: "CS202",
      courseName: "数据结构",
      section: "02",
    },
  ],
  publicElectives: [],
});
const catalogRelations = [
  { course_id: 8, code: "10100001", name: "高等数学", category: "general", department: "数学", teacher_id: 9, teacher_name: "教师甲", rating: 4.2, review_count: 6 },
  { course_id: 10, code: "10200001", name: "微观经济学", category: "general", department: "经济", teacher_id: 11, teacher_name: "教师辰", rating: 4.3, review_count: 7 },
  { course_id: 20, code: "30100001", name: "书法鉴赏", category: "general", department: "艺术", teacher_id: 21, teacher_name: "教师巳", rating: 4.5, review_count: 9 },
];

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
    if (url.pathname.startsWith("/api/jwxt")) {
      return route.fulfill({ status: 404, json: { error: "jwxt proxy disabled" } });
    }
    if (url.pathname === "/api/courses") {
      const items = catalogRelations.filter((relation) => relation.code === url.searchParams.get("q"));
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 50, pages: 1 } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

function cachedSelection(text: string) {
  const snapshot = JSON.parse(text) as JwxtSnapshotV1;
  const enrich = (offering: JwxtSnapshotV1["enrolled"][number]) => {
    const relation = catalogRelations.find((item) => item.code === offering.courseCode);
    return {
      ...offering,
      catalogCourseId: relation?.course_id ?? null,
      catalogTeacherId: relation?.teacher_id ?? null,
      catalogRating: relation?.rating ?? null,
      catalogReviewCount: relation?.review_count ?? 0,
    };
  };
  return {
    ...snapshot,
    enrolled: snapshot.enrolled.map(enrich),
    planned: snapshot.planned.map(enrich),
    publicElectives: snapshot.publicElectives.map(enrich),
  };
}

async function seedCachedSelection(page: Page, text: string, seedPlan = false) {
  const snapshot = cachedSelection(text);
  const plan = seedPlan
    ? mergeEnrolledRefresh(emptyPlan(snapshot.term.id), snapshot)
    : null;
  await page.evaluate(
    async ({ snapshot: value, plan: nextPlan, planKey }) => {
      if (nextPlan) localStorage.setItem(planKey, JSON.stringify(nextPlan));
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("jufexk-jwxt", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("snapshots")) {
            request.result.createObjectStore("snapshots");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const key = [value.term.id, value.educationLevel.id, value.grade.id, value.major.id]
        .map((part) => encodeURIComponent(part.trim()))
        .join("|");
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("snapshots", "readwrite");
        tx.objectStore("snapshots").put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { snapshot, plan, planKey: SCHEDULE_PLAN_STORAGE_KEY },
  );
  await page.reload();
}

async function chooseFilter(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
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

test("manual refresh, filters, enrolled, two candidate kinds, place, persist @mobile-smoke", async ({
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
  await expect(page.getByText("还没有教务数据")).toBeVisible();
  expect(ehallRequests).toEqual([]);

  const refresh = page.getByRole("button", { name: "刷新教务数据" });
  const launchForm = refresh.locator("xpath=ancestor::form");
  await expect(launchForm).toHaveAttribute("action", "/api/ehall/launch");
  await expect(launchForm).toHaveAttribute("method", "post");
  await expect(launchForm).toHaveAttribute("target", "_blank");
  await expect(launchForm.locator('input[name="_csrf"]')).toHaveValue("csrf-user");
  await expect(page.getByText(/快照|JSON|书签/)).toHaveCount(0);
  expect(ehallRequests).toEqual([]);

  await seedCachedSelection(page, snapshotJson, true);
  await expect(page.getByText("年级", { exact: true })).toBeVisible();
  await expect(page.getByText("专业", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "选择课程" })).toBeEnabled();
  await expect(courseList(page)).toContainText("高等数学");

  const picker = await openCoursePicker(page);
  await picker.getByRole("tab", { name: "计划内" }).click();
  const planned = picker.getByLabel("计划内课程");
  await expect(planned).toContainText("微观经济学");
  await expect(planned).toContainText("30/60 · 余 30");
  await expect(planned.getByRole("link", { name: "4.3 · 7 条" })).toBeVisible();
  await planned.getByRole("button", { name: "加入课表" }).first().click();
  await expect(courseList(page)).toContainText("微观经济学");

  await picker.getByRole("tab", { name: "公共选修" }).click();
  await picker.getByLabel("公共选修").getByRole("button", { name: "加入课表" }).click();
  await expect(courseList(page)).toContainText("书法鉴赏");

  const timetable = page.getByRole("grid", { name: "周课表" });
  await expect(timetable.getByText("高等数学（教师甲）").first()).toBeVisible();
  await expect(timetable.getByText("微观经济学（教师辰）").first()).toBeVisible();
  await expect(timetable.getByText("书法鉴赏（教师巳）").first()).toBeVisible();

  await picker.getByRole("tab", { name: "计划内" }).click();
  await picker.getByLabel("计划内课程").getByRole("button", { name: "加入课表" }).click();
  await expect(page.getByRole("alert")).toContainText("冲突课");
  await expect(page.getByRole("alert")).toContainText("未加入");

  await picker.getByRole("button", { name: "完成" }).click();
  await page.getByRole("button", { name: "保存课表" }).click();
  await expect(page.getByText("课表已保存到本机")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学（教师甲）").first()).toBeVisible();
  await expect(courseList(page)).toContainText("微观经济学");
  await expect(courseList(page)).toContainText("书法鉴赏");

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学（教师甲）").first()).toBeVisible();
  const direction = await page.getByRole("region", { name: "课程与开课班" }).evaluate((el) => getComputedStyle(el).flexDirection);
  expect(direction).toBe("column");
});

test("switches candidate data only between cached selections", async ({ page }) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await seedCachedSelection(page, snapshotJson, true);

  await chooseFilter(page, "年级", "2023");
  await expect(page.getByText("请先选择专业")).toBeVisible();
  await expect(page.getByRole("button", { name: "选择课程" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "计划内" })).toHaveCount(0);
  await chooseFilter(page, "专业", "数学与应用数学");
  const emptyPicker = await openCoursePicker(page);
  await emptyPicker.getByRole("tab", { name: "计划内" }).click();
  await expect(emptyPicker.getByLabel("计划内课程")).toHaveCount(0);
  await expect(emptyPicker.getByText("暂无数据")).toBeVisible();
  await expect(emptyPicker).not.toContainText("微观经济学");
  await emptyPicker.getByRole("button", { name: "完成" }).click();

  await seedCachedSelection(page, secondSelectionJson);
  const secondPicker = await openCoursePicker(page);
  await secondPicker.getByRole("tab", { name: "计划内" }).click();
  await expect(secondPicker.getByLabel("计划内课程")).toContainText("数据结构");
  await secondPicker.getByRole("button", { name: "完成" }).click();

  await chooseFilter(page, "年级", "2024");
  await expect(page.getByText("请先选择专业")).toBeVisible();
  await chooseFilter(page, "专业", "数学与应用数学");
  const year2024 = await openCoursePicker(page);
  await year2024.getByRole("tab", { name: "计划内" }).click();
  await expect(year2024.getByLabel("计划内课程")).toContainText("微观经济学");
  await expect(year2024.getByLabel("计划内课程")).not.toContainText("数据结构");
  await year2024.getByRole("button", { name: "完成" }).click();

  await chooseFilter(page, "年级", "2023");
  await chooseFilter(page, "专业", "数学与应用数学");
  const year2023 = await openCoursePicker(page);
  await year2023.getByRole("tab", { name: "计划内" }).click();
  await expect(year2023.getByLabel("计划内课程")).toContainText("数据结构");
});

test("hides planned and public tables until a major is selected", async ({ page }) => {
  const unsetMajor = {
    ...JSON.parse(snapshotJson),
    major: { id: "", label: "" },
  };
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await seedCachedSelection(page, JSON.stringify(unsetMajor), true);
  await expect(page.getByText("请先选择专业")).toBeVisible();
  await expect(page.getByRole("button", { name: "选择课程" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "计划内" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "公共选修" })).toHaveCount(0);
  await expect(courseList(page)).toContainText("高等数学");
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

test("guest can see a cached plan but must log in to refresh", async ({ page }) => {
  await mockScheduleApi(page, false);
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [
      SCHEDULE_PLAN_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeTermId: "2025-2026-2",
        terms: {
          "2025-2026-2": [
            {
              key: "2025-2026-2+10100001+01",
              termId: "2025-2026-2",
              courseCode: "10100001",
              courseName: "高等数学",
              section: "01",
              teacherName: "教师甲",
              origin: "enrolled",
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
              courseId: -1,
              teacherId: -1,
              rating: null,
              reviewCount: 0,
            },
          ],
        },
      }),
    ],
  );
  await page.goto("/schedule");
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学（教师甲）").first()).toBeVisible();
  await page.getByRole("button", { name: "刷新教务数据" }).click();
  const loginDialog = page.getByRole("dialog");
  await expect(loginDialog).toContainText("刷新需要先登录");
  await loginDialog.getByRole("link", { name: "去登录" }).click();
  await expect(page).toHaveURL(/\/login\?from=%2Fschedule/);
});

test("same-course swap is atomic and exclusion survives cached refresh", async ({ page }) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await seedCachedSelection(page, snapshotJson, true);
  await courseList(page).getByRole("button", { name: "排除" }).click();
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学")).toHaveCount(0);
  await seedCachedSelection(page, snapshotJson);
  await expect(courseList(page)).toContainText("已排除");
  await courseList(page).getByRole("button", { name: "高等数学" }).click();
  await sectionList(page).getByRole("button", { name: "换班" }).click();
  await expect(courseList(page)).toContainText("班03");
  await expect(courseList(page)).not.toContainText("班01");
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
