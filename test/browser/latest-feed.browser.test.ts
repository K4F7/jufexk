/**
 * Browser coverage for /latest：全站最新公开课评流。
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  REVIEW_FOLD_LABEL,
  REVIEW_PUBLIC_FOLD_EXPAND_LABEL,
} from "../../src/lib/recognition";

const LATEST = [
  {
    id: "review:12",
    course_id: 8,
    teacher_id: 9,
    course_name: "中国传统文化导论",
    course_code: "GEN0108",
    teacher_name: "测试教师",
    comment: "这门课讲得很清楚，作业量适中。",
    headline: "讲得清楚，作业适中",
    created_at: "2026-08-20 12:00:00",
    author_public_code: 0,
    author_avatar_key: 0,
  },
  {
    id: "historical:abc",
    course_id: 11,
    teacher_id: 12,
    course_name: "篮球",
    course_code: "PE0101",
    teacher_name: "体育教师",
    comment: "课堂气氛好，考试不难。",
    created_at: "2026-08-11 02:00:00",
  },
  {
    id: "review:91",
    course_id: 8,
    teacher_id: 9,
    course_name: "中国茶文化和茶艺",
    course_code: "GEN0201",
    teacher_name: "艾晓玉",
    comment: "折叠正文仍应出现在课评流。",
    headline: "折叠演示：不受欢迎",
    created_at: "2026-08-10 00:00:00",
  },
];

async function mockShellApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "非官方课评@JUFE", universityName: "江西财经大学", admin: false },
      });
    if (url.pathname === "/api/user/session")
      return route.fulfill({
        json: { authenticated: false, loginPath: "/login", logoutPath: "/logout" },
      });
    if (url.pathname === "/api/reviews/latest") {
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        return route.fulfill({
          json: { items: [LATEST[1]], nextCursor: null },
        });
      }
      return route.fulfill({
        json: { items: [LATEST[0], LATEST[2]], nextCursor: "next-latest" },
      });
    }
    if (url.pathname === "/api/courses" || url.pathname === "/api/teachers")
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
            teachers: [{ id: 9, name: "测试教师", review_count: 1, rating: 4.6 }],
          },
          reviewCount: 1,
        },
      });
    if (url.pathname === "/api/courses/8/reviews")
      return route.fulfill({
        json: {
          items: [
            {
              id: "review:12",
              course_id: 8,
              teacher_id: 9,
              comment: "这门课讲得很清楚，作业量适中。",
            },
          ],
          nextCursor: null,
        },
      });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

function firstLatestArticle(page: Page) {
  return page
    .locator("article")
    .filter({ has: page.getByRole("link", { name: "匿名用户#000000" }) })
    .first();
}

async function expectStackedAuthorLayout(article: Locator) {
  const author = article.getByRole("link", { name: "匿名用户#000000" });
  const date = article.locator("time");
  const headline = article.getByText("讲得清楚，作业适中");
  await expect(author).toBeVisible();
  await expect(date).toBeVisible();
  await expect(headline).toBeVisible();

  const authorBox = await author.boundingBox();
  const dateBox = await date.boundingBox();
  const headlineBox = await headline.boundingBox();
  expect(authorBox).toBeTruthy();
  expect(dateBox).toBeTruthy();
  expect(headlineBox).toBeTruthy();
  expect(Math.abs((authorBox?.y ?? 0) - (dateBox?.y ?? 0))).toBeLessThan(12);
  expect(headlineBox?.y ?? 0).toBeGreaterThan((authorBox?.y ?? 0) + (authorBox?.height ?? 0) / 2);
  expect(headlineBox?.x ?? 0).toBeLessThanOrEqual((authorBox?.x ?? 0) + 24);
}

test("latest page lists newest public reviews and deep-links to the course", async ({
  page,
}) => {
  const feedRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/reviews/latest")
      feedRequests.push(request.url());
  });

  await mockShellApi(page);
  await page.goto("/latest", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "最新课评" })).toBeVisible();
  const article = firstLatestArticle(page);
  const author = article.getByRole("link", { name: "匿名用户#000000" });
  await expect(author).toBeVisible();
  await expect(author).toContainText("匿");
  const authorBox = await author.boundingBox();
  expect(authorBox?.height).toBeGreaterThan(0);
  expect(await page.getByText("点评了").count()).toBeGreaterThanOrEqual(1);
  await expect(
    article.getByRole("link", { name: "中国传统文化导论（测试教师）" }),
  ).toBeVisible();
  await expect(article.getByText("2026-08-20")).toBeVisible();
  // 有 headline 的条目优先展示 headline 作为摘要，不再显示正文。
  await expect(article.getByText("讲得清楚，作业适中")).toBeVisible();
  await expect(
    article.getByText("这门课讲得很清楚，作业量适中。"),
  ).toHaveCount(0);
  expect(feedRequests.length).toBeGreaterThan(0);

  await article.getByRole("link", { name: "查看全文" }).click();
  await expect(page).toHaveURL(/\/courses\/8\?teacher=9/);
  await expect(
    page.getByRole("heading", { name: /中国传统文化导论（测试教师）/ }),
  ).toBeVisible();
});

test("latest author and date share a header row on desktop and mobile", async ({
  page,
}) => {
  await mockShellApi(page);
  await page.setViewportSize({ width: 800, height: 720 });
  await page.goto("/latest", { waitUntil: "domcontentloaded" });

  const article = firstLatestArticle(page);
  await expectStackedAuthorLayout(article);
  await expect(article.getByRole("link", { name: "查看全文" })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 720 });
  await expectStackedAuthorLayout(article);
  await expect(article.getByRole("link", { name: "查看全文" })).toBeVisible();
  await expect(page.getByRole("link", { name: "更多" })).toHaveCount(0);
});

test("latest feed shows threshold-folded reviews without 收起 chrome", async ({
  page,
}) => {
  await mockShellApi(page);
  await page.goto("/latest", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "最新课评" })).toBeVisible();
  await expect(page.getByText("折叠演示：不受欢迎")).toBeVisible();
  await expect(page.getByText(REVIEW_FOLD_LABEL)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: REVIEW_PUBLIC_FOLD_EXPAND_LABEL }),
  ).toHaveCount(0);
});

test("latest empty state keeps the official Card composition", async ({ page }) => {
  await mockShellApi(page);
  await page.route("**/api/reviews/latest", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/latest", { waitUntil: "domcontentloaded" });

  const emptyState = page.getByRole("status");
  await expect(emptyState).toHaveAttribute("data-slot", "card");
  await expect(emptyState).toContainText("暂时还没有公开课评");
});

test("latest feed falls back to comment text when headline is empty", async ({
  page,
}) => {
  await mockShellApi(page);
  await page.goto("/latest", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("讲得清楚，作业适中").first()).toBeVisible();

  // 历史行没有 headline（服务端投影为空串），哨兵在视口内时自动取下一页。
  await expect(page.getByText("课堂气氛好，考试不难。")).toBeVisible();
});

test("latest reserves review space while the first page is loading", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: { siteName: "非官方课评@JUFE", universityName: "江西财经大学", admin: false },
      });
    }
    if (url.pathname === "/api/user/session") {
      return route.fulfill({
        json: { authenticated: false, loginPath: "/login", logoutPath: "/logout" },
      });
    }
    if (url.pathname === "/api/site/banner") {
      return route.fulfill({ json: { desktopHtml: "", mobileHtml: "", updatedAt: null } });
    }
    if (url.pathname === "/api/reviews/latest") {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return route.fulfill({
        json: {
          items: Array.from({ length: 20 }, (_, index) => ({
            ...LATEST[0],
            id: LATEST[0].id + index,
          })),
          nextCursor: null,
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });

  await page.goto("/latest", { waitUntil: "domcontentloaded" });
  const loading = page.getByRole("status", { name: "正在加载最新课评" });
  await expect(loading).toBeVisible();
  const skeletonRows = loading.locator("article");
  await expect(skeletonRows).toHaveCount(20);
  await expect(skeletonRows.first()).toBeVisible();
  await expect(skeletonRows.first()).toHaveClass(/min-h-\[22rem\]/);
  const footerBefore = await page.getByRole("contentinfo").boundingBox();
  expect(footerBefore?.y).toBeGreaterThan(400);
  await expect(page.getByText("讲得清楚，作业适中").first()).toBeVisible();
  const footerAfter = await page.getByRole("contentinfo").boundingBox();
  if ((page.viewportSize()?.width ?? 1280) < 640) {
    const rows = await page.locator("main > section article").evaluateAll((els) =>
      els.map((element) => element.getBoundingClientRect().height),
    );
    expect(rows).toHaveLength(20);
    expect(Math.min(...rows)).toBeGreaterThanOrEqual(287);
  }
  expect(Math.abs((footerAfter?.y ?? 0) - (footerBefore?.y ?? 0))).toBeLessThan(2);
});

test("latest content renders while the viewer session is still pending", async ({ page }) => {
  let releaseSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await mockShellApi(page);
  await page.route("**/api/user/session", async (route) => {
    await sessionGate;
    return route.fulfill({
      json: { authenticated: false, loginPath: "/login", logoutPath: "/logout" },
    });
  });

  await page.goto("/latest", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("讲得清楚，作业适中")).toBeVisible();
  releaseSession();
});

test("latest does not load the table chunk or eagerly load the status iframe", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await mockShellApi(page);
  await page.goto("/latest", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "最新课评" })).toBeVisible();
  expect(requests.some((url) => url.includes("table-"))).toBe(false);
  expect(requests.some((url) => url.includes("scroll-shadow-"))).toBe(false);
  expect(requests.some((url) => url.includes("heroui-deferred"))).toBe(false);
  expect(requests.some((url) => url.includes("purify"))).toBe(false);
  const latestRequests = requests.filter(
    (url) => new URL(url).pathname === "/api/reviews/latest",
  );
  expect(latestRequests.length).toBeGreaterThanOrEqual(1);
  expect(latestRequests.length).toBeLessThanOrEqual(2);
  await expect(page.getByTitle("系统运行状态")).toHaveCount(0);
});

test("latest reuses the HTML-bootstrap banner request", async ({ page }) => {
  let bannerRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/site/banner") {
      bannerRequests += 1;
    }
  });
  await mockShellApi(page);
  await page.route("**/api/site/banner", (route) =>
    route.fulfill({
      json: {
        desktopHtml: "<p>桌面公告</p>",
        mobileHtml: "<p>移动公告</p>",
        updatedAt: "2026-08-30 00:00:00",
      },
    }),
  );

  await page.goto("/latest", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: "全站公告" })).toBeVisible();
  expect(bannerRequests).toBe(1);
});

test("latest keeps the main column stable while a non-empty banner loads", async ({
  page,
}) => {
  let releaseBanner!: () => void;
  const bannerGate = new Promise<void>((resolve) => {
    releaseBanner = resolve;
  });
  await mockShellApi(page);
  await page.route("**/api/site/banner", async (route) => {
    await bannerGate;
    return route.fulfill({
      json: {
        desktopHtml: "<p>桌面公告</p>",
        mobileHtml: "<p>移动公告</p>",
        updatedAt: "2026-08-30 00:00:00",
      },
    });
  });

  await page.goto("/latest", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("讲得清楚，作业适中")).toBeVisible();
  const mainBefore = await page.locator("main").boundingBox();
  const footerBefore = await page.getByRole("contentinfo").boundingBox();
  expect(mainBefore).toBeTruthy();
  expect(footerBefore).toBeTruthy();

  releaseBanner();
  await expect(page.getByRole("region", { name: "全站公告" })).toBeVisible();
  const mainAfter = await page.locator("main").boundingBox();
  const footerAfter = await page.getByRole("contentinfo").boundingBox();
  expect(mainAfter?.y).toBe(mainBefore?.y);
  expect(footerAfter?.y).toBe(footerBefore?.y);
});

test("latest feed keeps 继续加载 as a retry after an auto-load error", async ({
  page,
}) => {
  let cursorCalls = 0;
  await mockShellApi(page);
  await page.route("**/api/reviews/latest*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/reviews/latest") return route.fallback();
    const cursor = url.searchParams.get("cursor");
    if (!cursor) {
      return route.fulfill({
        json: { items: [LATEST[0]], nextCursor: "next-latest" },
      });
    }
    cursorCalls += 1;
    if (cursorCalls === 1) {
      return route.fulfill({ status: 500, json: { error: "继续加载失败" } });
    }
    return route.fulfill({
      json: { items: [LATEST[1]], nextCursor: null },
    });
  });

  await page.goto("/latest", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("alert")).toContainText("继续加载失败");
  await expect.poll(() => cursorCalls).toBe(1);
  await page.waitForTimeout(400);
  expect(cursorCalls).toBe(1);

  await page.getByRole("button", { name: "继续加载" }).click();
  await expect(page.getByText("课堂气氛好，考试不难。")).toBeVisible();
  expect(cursorCalls).toBe(2);
});

test("latest feed column aligns with the course catalog @mobile-smoke", async ({ page }) => {
  await mockShellApi(page);
  await page.goto("/latest", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "最新课评" })).toBeVisible();
  const latest = await page.locator("main > section").boundingBox();

  await page.goto("/courses");
  await expect(page.getByRole("heading", { name: "课程列表" })).toBeVisible();
  const courses = await page.locator("main > section").boundingBox();

  expect(latest).toBeTruthy();
  expect(courses).toBeTruthy();
  expect(latest?.x).toBe(courses?.x);
  expect(latest?.width).toBe(courses?.width);
});