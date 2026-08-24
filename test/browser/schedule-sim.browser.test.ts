import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEDULE_PLAN_STORAGE_KEY } from "../../src/lib/schedule-plan";

const snapshotJson = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/jwxt/snapshot.v1.json"),
  "utf8",
);
const loginExpiredHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/jwxt/login-expired.html"),
  "utf8",
);

async function mockScheduleApi(page: Page, authenticated = true) {
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
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

async function importSnapshot(page: Page, text: string) {
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "刷新教务数据" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "刷新教务数据" })).toBeVisible();
  await dialog.getByPlaceholder(/browser-export/).fill(text);
  await dialog.getByRole("button", { name: "导入快照" }).click();
}

test("manual refresh, filters, enrolled, two candidate kinds, place, persist @mobile-smoke", async ({
  page,
}) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await expect(page.getByText("还没有教务数据")).toBeVisible();

  await importSnapshot(page, snapshotJson);
  await expect(page.getByText("已导入教务快照")).toBeVisible();
  await expect(page.getByText("年级", { exact: true })).toBeVisible();
  await expect(page.getByText("专业", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "已选" })).toBeVisible();
  await expect(page.getByLabel("已选课程")).toContainText("高等数学");

  await page.getByRole("tab", { name: "计划内" }).click();
  const planned = page.getByLabel("计划内课程");
  await expect(planned).toContainText("微观经济学");
  await planned.getByRole("button", { name: "加入课表" }).first().click();
  await expect(page.getByLabel("本学期计划")).toContainText("微观经济学");

  await page.getByRole("tab", { name: "公共选修" }).click();
  await page.getByLabel("公共选修").getByRole("button", { name: "加入课表" }).click();
  await expect(page.getByLabel("本学期计划")).toContainText("书法鉴赏");

  const timetable = page.getByRole("grid", { name: "周课表" });
  await expect(timetable.getByText("高等数学（教师甲）").first()).toBeVisible();
  await expect(timetable.getByText("微观经济学（教师辰）").first()).toBeVisible();
  await expect(timetable.getByText("书法鉴赏（教师巳）").first()).toBeVisible();

  await page.getByRole("tab", { name: "计划内" }).click();
  await page.getByLabel("计划内课程").getByRole("button", { name: "加入课表" }).click();
  await expect(page.getByRole("alert")).toContainText("冲突课");
  await expect(page.getByRole("alert")).toContainText("未加入");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出快照" }).click(),
  ]);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const exported = readFileSync(downloadPath!, "utf8");
  expect(exported).toContain('"source": "browser-export"');
  expect(exported).not.toMatch(/CASTGC|JSESSIONID|cookie|学号|姓名/i);

  await page.reload();
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学（教师甲）").first()).toBeVisible();
  await expect(page.getByLabel("本学期计划")).toContainText("微观经济学");
  await expect(page.getByLabel("本学期计划")).toContainText("书法鉴赏");

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学（教师甲）").first()).toBeVisible();
  const layout = await page.locator("section").evaluate((section) => {
    const grid = section.querySelector(".grid");
    return grid ? getComputedStyle(grid).gridTemplateColumns : "";
  });
  expect(layout.split(" ").length).toBe(1);
});

test("login-expired fixture surfaces session expiry without writing a snapshot", async ({
  page,
}) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await importSnapshot(page, loginExpiredHtml);
  await expect(page.getByText("教务登录已失效", { exact: true })).toBeVisible();
  await expect(page.getByText("还没有教务数据")).toBeVisible();
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

test("same-course swap is atomic and exclude survives a second import", async ({ page }) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await importSnapshot(page, snapshotJson);
  await page.getByRole("tab", { name: "已选" }).click();
  await page.getByLabel("已选课程").getByRole("button", { name: "排除" }).click();
  await expect(page.getByRole("grid", { name: "周课表" }).getByText("高等数学")).toHaveCount(0);
  await importSnapshot(page, snapshotJson);
  await expect(page.getByLabel("本学期计划")).toContainText("已排除");
  await page.getByRole("tab", { name: "计划内" }).click();
  await page.getByLabel("计划内课程").getByRole("button", { name: "换班" }).click();
  await expect(page.getByLabel("本学期计划")).toContainText("班03");
  await expect(page.getByLabel("本学期计划")).not.toContainText("班01");
});
