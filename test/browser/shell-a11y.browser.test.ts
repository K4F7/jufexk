import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

async function mockPublicShell(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: {
          siteName: "选课志",
          universityName: "江西财经大学",
          admin: false,
        },
      });
    }
    if (url.pathname === "/api/user/session") {
      return route.fulfill({
        json: {
          authenticated: false,
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
    if (url.pathname === "/api/site/banner") {
      return route.fulfill({
        json: { desktopHtml: "", mobileHtml: "", updatedAt: null },
      });
    }
    if (url.pathname === "/api/reviews/latest") {
      return route.fulfill({ json: { items: [], nextCursor: null } });
    }
    if (url.pathname === "/api/courses" || url.pathname === "/api/teachers") {
      return route.fulfill({
        json: { items: [], page: 1, pageSize: 20, total: 0, pages: 1 },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
}

test.beforeEach(async ({ page }) => mockPublicShell(page));

test("skip link is the first tab stop and moves focus to main @mobile-smoke", async ({
  page,
}) => {
  await page.goto("/courses");

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "跳到主内容" });
  await expect(skip).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page.getByRole("main")).toHaveAttribute("id", "main-content");
});

test("shell icon controls and login form expose accessible names", async ({
  page,
}) => {
  await page.goto("/courses");
  await expect(
    page.getByRole("button", { name: /切换到(暗色|亮色)模式/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "登录" })).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "搜索课程" }),
  ).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();
  await expect(page.getByLabel("学号")).toBeVisible();
  await expect(page.getByLabel("校园密码")).toBeVisible();
});

/**
 * WCAG 2.4.7 Focus Visible — prove with computed styles that every kind of
 * shell control shows an indicator after keyboard Tab.
 *
 * HeroUI v3 components draw the official 2px --focus box-shadow ring:
 * Button/Link via [data-focus-visible=true], SearchField via
 * .search-field__group:focus-within. Plain anchors that React Aria never
 * decorates (skip link, the buttonVariants-styled 导师 external link) are
 * covered by the scoped outline fallback in globals.css. The ring
 * transitions in over ~150ms, so box-shadow assertions poll until settled.
 */
test("keyboard tab draws a visible focus indicator on shell controls", async ({
  page,
}) => {
  await page.goto("/courses");
  await expect(
    page.getByRole("searchbox", { name: "搜索课程" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "登录" })).toBeVisible();

  const focusColor = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--focus)";
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(focusColor).not.toBe("");

  async function tabUntilFocused(selector: string, maxTabs = 25) {
    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press("Tab");
      const hit = await page.evaluate(
        (sel) => document.activeElement?.matches(sel) ?? false,
        selector,
      );
      if (hit) return;
    }
    throw new Error(`Tab never reached ${selector}`);
  }

  async function computedFocusStyle(locator: Locator) {
    return locator.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        boxShadow: cs.boxShadow,
        outlineColor: cs.outlineColor,
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
      };
    });
  }

  async function expectOutlineFallback(locator: Locator) {
    const style = await computedFocusStyle(locator);
    expect(style.outlineStyle).toBe("solid");
    expect(style.outlineWidth).toBe("2px");
    expect(style.outlineColor).toBe(focusColor);
  }

  async function expectHeroUIRing(locator: Locator) {
    await expect(locator).toHaveAttribute("data-focus-visible", "true");
    await expect
      .poll(async () => (await computedFocusStyle(locator)).boxShadow)
      .toContain(focusColor);
    // The ring is the only indicator: no fallback outline double-draws.
    expect((await computedFocusStyle(locator)).outlineStyle).toBe("none");
  }

  // First Tab: skip link — plain anchor, outline fallback.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "跳到主内容" });
  await expect(skip).toBeFocused();
  await expectOutlineFallback(skip);

  // HeroUI Link (主导航 课评) — official ring, no outline.
  await tabUntilFocused('nav[aria-label="主导航"] a[href="/latest"]');
  await expectHeroUIRing(
    page.locator('nav[aria-label="主导航"] a[href="/latest"]').first(),
  );

  // 导师 external link — buttonVariants on a plain <a>, so no React Aria
  // attribute; the scoped outline fallback is the only indicator.
  await tabUntilFocused('nav a[href^="https://pi-review"]');
  const mentor = page.getByRole("link", { name: "导师（新窗口打开）" });
  await expect(mentor).not.toHaveAttribute("data-focus-visible");
  await expectOutlineFallback(mentor);

  // HeroUI SearchField — official ring on the group via :focus-within.
  await tabUntilFocused("header input");
  const searchGroup = page.locator("header .search-field__group");
  await expect
    .poll(async () => (await computedFocusStyle(searchGroup)).boxShadow)
    .toContain(focusColor);

  // HeroUI Button (theme toggle) — official ring, no outline.
  await tabUntilFocused('header button[aria-label*="模式"]');
  await expectHeroUIRing(
    page.getByRole("button", { name: /切换到(暗色|亮色)模式/ }),
  );
});

/**
 * The Sky accent is visually frozen (docs/ui/foundations.md #422); changing
 * it is a product decision, not an a11y fix. axe reports colors as hex, so
 * only these exact fg/bg pairs on these known elements are tolerated.
 * Anything else — including a --muted regression, which this PR fixed —
 * fails the scan, in both themes.
 */
const FROZEN_CONTRAST: Array<{ fg: string; bg: string; element: RegExp }> = [
  // Primary Button label (snow) on the Sky accent background.
  { fg: "#fcfcfc", bg: "#0485f7", element: /button--primary/ },
  // Selected ToggleButton label on its Sky tint (catalog view/sort toggles).
  { fg: "#1e63ae", bg: "#ccdff1", element: /toggle-button/ },
];

async function expectNoViolationsExceptFrozenContrast(page: Page, path: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const unexpected = results.violations.flatMap((violation) => {
    if (violation.id !== "color-contrast") return [violation];
    const unfrozen = violation.nodes.filter((node) => {
      const data = node.any[0]?.data as
        | { fgColor?: string; bgColor?: string }
        | undefined;
      return !FROZEN_CONTRAST.some(
        (frozen) =>
          frozen.fg === data?.fgColor?.toLowerCase() &&
          frozen.bg === data?.bgColor?.toLowerCase() &&
          frozen.element.test(node.html),
      );
    });
    return unfrozen.length ? [{ ...violation, nodes: unfrozen }] : [];
  });
  expect(unexpected, `${path} axe violations`).toEqual([]);
}

test("public catalog and login pass axe WCAG A/AA outside the frozen Sky accent", async ({
  page,
}) => {
  for (const path of ["/courses", "/login"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoViolationsExceptFrozenContrast(page, path);
  }
});

test("dark theme keeps the same axe WCAG A/AA contract", async ({ page }) => {
  await page.addInitScript((theme) => {
    window.localStorage.setItem("jufexk-theme", theme);
  }, "dark");
  for (const path of ["/courses", "/login"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoViolationsExceptFrozenContrast(page, path);
  }
});
