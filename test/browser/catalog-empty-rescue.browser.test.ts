/**
 * Browser coverage for Issue #287: empty catalog hints at the other catalog.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

type MockOptions = {
  coursesTotal?: number;
  teachersTotal?: number;
  failTeachersRescue?: boolean;
  failCoursesRescue?: boolean;
};

function isRescueList(url: URL, pageSize: string) {
  return (
    url.searchParams.get("pageSize") === pageSize &&
    Boolean(url.searchParams.get("q"))
  );
}

async function fulfillOk(route: Route, json: unknown) {
  return route.fulfill({ json });
}

async function mockCatalogApi(page: Page, options: MockOptions = {}) {
  const coursesTotal = options.coursesTotal ?? 0;
  const teachersTotal = options.teachersTotal ?? 0;

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return fulfillOk(route, {
        siteName: "非官方课评@JUFE",
        universityName: "江西财经大学",
        admin: false,
      });
    }
    if (url.pathname === "/api/user/session") {
      return fulfillOk(route, {
        authenticated: false,
        loginPath: "/login",
        logoutPath: "/logout",
      });
    }
    if (url.pathname === "/api/courses") {
      if (isRescueList(url, "1")) {
        if (options.failCoursesRescue) {
          return route.fulfill({
            status: 500,
            json: { error: "courses rescue failed" },
          });
        }
        return fulfillOk(route, {
          items: [],
          page: 1,
          pageSize: 1,
          total: coursesTotal,
          pages: coursesTotal > 0 ? 1 : 0,
        });
      }
      return fulfillOk(route, {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
        pages: 1,
      });
    }
    if (url.pathname === "/api/teachers") {
      if (isRescueList(url, "1")) {
        if (options.failTeachersRescue) {
          return route.fulfill({
            status: 500,
            json: { error: "teachers rescue failed" },
          });
        }
        return fulfillOk(route, {
          items: [],
          page: 1,
          pageSize: 1,
          total: teachersTotal,
          pages: teachersTotal > 0 ? 1 : 0,
        });
      }
      return fulfillOk(route, {
        items: [],
        page: 1,
        pageSize: 50,
        total: 0,
        pages: 1,
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

function trackTeacherRescueRequests(page: Page) {
  const searches: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname !== "/api/teachers") return;
    if (isRescueList(url, "1")) searches.push(url.search);
  });
  return searches;
}

test("courses empty query hints at matching teachers", async ({ page }) => {
  await mockCatalogApi(page, { teachersTotal: 3 });
  await page.goto("/courses?q=张三");

  await expect(page.getByText("没有找到匹配「张三」的课程")).toBeVisible();
  const rescue = page.getByRole("link", {
    name: "教师资料有 3 位匹配，去查看",
  });
  await expect(rescue).toBeVisible();
  await expect(rescue).toHaveAttribute("href", /\/teachers\?q=/);
  expect(decodeURIComponent((await rescue.getAttribute("href")) ?? "")).toBe(
    "/teachers?q=张三",
  );
});

test("courses empty with a category filter does not fetch teacher rescue", async ({
  page,
}) => {
  const teacherRescue = trackTeacherRescueRequests(page);
  await mockCatalogApi(page, { teachersTotal: 3 });
  await page.goto("/courses?q=张三&category=sports");

  await expect(page.getByText("没有找到匹配「张三」的课程")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("link", { name: /教师资料有 \d+ 位匹配/ }),
  ).toHaveCount(0);
  expect(teacherRescue).toEqual([]);
});

test("teachers empty query hints at matching courses", async ({ page }) => {
  await mockCatalogApi(page, { coursesTotal: 2 });
  await page.goto("/teachers?q=高数");

  await expect(page.getByText("没有找到匹配「高数」的教师")).toBeVisible();
  const rescue = page.getByRole("link", {
    name: "课程目录有 2 门匹配，去查看",
  });
  await expect(rescue).toBeVisible();
  await expect(rescue).toHaveAttribute("href", /\/courses\?q=/);
  expect(decodeURIComponent((await rescue.getAttribute("href")) ?? "")).toBe(
    "/courses?q=高数",
  );
});

test("opposite catalog 500 keeps the original empty copy", async ({ page }) => {
  await mockCatalogApi(page, { failTeachersRescue: true, teachersTotal: 3 });
  const rescueFailed = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/teachers" &&
      isRescueList(url, "1") &&
      response.status() === 500
    );
  });
  await page.goto("/courses?q=张三");
  await rescueFailed;

  const empty = page
    .getByRole("status")
    .filter({ hasText: "没有找到匹配「张三」的课程" });
  await expect(empty).toBeVisible();
  // 对侧 500 不改空态：仍用本目录的筛选点名文案（Issue #276），不出现救援链接。
  await expect(empty).toContainText("试试调整或清空当前筛选：关键词“张三”。");
  await expect(
    page.getByRole("link", { name: /教师资料有 \d+ 位匹配/ }),
  ).toHaveCount(0);
});
