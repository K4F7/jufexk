import { expect, test, type Page } from "@playwright/test";
import {
  encodeJwxtImportPayload,
  JWXT_IMPORT_HASH_PREFIX,
} from "../../src/lib/jwxt-schedule-text";
import { SCHEDULE_PLAN_STORAGE_KEY } from "../../src/lib/schedule-plan";

const relations = [
  {
    course_id: 8,
    code: "MA101",
    name: "高等数学",
    category: "general",
    department: "数学",
    teacher_id: 9,
    teacher_name: "张三",
    rating: 4.2,
    review_count: 6,
  },
  {
    course_id: 10,
    code: "MA102",
    name: "线性代数",
    category: "general",
    department: "数学",
    teacher_id: 11,
    teacher_name: "李四",
    rating: 3.8,
    review_count: 4,
  },
];

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
    if (url.pathname === "/api/courses") {
      return route.fulfill({
        json: {
          items: url.searchParams.get("q") ? relations : [],
          page: 1,
          pageSize: 20,
          total: url.searchParams.get("q") ? relations.length : 0,
          pages: 1,
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test("search, stage, place two courses on the same slot, and keep the plan", async ({
  page,
}) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");

  const search = page.getByRole("searchbox", { name: "搜索要排的课程" });
  await search.fill("高等数学");
  await search.press("Enter");

  const results = page.getByRole("list", { name: "搜索结果" });
  await expect(results.getByText("高等数学")).toBeVisible();
  await expect(results.getByText("线性代数")).toBeVisible();

  await results.getByRole("button", { name: "加入课表" }).nth(0).click();
  await results.getByRole("button", { name: "加入课表" }).nth(0).click();

  const staged = page.getByLabel("已选课程");
  await expect(staged.getByRole("link", { name: "高等数学（张三）" })).toBeVisible();
  await expect(staged.getByRole("link", { name: "线性代数（李四）" })).toBeVisible();

  await staged.getByRole("button", { name: "排上" }).nth(0).click();
  await staged.getByRole("button", { name: "排上" }).nth(1).click();

  await expect(page.getByRole("alert")).toContainText(
    "高等数学（张三）与线性代数（李四）在周一第1–2节冲突",
  );
  const timetable = page.getByRole("grid", { name: "周课表" });
  await expect(timetable.getByText("冲突").first()).toBeVisible();

  await page.reload();
  await expect(timetable.getByText("高等数学（张三）").first()).toBeVisible();
  await expect(timetable.getByText("线性代数（李四）").first()).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("冲突");
});

test("opens the official jwxt door and imports pasted class times locally", async ({
  page,
}) => {
  await mockScheduleApi(page);
  await page.goto("/schedule");
  await page.getByRole("button", { name: "从本科教务导入" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "打开本科教务" })).toHaveAttribute(
    "href",
    "https://jwxt.jxufe.edu.cn/jxcjcaslogin",
  );
  await dialog.getByPlaceholder("高等数学 张三 星期一 第1-2节").fill(
    "高等数学 张三 星期一 第1-2节",
  );
  await dialog.getByRole("button", { name: "导入粘贴内容" }).click();
  await expect(page.getByRole("status")).toContainText("已从本科教务导入");
  await expect(page.getByLabel("已选课程").getByRole("link", { name: "高等数学（张三）" })).toBeVisible();
  await expect(
    page.getByRole("grid", { name: "周课表" }).getByText("高等数学（张三）").first(),
  ).toBeVisible();
});

test("imports class times from the jwxt-import hash without sending cookies", async ({
  page,
}) => {
  await mockScheduleApi(page);
  const hash = `${JWXT_IMPORT_HASH_PREFIX}${encodeJwxtImportPayload({
    v: 1,
    rows: [
      {
        courseName: "高等数学",
        courseCode: "",
        teacherName: "张三",
        weekText: "",
        timeText: "星期二 第3-4节",
      },
    ],
  })}`;
  await page.goto(`/schedule#${hash}`);
  await expect(page.getByRole("status")).toContainText("已从本科教务导入");
  await expect(
    page.getByRole("grid", { name: "周课表" }).getByText("高等数学（张三）").first(),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/jwxt-import/);
});

test("guest can see courses but must log in to add or import", async ({
  page,
}) => {
  await mockScheduleApi(page, false);
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [
      SCHEDULE_PLAN_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        courses: [
          {
            id: "8:9",
            courseId: 8,
            courseCode: "MA101",
            courseName: "高等数学",
            teacherId: 9,
            teacherName: "张三",
            rating: 4.2,
            reviewCount: 6,
            slots: [
              {
                id: "8:9:1:1:2",
                weekday: 1,
                startPeriod: 1,
                endPeriod: 2,
                weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
              },
            ],
          },
        ],
      }),
    ],
  );
  await page.goto("/schedule");

  await expect(page.getByText("提前处理掉早八刺客")).toBeVisible();
  await expect(page.getByText("查看课表不用登录")).toHaveCount(0);
  await expect(page.getByText("输入课程或教师名后回车，从公开目录加入。")).toHaveCount(0);
  await expect(page.getByText("常用作息，仅供模拟")).toHaveCount(0);
  await expect(
    page.getByRole("grid", { name: "周课表" }).getByText("高等数学（张三）").first(),
  ).toBeVisible();

  const search = page.getByRole("searchbox", { name: "搜索要排的课程" });
  await search.fill("高等数学");
  await search.press("Enter");
  const results = page.getByRole("list", { name: "搜索结果" });
  await expect(results.getByText("线性代数")).toBeVisible();
  await results.getByRole("button", { name: "加入课表" }).click();
  await expect(page.getByLabel("已选课程").getByText("线性代数")).toHaveCount(0);

  await page.getByRole("button", { name: "从本科教务导入" }).click();
  const loginDialog = page.getByRole("dialog");
  await expect(loginDialog).toContainText("导入需要先登录");
  await expect(page.getByRole("link", { name: "打开本科教务" })).toHaveCount(0);
  await loginDialog.getByRole("button", { name: "去登录" }).click();
  await expect(page).toHaveURL(/\/login\?from=%2Fschedule/);
});

test("guest hash import waits for login and does not write the plan", async ({
  page,
}) => {
  await mockScheduleApi(page, false);
  const hash = `${JWXT_IMPORT_HASH_PREFIX}${encodeJwxtImportPayload({
    v: 1,
    rows: [
      {
        courseName: "高等数学",
        courseCode: "",
        teacherName: "张三",
        weekText: "",
        timeText: "星期二 第3-4节",
      },
    ],
  })}`;
  await page.goto(`/schedule#${hash}`);
  await expect(page.getByText("查看课表不用登录")).toHaveCount(0);
  await expect(page.getByText("已从本科教务导入")).toHaveCount(0);
  await expect(page.getByLabel("已选课程")).toHaveCount(0);
  await expect(page).not.toHaveURL(/jwxt-import/);
});
