/**
 * Browser coverage for production review recognition (issue #78).
 *
 * Asserts observable labels, counts, aria-pressed, pending disablement,
 * failure rollback, guest login guidance, and the historical/score-only
 * eligibility boundary. Write requests go to the mocked endorsement API.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

type Store = {
  authenticated: boolean;
  counts: Record<string, number>;
  endorsed: Record<string, boolean>;
};

const course = {
  id: 8,
  code: "GEN0108",
  name: "中国传统文化导论",
  category: "general",
  department: "人文学院",
  teachers: [{ id: 9, name: "测试教师" }],
};

function review(
  id: string,
  comment: string,
  extras: { endorsement_count?: number; endorsable?: boolean; viewer_endorsed?: boolean } = {},
) {
  return {
    id,
    course_id: 8,
    teacher_id: 9,
    course_name: course.name,
    course_code: course.code,
    teacher_name: "测试教师",
    comment,
    endorsement_count: extras.endorsement_count ?? 0,
    endorsable: extras.endorsable ?? id.startsWith("review:"),
    viewer_endorsed: extras.viewer_endorsed,
  };
}

function liveReviews(store: Store, authenticated: boolean) {
  return [
    review("review:301", "零计数当前文字评价。", {
      endorsement_count: store.counts["review:301"],
      viewer_endorsed: authenticated ? store.endorsed["review:301"] : undefined,
    }),
    review("review:302", "非零计数当前文字评价。", {
      endorsement_count: store.counts["review:302"],
      viewer_endorsed: authenticated ? store.endorsed["review:302"] : undefined,
    }),
    review("review:303", "我已认可的当前文字评价。", {
      endorsement_count: store.counts["review:303"],
      viewer_endorsed: authenticated ? store.endorsed["review:303"] : undefined,
    }),
    review("review:305", "建立总会失败的当前文字评价。", {
      endorsement_count: store.counts["review:305"],
      viewer_endorsed: authenticated ? store.endorsed["review:305"] : undefined,
    }),
    review("review:306", "慢网络建立中的当前文字评价。", {
      endorsement_count: store.counts["review:306"],
      viewer_endorsed: authenticated ? store.endorsed["review:306"] : undefined,
    }),
    review("historical:hist-1", "历史评价不可认可。", {
      endorsable: false,
    }),
  ];
}

async function fulfillJson(route: Route, json: unknown, status = 200) {
  return route.fulfill({ status, json });
}

async function mockApi(page: Page, store: Store) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/config") {
      return fulfillJson(route, {
        siteName: "选课志",
        universityName: "江西财经大学",
        admin: false,
      });
    }
    if (url.pathname === "/api/user/session") {
      return fulfillJson(route, {
        authenticated: store.authenticated,
        csrfToken: store.authenticated ? "csrf-user" : undefined,
        loginPath: "/login",
        logoutPath: "/logout",
      });
    }
    if (url.pathname === "/api/courses/8") {
      return fulfillJson(route, {
        course,
        reviews: liveReviews(store, store.authenticated),
        reviewCount: 6,
        nextReviewCursor: null,
      });
    }
    const endorsement = /\/api\/reviews\/([^/]+)\/endorsement$/.exec(url.pathname);
    if (endorsement) {
      const id = decodeURIComponent(endorsement[1]);
      if (!store.authenticated) {
        return fulfillJson(route, { error: "请先登录后再认可" }, 401);
      }
      if (id === "review:305" && request.method() === "PUT") {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return fulfillJson(route, { error: "认可失败" }, 500);
      }
      if (id === "review:306") {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return fulfillJson(route, { error: "timeout" }, 504);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (request.method() === "PUT") {
        if (!store.endorsed[id]) {
          store.endorsed[id] = true;
          store.counts[id] += 1;
        }
      } else if (request.method() === "DELETE") {
        if (store.endorsed[id]) {
          store.endorsed[id] = false;
          store.counts[id] -= 1;
        }
      }
      return fulfillJson(route, {
        endorsementCount: store.counts[id],
        viewerEndorsed: store.endorsed[id],
      });
    }
    return fulfillJson(route, { error: "not mocked" }, 404);
  });
}

function entry(page: Page, comment: string) {
  return page.locator("article").filter({ hasText: comment });
}

function guestStore(): Store {
  return {
    authenticated: false,
    counts: {
      "review:301": 0,
      "review:302": 3,
      "review:303": 5,
      "review:305": 2,
      "review:306": 1,
    },
    endorsed: {
      "review:301": false,
      "review:302": false,
      "review:303": true,
      "review:305": false,
      "review:306": false,
    },
  };
}

function userStore(): Store {
  return { ...guestStore(), authenticated: true };
}

test("guest sees counts, no selected state, and a real login link", async ({ page }) => {
  await mockApi(page, guestStore());
  await page.goto("/courses/8");
  await expect(page.getByRole("button", { name: "认可这条评价，还没有人认可" })).toBeEnabled();

  const zero = entry(page, "零计数当前文字评价。").getByRole("button", {
    name: "认可这条评价，还没有人认可",
  });
  await expect(zero).toBeVisible();
  await expect(zero).toHaveAttribute("aria-pressed", "false");

  await expect(
    entry(page, "非零计数当前文字评价。").getByRole("button", {
      name: "认可这条评价，当前 3 人认可",
    }),
  ).toBeVisible();
  await expect(
    entry(page, "我已认可的当前文字评价。").getByRole("button", {
      name: "认可这条评价，当前 5 人认可",
    }),
  ).toHaveAttribute("aria-pressed", "false");

  await expect(entry(page, "历史评价不可认可。").getByRole("button")).toHaveCount(0);

  await zero.click();
  const prompt = entry(page, "零计数当前文字评价。").getByRole("status");
  await expect(prompt.getByRole("link", { name: "使用普通用户登录" })).toHaveAttribute(
    "href",
    "/login?from=%2Fcourses%2F8",
  );
  await expect(zero).toHaveAttribute("aria-pressed", "false");
  await prompt.getByRole("link", { name: "使用普通用户登录" }).click();
  await expect(page).toHaveURL(/\/login\?from=%2Fcourses%2F8$/);
  await expect(page.getByRole("heading", { name: "普通用户登录" })).toBeVisible();
});

test("signed-in user can endorse and withdraw with pending and selected state", async ({
  page,
}) => {
  await mockApi(page, userStore());
  await page.goto("/courses/8");
  await expect(
    entry(page, "我已认可的当前文字评价。").getByRole("button", {
      name: "已认可，按下可撤回我的认可，当前 5 人认可",
    }),
  ).toBeVisible();
  const demo = entry(page, "非零计数当前文字评价。");
  await expect(
    demo.getByRole("button", { name: "认可这条评价，当前 3 人认可" }),
  ).toBeEnabled();

  await demo.getByRole("button", { name: "认可这条评价，当前 3 人认可" }).click();
  await expect(
    demo.getByRole("button", { name: "正在建立认可，当前 4 人认可" }),
  ).toBeDisabled();
  const endorsed = demo.getByRole("button", {
    name: "已认可，按下可撤回我的认可，当前 4 人认可",
  });
  await expect(endorsed).toBeVisible();
  await expect(endorsed).toHaveAttribute("aria-pressed", "true");

  await endorsed.click();
  await expect(
    demo.getByRole("button", { name: "正在撤回认可，当前 3 人认可" }),
  ).toBeDisabled();
  await expect(
    demo.getByRole("button", { name: "认可这条评价，当前 3 人认可" }),
  ).toBeVisible();
});

test("failure rolls back to the server-confirmed count", async ({ page }) => {
  await mockApi(page, userStore());
  await page.goto("/courses/8");
  await expect(
    entry(page, "我已认可的当前文字评价。").getByRole("button", {
      name: "已认可，按下可撤回我的认可，当前 5 人认可",
    }),
  ).toBeVisible();
  const demo = entry(page, "建立总会失败的当前文字评价。");
  await demo.getByRole("button", { name: "认可这条评价，当前 2 人认可" }).click();
  await expect(demo.getByRole("alert")).toContainText(
    "认可失败，已恢复服务器确认的计数",
  );
  const restored = demo.getByRole("button", {
    name: "认可这条评价，当前 2 人认可",
  });
  await expect(restored).toBeVisible();
  await expect(restored).toHaveAttribute("aria-pressed", "false");
});

test("slow network keeps pending and blocks repeat activation", async ({ page }) => {
  await mockApi(page, userStore());
  await page.goto("/courses/8");
  await expect(
    entry(page, "我已认可的当前文字评价。").getByRole("button", {
      name: "已认可，按下可撤回我的认可，当前 5 人认可",
    }),
  ).toBeVisible();
  const demo = entry(page, "慢网络建立中的当前文字评价。");
  await expect(
    demo.getByRole("button", { name: "认可这条评价，当前 1 人认可" }),
  ).toBeEnabled();
  await demo.getByRole("button", { name: "认可这条评价，当前 1 人认可" }).click();
  const pending = demo.getByRole("button", {
    name: "正在建立认可，当前 2 人认可",
  });
  await expect(pending).toBeDisabled();
  await page.waitForTimeout(400);
  await expect(pending).toBeVisible();
  await expect(pending).toBeDisabled();
});

test("keyboard Enter activates the standard Button", async ({ page }) => {
  await mockApi(page, userStore());
  await page.goto("/courses/8");
  await expect(
    entry(page, "我已认可的当前文字评价。").getByRole("button", {
      name: "已认可，按下可撤回我的认可，当前 5 人认可",
    }),
  ).toBeVisible();
  const demo = entry(page, "零计数当前文字评价。");
  const button = demo.getByRole("button", { name: "认可这条评价，还没有人认可" });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(
    demo.getByRole("button", {
      name: "已认可，按下可撤回我的认可，当前 1 人认可",
    }),
  ).toBeVisible();
});
