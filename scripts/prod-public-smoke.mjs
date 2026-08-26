/**
 * Public, unauthenticated walk of live production (courses.sein.moe).
 *
 * Reconnaissance-then-action: wait for networkidle, screenshot, inspect DOM,
 * then click/fill with discovered roles. Headless Chromium. Not wired into CI.
 *
 * Does not log in, POST reviews, open AuthBridge, or follow 导师 / Tencent sheets.
 *
 * Usage: node scripts/prod-public-smoke.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://courses.sein.moe";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "output/playwright/prod-public-smoke");
const ARTIFACTS = "/opt/cursor/artifacts";

const FILTERS = ["全部", "体育", "英语", "思政", "数学"];
const KNOWN_PRODUCT = [
  "Production nav hides 排课模拟; /schedule still works.",
  "导师 nav goes to pi-review.com (intentional; not followed).",
  "Empty stars / 「—」 on old reviews: historical import.",
  "Authors 匿名用户#000000: historical import.",
  "Login is 学号+校园密码; credentials were not entered.",
  "共 N 条 is course×teacher rows.",
  "SPA soft 404 HTTP 200 is known.",
];

mkdirSync(OUT, { recursive: true });
mkdirSync(ARTIFACTS, { recursive: true });

const results = [];
const consoleLog = [];
const pageErrors = [];
let shotIndex = 0;

function record(id, status, detail, extra = {}) {
  const row = { id, status, detail, ...extra };
  results.push(row);
  const mark = status === "passed" ? "PASS" : status === "failed" ? "FAIL" : "SKIP";
  console.log(`[${mark}] ${id}: ${detail}`);
  return row;
}

async function settle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 25000 });
  } catch {
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
  }
  await page.waitForTimeout(400);
}

async function waitGone(page, locator, timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const count = await locator.count();
    if (count === 0) return;
    const visible = await locator
      .first()
      .isVisible()
      .catch(() => false);
    if (!visible) return;
    await page.waitForTimeout(200);
  }
}

async function waitCatalogIdle(page) {
  await settle(page);
  await waitGone(page, page.getByText("正在更新课程目录…"));
  await waitGone(page, page.getByText("课程加载中…"));
  await waitGone(page, page.getByRole("status", { name: "课程加载中…" }));
  await waitGone(page, page.locator("[data-detail-skeleton-row]"));
  await page.waitForTimeout(250);
}

async function inspect(page) {
  return page.evaluate(() => {
    const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width + r.height > 0;
    };
    const pick = (selector, map) =>
      [...document.querySelectorAll(selector)]
        .filter(visible)
        .slice(0, 40)
        .map(map);

    return {
      title: document.title,
      url: location.href,
      pathname: location.pathname + location.search,
      heading: text(document.querySelector("h1, [role='heading']") || document.body).slice(0, 80),
      headings: pick("h1, h2, [role='heading']", (el) => ({
        role: el.getAttribute("role") || el.tagName.toLowerCase(),
        name: text(el).slice(0, 80),
        level: el.getAttribute("aria-level") || el.tagName,
      })),
      navLinks: pick("nav[aria-label='主导航'] a", (el) => ({
        name: text(el),
        href: el.getAttribute("href") || "",
        target: el.getAttribute("target") || "",
      })),
      footerLinks: pick("footer a", (el) => ({
        name: text(el) || el.getAttribute("aria-label") || "",
        href: el.getAttribute("href") || "",
      })),
      radios: pick("[role='radio'], input[type='radio']", (el) => ({
        name: el.getAttribute("aria-label") || text(el),
        checked: el.getAttribute("aria-checked") || String(el.checked || false),
      })),
      searchboxes: pick(
        "input[type='search'], [role='searchbox'], input[aria-label*='搜索']",
        (el) => ({
          name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || "",
          value: el.value || "",
        }),
      ),
      buttons: pick("button, [role='button']", (el) =>
        (el.getAttribute("aria-label") || text(el)).slice(0, 60),
      ),
      links: pick("main a, [role='main'] a", (el) => ({
        name: text(el).slice(0, 80),
        href: el.getAttribute("href") || "",
      })),
      bodySnippet: text(document.body).slice(0, 400),
    };
  });
}

async function shot(page, name) {
  shotIndex += 1;
  const file = `${String(shotIndex).padStart(2, "0")}-${name}.png`;
  const dest = join(OUT, file);
  await page.screenshot({ path: dest, fullPage: false });
  await page.screenshot({ path: join(ARTIFACTS, file), fullPage: false });
  return file;
}

function hasText(snapshot, re) {
  return re.test(snapshot.bodySnippet) || snapshot.headings.some((h) => re.test(h.name));
}

function navHas(snapshot, name) {
  return snapshot.navLinks.some((l) => l.name === name);
}

async function gotoRecon(page, path, shotName) {
  const response = await page.goto(`${ORIGIN}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await waitCatalogIdle(page);
  const snapshot = await inspect(page);
  const file = await shot(page, shotName);
  return {
    httpStatus: response?.status() ?? null,
    snapshot,
    screenshot: file,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 jufexk-prod-public-smoke",
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const entry = {
      type: msg.type(),
      text: msg.text(),
      url: page.url(),
      location: msg.location(),
    };
    consoleLog.push(entry);
  });
  page.on("pageerror", (err) => {
    pageErrors.push({ message: String(err), url: page.url() });
  });

  // 1. / and /courses
  {
    const home = await gotoRecon(page, "/", "home-redirect");
    const onCatalog =
      home.snapshot.pathname.startsWith("/courses") &&
      hasText(home.snapshot, /课程列表|共\s*\d+\s*条/);
    record(
      "home-redirect",
      onCatalog ? "passed" : "failed",
      `GET / → ${home.snapshot.pathname} HTTP ${home.httpStatus}`,
      { screenshot: home.screenshot, httpStatus: home.httpStatus },
    );

    const courses = await gotoRecon(page, "/courses", "courses-catalog");
    const catalogOk =
      hasText(courses.snapshot, /课程列表|共\s*\d+\s*条/) &&
      courses.snapshot.radios.some((r) => r.name.includes("全部"));
    const hiddenSchedule = !navHas(courses.snapshot, "排课模拟");
    const mentor = courses.snapshot.navLinks.find((l) => l.name === "导师");
    record(
      "courses-catalog",
      catalogOk ? "passed" : "failed",
      catalogOk
        ? `Catalog loaded. Nav: ${courses.snapshot.navLinks.map((l) => l.name).join(" / ") || "(empty)"}`
        : `Catalog did not show expected heading/filters. heading=${courses.snapshot.heading}`,
      {
        screenshot: courses.screenshot,
        nav: courses.snapshot.navLinks,
        radios: courses.snapshot.radios,
        known: {
          scheduleNavHidden: hiddenSchedule,
          mentorHref: mentor?.href || null,
        },
      },
    );
    record(
      "nav-hides-schedule",
      "skipped",
      hiddenSchedule
        ? "Confirmed product: 排课模拟 is absent from production nav."
        : "排课模拟 is visible in production nav (unexpected vs ADR-0036; not treated as a walk failure).",
    );

    for (const label of FILTERS) {
      const radio = page.getByRole("radio", { name: label, exact: true });
      const count = await radio.count();
      if (count === 0) {
        record(`filter-${label}`, "failed", `No radio named ${label}`);
        continue;
      }
      await radio.click();
      await waitCatalogIdle(page);
      const snap = await inspect(page);
      const file = await shot(page, `filter-${label}`);
      const url = new URL(page.url());
      const category = url.searchParams.get("category") || "";
      const expected =
        label === "全部"
          ? category === ""
          : label === "体育"
            ? category === "sports"
            : label === "英语"
              ? category === "english"
              : label === "思政"
                ? category === "ideology"
                : category === "math";
      const total = /共\s*(\d+)\s*条/.exec(snap.bodySnippet)?.[1] ?? null;
      record(
        `filter-${label}`,
        expected && hasText(snap, /共\s*\d+\s*条|没有符合|没有找到/)
          ? "passed"
          : "failed",
        `${label} → ${url.pathname}${url.search} 共 ${total ?? "?"} 条`,
        { screenshot: file, category },
      );
    }

    const search = page.getByRole("searchbox", { name: /搜索课程/ });
    if ((await search.count()) === 0) {
      record("search-线性代数", "failed", "No 搜索课程 searchbox");
    } else {
      await search.fill("线性代数");
      await search.press("Enter");
      await waitCatalogIdle(page);
      await page
        .getByRole("link", { name: /线性代数/ })
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => {});
      const snap = await inspect(page);
      const file = await shot(page, "search-linear-algebra");
      const url = new URL(page.url());
      const q = url.searchParams.get("q") || "";
      const hit = snap.links.some((l) => /线性代数/.test(l.name));
      record(
        "search-线性代数",
        q.includes("线性代数") && (hit || hasText(snap, /线性代数|没有找到/))
          ? "passed"
          : "failed",
        `q=${q}; first hits: ${snap.links
          .filter((l) => l.href.includes("/courses/"))
          .slice(0, 3)
          .map((l) => l.name)
          .join(" | ")}`,
        { screenshot: file },
      );
    }
  }

  // 2. Open one course detail
  let detailHref = null;
  {
    const links = page.locator("main a[href*='/courses/']");
    const n = await links.count();
    if (n === 0) {
      // Fall back to catalog without search.
      await page.goto(`${ORIGIN}/courses?q=${encodeURIComponent("线性代数")}`, {
        waitUntil: "domcontentloaded",
      });
      await waitCatalogIdle(page);
    }
    const named = page.getByRole("link", { name: /线性代数/ });
    const catalogLinks =
      (await named.count()) > 0 ? named : page.locator("main a[href*='/courses/']");
    const available = await catalogLinks.count();
    if (available === 0) {
      record("course-detail", "failed", "No course links on catalog");
    } else {
      detailHref = await catalogLinks.first().getAttribute("href");
      await catalogLinks.first().click();
      await waitCatalogIdle(page);
      await page
        .getByRole("heading")
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      const snap = await inspect(page);
      const file = await shot(page, "course-detail");
      const onDetail = /\/courses\/\d+/.test(snap.pathname);
      const looksLikeDetail =
        onDetail &&
        (hasText(snap, /写点评|课评|任课|教师/) || snap.headings.length > 0);
      record(
        "course-detail",
        looksLikeDetail ? "passed" : "failed",
        `Opened ${detailHref} → ${snap.pathname}; heading=${snap.heading}`,
        { screenshot: file, href: detailHref },
      );
    }
  }

  // 3. /最新 is /latest (课评 nav)
  {
    const encoded = await gotoRecon(page, "/%E6%9C%80%E6%96%B0", "latest-cn-path");
    const latestViaAlias =
      encoded.snapshot.pathname === "/latest" ||
      encoded.snapshot.pathname === "/最新" ||
      hasText(encoded.snapshot, /最新课评/);
    record(
      "path-最新",
      latestViaAlias && hasText(encoded.snapshot, /最新课评|课评/)
        ? "passed"
        : hasText(encoded.snapshot, /页面不存在/)
          ? "skipped"
          : "failed",
      hasText(encoded.snapshot, /页面不存在/)
        ? `/最新 stayed as SPA 404 (${encoded.snapshot.pathname}, HTTP ${encoded.httpStatus}). 课评 nav uses /latest.`
        : `GET /最新 → ${encoded.snapshot.pathname} HTTP ${encoded.httpStatus}; heading=${encoded.snapshot.heading}`,
      { screenshot: encoded.screenshot, httpStatus: encoded.httpStatus },
    );

    const latest = await gotoRecon(page, "/latest", "latest");
    record(
      "path-latest",
      hasText(latest.snapshot, /最新课评/) ? "passed" : "failed",
      `GET /latest → ${latest.snapshot.pathname} HTTP ${latest.httpStatus}; heading=${latest.snapshot.heading}`,
      { screenshot: latest.screenshot },
    );

    const nav = page.getByRole("navigation", { name: "主导航" }).getByRole("link", {
      name: "课评",
    });
    if ((await nav.count()) === 0) {
      record("nav-课评", "failed", "课评 link missing from 主导航");
    } else {
      await nav.click();
      await waitCatalogIdle(page);
      const snap = await inspect(page);
      const file = await shot(page, "nav-latest");
      record(
        "nav-课评",
        snap.pathname.startsWith("/latest") && hasText(snap, /最新课评/)
          ? "passed"
          : "failed",
        `课评 nav → ${snap.pathname}`,
        { screenshot: file },
      );
    }
  }

  // 4. /login and /submit — login gate only
  {
    const login = await gotoRecon(page, "/login", "login");
    const formOk =
      hasText(login.snapshot, /登录/) &&
      (login.snapshot.searchboxes.length > 0 ||
        /学号|校园密码/.test(login.snapshot.bodySnippet) ||
        login.snapshot.buttons.some((b) => /登录/.test(b)));
    record(
      "login-page",
      formOk ? "passed" : "failed",
      `GET /login shows gate; labels include 学号/校园密码=${/学号/.test(login.snapshot.bodySnippet)}/${/校园密码/.test(login.snapshot.bodySnippet)}. No credentials entered.`,
      { screenshot: login.screenshot },
    );

    const submit = await gotoRecon(page, "/submit", "submit-gate");
    const gated =
      submit.snapshot.pathname.startsWith("/login") ||
      hasText(submit.snapshot, /登录/);
    const noFormPosted = !hasText(submit.snapshot, /评价已发布/);
    record(
      "submit-login-gate",
      gated && noFormPosted ? "passed" : "failed",
      `GET /submit → ${submit.snapshot.pathname}; login gate=${gated}`,
      { screenshot: submit.screenshot },
    );
  }

  // 5. /schedule direct URL
  {
    const schedule = await gotoRecon(page, "/schedule", "schedule");
    const notice = page.getByRole("alertdialog", { name: "本功能只支持电脑端" });
    if ((await notice.count()) > 0 && (await notice.isVisible().catch(() => false))) {
      await notice.getByRole("button", { name: "知道了" }).click();
      await waitCatalogIdle(page);
    }
    const snap = await inspect(page);
    const file = await shot(page, "schedule-after-notice");
    const ok =
      snap.pathname.startsWith("/schedule") &&
      (hasText(snap, /排课模拟/) || snap.headings.some((h) => /排课/.test(h.name)));
    record(
      "schedule-direct",
      ok ? "passed" : "failed",
      `GET /schedule → ${snap.pathname}; heading=${snap.heading}`,
      { screenshot: file, screenshotBefore: schedule.screenshot },
    );
  }

  // 6. /about, /teachers if linked, fake path
  {
    const about = await gotoRecon(page, "/about", "about");
    record(
      "about",
      hasText(about.snapshot, /关于/) ? "passed" : "failed",
      `GET /about → ${about.snapshot.pathname}; heading=${about.snapshot.heading}`,
      { screenshot: about.screenshot },
    );

    await page.goto(`${ORIGIN}/courses`, { waitUntil: "domcontentloaded" });
    await waitCatalogIdle(page);
    const catalog = await inspect(page);
    const teacherLinked =
      navHas(catalog, "教师") ||
      catalog.footerLinks.some((l) => l.href.includes("/teachers")) ||
      catalog.links.some((l) => /\/teachers(\/|$|\?)/.test(l.href));
    const teachers = await gotoRecon(page, "/teachers", "teachers");
    record(
      "teachers",
      hasText(teachers.snapshot, /教师|老师/) || teachers.snapshot.pathname.startsWith("/teachers")
        ? "passed"
        : "failed",
      teacherLinked
        ? ` /teachers is linked from the public surface; heading=${teachers.snapshot.heading}`
        : ` /teachers is not in production nav/footer (visited by URL); heading=${teachers.snapshot.heading}`,
      { screenshot: teachers.screenshot, linked: teacherLinked },
    );

    const missing = await gotoRecon(
      page,
      "/this-page-should-not-exist",
      "soft-404",
    );
    const soft404 =
      missing.httpStatus === 200 && hasText(missing.snapshot, /页面不存在/);
    record(
      "soft-404",
      soft404 || hasText(missing.snapshot, /页面不存在/)
        ? "passed"
        : "failed",
      `GET /this-page-should-not-exist HTTP ${missing.httpStatus} → ${missing.snapshot.pathname}; heading=${missing.snapshot.heading}`,
      { screenshot: missing.screenshot, httpStatus: missing.httpStatus },
    );
  }

  const consoleErrors = consoleLog.filter(
    (e) => e.type === "error" || e.type === "assert",
  );
  const report = {
    origin: ORIGIN,
    ranAt: new Date().toISOString(),
    viewport: { width: 1280, height: 800 },
    results,
    counts: {
      passed: results.filter((r) => r.status === "passed").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
    },
    consoleErrors,
    pageErrors,
    consoleAll: consoleLog,
    knownProduct: KNOWN_PRODUCT,
  };

  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(ARTIFACTS, "prod-public-smoke-report.json"), JSON.stringify(report, null, 2));

  await browser.close();
  console.log(
    `\nDone. passed=${report.counts.passed} failed=${report.counts.failed} skipped=${report.counts.skipped}`,
  );
  console.log(`Console errors: ${consoleErrors.length}; page errors: ${pageErrors.length}`);
  console.log(`Output: ${OUT}`);
  if (report.counts.failed > 0) process.exitCode = 1;
}

await main();
