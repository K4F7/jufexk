/**
 * 评论区浏览器覆盖：默认收起、评论按钮展开/收起、点回复聚焦回复框并带
 * 「回复 #公开编号」引用、preview 本地提交；以及 live 模式下展开拉取
 * /api/reviews/:id/comments、回复提交带上 parentCommentId（后端据此发
 * review_comment_replied 站内消息，通知断言行在 test/review-comments.test.ts）。
 */
import { expect, test, type Page } from "@playwright/test";

async function mockShellApi(page: Page, authenticated = false) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: {
          siteName: "非官方课评@JUFE",
          universityName: "江西财经大学",
          admin: false,
        },
      });
    if (url.pathname === "/api/user/session")
      return route.fulfill({
        json: authenticated
          ? {
              authenticated: true,
              loginPath: "/login",
              logoutPath: "/logout",
              handle: "匿名用户#000007",
              csrfToken: "browser-test-csrf",
            }
          : {
              authenticated: false,
              loginPath: "/login",
              logoutPath: "/logout",
            },
      });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

function reviewItems(page: Page) {
  return page.getByRole("list", { name: "评价列表" }).getByRole("listitem");
}

test("comments are collapsed by default and the toggle expands and collapses the thread", async ({
  page,
}) => {
  await mockShellApi(page);
  await page.goto("/courses/8?teacher=2&preview=review-comments");

  const first = reviewItems(page).first();
  const toggle = first.getByRole("button", { name: "评论，当前 2 条回复" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // 默认收起：回复正文与输入框都不渲染。
  await expect(first.getByText("作业量确实适中，期中那套例题很有用。")).toHaveCount(0);
  await expect(first.getByLabel("你的评论")).toHaveCount(0);

  await toggle.click();
  const expanded = first.getByRole("button", { name: "收起评论，当前 2 条回复" });
  await expect(expanded).toHaveAttribute("aria-expanded", "true");
  await expect(first.getByText("作业量确实适中，期中那套例题很有用。")).toBeVisible();
  // 展开后输入框直接聚焦，方便马上写自己的评论。
  await expect(first.getByRole("textbox", { name: "你的评论" })).toBeFocused();
  // 楼中楼引用：第二条回复带蓝名 @匿名用户#000002。
  await expect(first.getByRole("link", { name: "@匿名用户#000002" })).toBeVisible();

  await expanded.click();
  await expect(
    first.getByRole("button", { name: "评论，当前 2 条回复" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(first.getByText("作业量确实适中，期中那套例题很有用。")).toHaveCount(0);
});

test("replying to a comment opens the thread, targets the reply and posts it locally in preview", async ({
  page,
}) => {
  await mockShellApi(page);
  await page.goto("/courses/8?teacher=2&preview=review-comments");

  const first = reviewItems(page).first();
  await first.getByRole("button", { name: "评论，当前 2 条回复" }).click();

  // 点第一条回复的「回复」：回复框切换为回复目标并聚焦。
  await first.getByRole("button", { name: "回复 匿名用户#000002" }).click();
  const composer = first.getByRole("textbox", { name: "回复 @匿名用户#000002" });
  await expect(composer).toBeFocused();
  await expect(first.getByText("@匿名用户#000002").first()).toBeVisible();

  await composer.fill("同感，例题命中考点。");
  await first.getByRole("button", { name: "回复", exact: true }).click();

  // 新回复带引用出现在列表里，计数随之更新。
  await expect(first.getByText("同感，例题命中考点。")).toBeVisible();
  await expect(
    first.getByRole("button", { name: "收起评论，当前 3 条回复" }),
  ).toBeVisible();

  // 框内引用在空内容时退格，改回回复楼主。
  await first.getByRole("button", { name: "回复 匿名用户#000002" }).click();
  await expect(first.getByRole("textbox", { name: "回复 @匿名用户#000002" })).toBeFocused();
  await first.getByRole("textbox", { name: "回复 @匿名用户#000002" }).press("Backspace");
  await expect(first.getByRole("textbox", { name: "你的评论" })).toBeVisible();
});

test("live mode fetches comments on expand and posts replies with the parent link", async ({
  page,
}) => {
  const commentRequests: string[] = [];
  let postedBody: Record<string, unknown> | null = null;
  await mockShellApi(page, true);
  await page.route("**/api/courses/8**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/courses/8")
      return route.fulfill({
        json: {
          course: {
            id: 8,
            code: "GEN0108",
            name: "中国传统文化导论",
            category: "general",
            department: "人文学院",
            teachers: [
              {
                id: 9,
                name: "测试教师",
                department: "人文学院",
                review_count: 1,
                rating: 4.6,
                dimensionLabels: null,
                terms: [],
                follow_count: 0,
                recommend_count: 0,
                not_recommend_count: 0,
              },
            ],
          },
          reviewCount: 1,
        },
      });
    if (url.pathname === "/api/courses/8/reviews")
      return route.fulfill({
        json: {
          items: [
            {
              id: "review:1",
              course_id: 8,
              teacher_id: 9,
              comment: "这门课的补充说明正文，长度足够进入公开流。",
              overall: 5,
              created_at: "2026-08-20 12:00:00",
              endorsement_count: 0,
              endorsable: true,
              comment_count: 1,
            },
          ],
          nextCursor: null,
          total: 1,
        },
      });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  await page.route("**/api/reviews/review:1/comments", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      commentRequests.push("GET");
      return route.fulfill({
        json: {
          items: [
            {
              id: "900",
              authorPublicCode: 2,
              authorAvatarKey: 1,
              body: "已有的一条回复",
              createdAt: "2026-08-26 18:10:00",
              parentId: null,
            },
          ],
        },
      });
    }
    if (request.method() === "POST") {
      commentRequests.push("POST");
      postedBody = request.postDataJSON();
      return route.fulfill({
        json: {
          comment: {
            id: "901",
            authorPublicCode: 7,
            authorAvatarKey: 0,
            body: String(postedBody?.body ?? ""),
            createdAt: "2026-08-27 10:00:00",
            parentId: postedBody?.parentCommentId ?? null,
          },
        },
      });
    }
    return route.fallback();
  });

  await page.goto("/courses/8?teacher=9");
  const first = reviewItems(page).first();

  // 收起时按钮已带服务端下发的回复数，但尚未拉取评论列表。
  const toggle = first.getByRole("button", { name: "评论，当前 1 条回复" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(commentRequests).toEqual([]);

  await toggle.click();
  await expect(first.getByText("已有的一条回复")).toBeVisible();
  expect(commentRequests).toEqual(["GET"]);

  // 回复他人的评论：提交带 parentCommentId，后端触发回复通知。
  await first.getByRole("button", { name: "回复 匿名用户#000002" }).click();
  const composer = first.getByRole("textbox", { name: "回复 @匿名用户#000002" });
  await expect(composer).toBeFocused();
  await composer.fill("同感，附议一楼。");
  await first.getByRole("button", { name: "回复", exact: true }).click();

  await expect(first.getByText("同感，附议一楼。")).toBeVisible();
  expect(postedBody).toEqual({ body: "同感，附议一楼。", parentCommentId: "900" });
  await expect(
    first.getByRole("button", { name: "收起评论，当前 2 条回复" }),
  ).toBeVisible();
});
