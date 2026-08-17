/**
 * Browser smoke for the DEV-only review-recognition prototype (issue #74).
 *
 * Asserts observable labels, counts, aria-pressed selected state, pending
 * disablement, failure rollback and the honest guest login prompt.
 * Prototype uses in-memory stubs only — no production write API is called.
 *
 * Locators are scoped per entry article: optimistic count transitions can
 * transiently collide with another entry's accessible name.
 */
import { expect, test, type Page } from "@playwright/test";

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { siteName: "选课志", universityName: "江西财经大学", admin: false },
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
            teachers: [{ id: 9, name: "测试教师" }],
          },
          reviewCount: 0,
        },
      });
    if (url.pathname === "/api/courses/8/reviews")
      return route.fulfill({ json: { items: [], nextCursor: null } });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

/** Scope to one demo entry by its teacher name (article aria-label). */
function entry(page: Page, teacherName: string) {
  return page.getByRole("article", { name: new RegExp(teacherName) });
}

test.beforeEach(async ({ page }) => mockApi(page));

test("initial states expose honest labels, counts and selected state", async ({
  page,
}) => {
  await page.goto("/courses/8?module=review-recognition&variant=A&teacher=9");
  const banner = page.getByRole("note");
  await expect(
    banner.getByText("A — footer 右置", { exact: true }),
  ).toBeVisible();

  // 零计数：无数字、无负面视觉，可访问名诚实说明
  const zero = entry(page, "林晓雯").getByRole("button", {
    name: "认可这条评价，还没有人认可",
  });
  await expect(zero).toBeVisible();
  await expect(zero).toHaveAttribute("aria-pressed", "false");

  // 非零计数
  await expect(
    entry(page, "陈启明").getByRole("button", {
      name: "认可这条评价，当前 3 人认可",
    }),
  ).toBeVisible();

  // 已认可：selected 状态 + 动作 + 计数
  const endorsed = entry(page, "王若舟").getByRole("button", {
    name: "已认可，按下可撤回我的认可，当前 5 人认可",
  });
  await expect(endorsed).toBeVisible();
  await expect(endorsed).toHaveAttribute("aria-pressed", "true");

  // 大计数原样显示
  await expect(
    entry(page, "赵敏").getByRole("button", {
      name: "认可这条评价，当前 128 人认可",
    }),
  ).toBeVisible();

  // 无负向术语
  await expect(page.getByText("不认可", { exact: true })).toHaveCount(0);
  await expect(page.getByText("踩", { exact: true })).toHaveCount(0);
});

test("endorse then withdraw: optimistic count, pending disabled, server confirm", async ({
  page,
}) => {
  await page.goto("/courses/8?module=review-recognition&variant=A&teacher=9");
  const demo = entry(page, "陈启明");

  await demo
    .getByRole("button", { name: "认可这条评价，当前 3 人认可" })
    .click();
  // 建立中：pending 禁用，避免重复激活；可访问名含动作 + 状态 + 计数
  await expect(
    demo.getByRole("button", { name: "正在建立认可，当前 4 人认可" }),
  ).toBeDisabled();
  // stub 确认后：selected + 计数 4
  const endorsed = demo.getByRole("button", {
    name: "已认可，按下可撤回我的认可，当前 4 人认可",
  });
  await expect(endorsed).toBeVisible();
  await expect(endorsed).toHaveAttribute("aria-pressed", "true");

  await endorsed.click();
  // 撤回中：pending 禁用；可访问名含动作 + 状态 + 计数
  await expect(
    demo.getByRole("button", { name: "正在撤回认可，当前 3 人认可" }),
  ).toBeDisabled();
  // 恢复服务器确认状态
  await expect(
    demo.getByRole("button", { name: "认可这条评价，当前 3 人认可" }),
  ).toBeVisible();
});

test("failure rolls back to the server-confirmed count with an alert", async ({
  page,
}) => {
  await page.goto("/courses/8?module=review-recognition&variant=A&teacher=9");
  const demo = entry(page, "何清");

  await demo
    .getByRole("button", { name: "认可这条评价，当前 2 人认可" })
    .click();
  await expect(demo.getByRole("alert")).toContainText(
    "认可失败，已恢复服务器确认的计数",
  );
  // 页面不留下错误计数：恢复未认可 + 原计数
  const restored = demo.getByRole("button", {
    name: "认可这条评价，当前 2 人认可",
  });
  await expect(restored).toBeVisible();
  await expect(restored).toHaveAttribute("aria-pressed", "false");
});

test("slow network keeps pending and blocks repeat activation", async ({
  page,
}) => {
  await page.goto("/courses/8?module=review-recognition&variant=A&teacher=9");

  // 慢网络建立中
  const creating = entry(page, "周慧");
  await creating
    .getByRole("button", { name: "认可这条评价，当前 1 人认可" })
    .click();
  const pendingCreate = creating.getByRole("button", {
    name: "正在建立认可，当前 2 人认可",
  });
  await expect(pendingCreate).toBeDisabled();
  // stub 永不返回：状态明确停在建立中
  await page.waitForTimeout(1000);
  await expect(pendingCreate).toBeVisible();
  await expect(pendingCreate).toBeDisabled();

  // 慢网络撤回中（已认可条目）
  const withdrawing = entry(page, "吴桐");
  await withdrawing
    .getByRole("button", {
      name: "已认可，按下可撤回我的认可，当前 4 人认可",
    })
    .click();
  const pendingWithdraw = withdrawing.getByRole("button", {
    name: "正在撤回认可，当前 3 人认可",
  });
  await expect(pendingWithdraw).toBeDisabled();
  await page.waitForTimeout(1000);
  await expect(pendingWithdraw).toBeVisible();
});

test("guest gets an honest login prompt and no state change", async ({
  page,
}) => {
  await page.goto("/courses/8?module=review-recognition&variant=A&teacher=9");

  await page.getByRole("button", { name: "未登录访客" }).click();
  const demo = entry(page, "林晓雯");
  const zero = demo.getByRole("button", { name: "认可这条评价，还没有人认可" });
  await zero.click();
  await expect(
    demo.getByText("登录后才能认可评价（原型不模拟登录流程）。"),
  ).toBeVisible();
  await expect(zero).toHaveAttribute("aria-pressed", "false");
});

test("keyboard: Enter activates the standard Button", async ({ page }) => {
  await page.goto("/courses/8?module=review-recognition&variant=A&teacher=9");

  const demo = entry(page, "林晓雯");
  await demo
    .getByRole("button", { name: "认可这条评价，还没有人认可" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    demo.getByRole("button", {
      name: "已认可，按下可撤回我的认可，当前 1 人认可",
    }),
  ).toBeVisible();
});

test("variants B and C place the control with their own count language", async ({
  page,
}) => {
  await page.goto("/courses/8?module=review-recognition&variant=B&teacher=9");
  await expect(
    page.getByRole("note").getByText("B — footer 左置", { exact: true }),
  ).toBeVisible();
  await expect(
    entry(page, "陈启明").getByRole("button", {
      name: "认可这条评价，当前 3 人认可",
    }),
  ).toBeVisible();

  await page.goto("/courses/8?module=review-recognition&variant=C&teacher=9");
  await expect(
    page.getByRole("note").getByText("C — 动作与计数分离", { exact: true }),
  ).toBeVisible();
  // C：计数为按钮外独立文本
  await expect(
    entry(page, "陈启明").getByText("3 人认可", { exact: true }),
  ).toBeVisible();
  await expect(
    entry(page, "赵敏").getByText("128 人认可", { exact: true }),
  ).toBeVisible();
});
