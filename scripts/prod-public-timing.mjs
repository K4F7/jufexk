/**
 * Public, unauthenticated load-timing walk of live production
 * (courses.sein.moe).
 *
 * Measures user-visible ready time and matching public API Resource Timing
 * for search, 主导航, category pills, catalog pagination, /latest load-more,
 * and course-page review filters. Each scenario runs once cold then twice
 * warm (same context; catalog GETs have s-maxage=60).
 *
 * Read-only against production. Does not change product UI, CSS, or copy.
 * Idle waits observe existing a11y hooks (catalog skeleton
 * `[role=status][aria-label=加载中…]`, #418) and already-shipped /latest
 * / review-feed status text. Does not log in, POST reviews, or follow
 * 导师 / Tencent sheets. Not wired into CI.
 *
 * Usage: node scripts/prod-public-timing.mjs
 *    or: pnpm run timing:prod-public
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Production by default. Point at the Cloudflare preview Worker with
 * `PROD_PUBLIC_ORIGIN=https://jufexk-preview.<account>.workers.dev`
 * (no GitHub Actions required). Preview D1 must exist — the committed
 * `wrangler.jsonc` still has the placeholder id, so GHA skips that deploy. */
const ORIGIN = process.env.PROD_PUBLIC_ORIGIN ?? "https://courses.sein.moe";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "output/playwright/prod-public-timing");
const ARTIFACTS =
  process.env.PROD_PUBLIC_TIMING_ARTIFACTS ?? join(OUT, "artifacts");
const WARM_REPEATS = 2;
const ACTION_TIMEOUT_MS = 60_000;

const SEARCH_CASES = [
  { id: "search-线性代数", query: "线性代数", expectHit: true },
  { id: "search-teacher-孙爱琳", query: "孙爱琳", expectHit: true },
  { id: "search-code-1004201162", query: "1004201162", expectHit: true },
  { id: "search-short-微", query: "微", expectHit: true },
  { id: "search-miss", query: "zzqxnevermatch999", expectHit: false },
];

const CATEGORY_PILLS = [
  { id: "category-全部", label: "全部", category: "" },
  { id: "category-通识", label: "通识", category: "general" },
  { id: "category-数学", label: "数学", category: "math" },
  { id: "category-思政", label: "思政", category: "ideology" },
  { id: "category-英语", label: "英语", category: "english" },
  { id: "category-体育", label: "体育", category: "sports" },
];

const REVIEW_SORTS = [
  { id: "review-sort-latest", option: "最新发布" },
  { id: "review-sort-oldest", option: "最早发布" },
  { id: "review-sort-rating-desc", option: "评分最高" },
  { id: "review-sort-rating-asc", option: "评分最低" },
  { id: "review-sort-recognized", option: "认可最多" },
];

const REVIEW_RATINGS = [
  { id: "review-rating-5", option: "5 星" },
  { id: "review-rating-1", option: "1 星" },
  { id: "review-rating-all", option: "全部" },
];

mkdirSync(OUT, { recursive: true });
mkdirSync(ARTIFACTS, { recursive: true });

const measurements = [];
const notes = [];
let shotIndex = 0;

function apiKind(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return "other";
  }
  const path = url.pathname;
  if (path === "/api/courses" && url.searchParams.get("view") === "relations") {
    return "catalog";
  }
  if (path === "/api/courses") return "catalog-courses";
  if (path === "/api/reviews/latest") return "latest";
  if (/^\/api\/courses\/\d+\/reviews$/.test(path)) return "reviews";
  if (/^\/api\/courses\/\d+$/.test(path)) return "course-detail";
  if (/^\/api\/teachers\/\d+$/.test(path)) return "teacher-detail";
  if (path === "/api/admin/session") return "admin-session";
  if (path === "/api/config") return "config";
  if (path === "/api/site/banner") return "banner";
  return "other-api";
}

function summarizeTiming(timing) {
  if (!timing || typeof timing !== "object") return null;
  const responseEnd = Number(timing.responseEnd);
  const responseStart = Number(timing.responseStart);
  const requestStart = Number(timing.requestStart);
  return {
    durationMs:
      Number.isFinite(responseEnd) && responseEnd >= 0 ? round(responseEnd) : null,
    ttfbMs:
      Number.isFinite(responseStart) &&
      Number.isFinite(requestStart) &&
      responseStart >= 0 &&
      requestStart >= 0
        ? round(responseStart - requestStart)
        : null,
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? round((nums[mid - 1] + nums[mid]) / 2) : nums[mid];
}

function attachCollector(page) {
  const events = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/api/")) return;
    request._jufexkStartedAt = Date.now();
  });
  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/api/")) return;
    const request = response.request();
    const headers = response.headers();
    const resource = summarizeTiming(request.timing());
    events.push({
      at: Date.now(),
      wallMs:
        request._jufexkStartedAt != null
          ? Date.now() - request._jufexkStartedAt
          : null,
      url,
      method: request.method(),
      status: response.status(),
      kind: apiKind(url),
      resourceType: request.resourceType(),
      durationMs: resource?.durationMs ?? null,
      ttfbMs: resource?.ttfbMs ?? null,
      cfCacheStatus: headers["cf-cache-status"] ?? null,
      cacheControl: headers["cache-control"] ?? null,
      cfRay: headers["cf-ray"] ?? null,
      contentLength: headers["content-length"]
        ? Number(headers["content-length"])
        : null,
    });
  });
  return events;
}

function forbiddenRequest(request) {
  const method = request.method().toUpperCase();
  const url = new URL(request.url());
  const isWrite = method !== "GET" && method !== "HEAD";
  const isSameOrigin = url.origin === ORIGIN;
  const isAuthOrReviewWrite =
    isSameOrigin &&
    isWrite &&
    (url.pathname === "/login" ||
      /^\/api\/auth(?:\/|$)/.test(url.pathname) ||
      /^\/api\/reviews?(?:\/|$)/.test(url.pathname) ||
      /^\/reviews?(?:\/|$)/.test(url.pathname) ||
      url.pathname === "/api/user/logout" ||
      url.pathname === "/submit");
  return isAuthOrReviewWrite ? { method, url: url.href } : null;
}

function catalogDomReady() {
  const loading = document.querySelector('[role="status"][aria-label="加载中…"]');
  const countSkeleton = document.querySelector('[aria-label="数量加载中"]');
  const busy = document.querySelector('[aria-busy="true"]');
  const text = document.body.innerText;
  const hasCount = /共\s*[1-9]\d*\s*条/.test(text);
  const empty =
    text.includes("没有找到匹配") || text.includes("目录暂无课程数据");
  return !loading && !countSkeleton && !busy && (hasCount || empty);
}

async function waitCatalogIdle(page, timeout = ACTION_TIMEOUT_MS) {
  await page.waitForFunction(catalogDomReady, null, { timeout });
}

/** After a catalog mutation, URL must match and a new list request must finish.
 *  Refresh-with-data keeps the old "共 N 条", so idle-only would return too soon. */
async function waitCatalogQuery(page, collector, mark, expected, timeout = ACTION_TIMEOUT_MS) {
  await page.waitForFunction(
    (wanted) => {
      const url = new URL(location.href);
      if (url.pathname !== "/courses") return false;
      if (wanted.q != null && (url.searchParams.get("q") || "") !== wanted.q) {
        return false;
      }
      if (
        wanted.category != null &&
        (url.searchParams.get("category") || "") !== wanted.category
      ) {
        return false;
      }
      if (
        wanted.page != null &&
        Number(url.searchParams.get("page") || "1") !== wanted.page
      ) {
        return false;
      }
      return true;
    },
    expected,
    { timeout },
  );
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const arrived = collector
      .slice(mark)
      .some((event) => event.kind === "catalog" && event.status < 400);
    if (arrived) {
      await waitCatalogIdle(page, Math.max(1000, deadline - Date.now()));
      return;
    }
    await page.waitForTimeout(25);
  }
  throw new Error(
    `catalog API did not arrive for ${JSON.stringify(expected)} at ${page.url()}`,
  );
}

async function waitLatestIdle(page, timeout = ACTION_TIMEOUT_MS) {
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      if (!text.includes("最新课评")) return false;
      if (text.includes("正在加载最新课评…")) return false;
      return (
        text.includes("暂时还没有公开课评") ||
        document.querySelectorAll("main article, [role='main'] article").length > 0
      );
    },
    null,
    { timeout },
  );
}

async function waitReviewsIdle(page, timeout = ACTION_TIMEOUT_MS) {
  await page.waitForFunction(
    () => {
      const loading = document.querySelector('[role="status"][aria-label="评价加载中…"]');
      const heading = document.getElementById("course-reviews-heading");
      if (!heading) return false;
      const text = document.body.innerText;
      return !loading && (text.includes("暂无评价") || text.includes("条点评"));
    },
    null,
    { timeout },
  );
}

async function readCatalogMeta(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const total = Number(/共\s*(\d+)\s*条/.exec(text)?.[1] ?? 0);
    const url = new URL(location.href);
    return {
      url: location.href,
      q: url.searchParams.get("q") || "",
      category: url.searchParams.get("category") || "",
      sort: url.searchParams.get("sort") || "",
      page: Number(url.searchParams.get("page") || "1"),
      total,
      pages: total > 0 ? Math.ceil(total / 20) : 0,
    };
  });
}

async function gotoCatalog(page, search = "") {
  const path = search.startsWith("?") ? `/courses${search}` : `/courses${search ? `?${search}` : ""}`;
  await page.goto(`${ORIGIN}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await waitCatalogIdle(page);
}

async function timeGet(url) {
  const started = Date.now();
  const response = await fetch(url, {
    headers: { "User-Agent": "jufexk-prod-public-timing" },
    signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
  });
  const body = await response.arrayBuffer();
  let json = null;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    json = null;
  }
  return {
    url,
    wallMs: Date.now() - started,
    status: response.status,
    cfCacheStatus: response.headers.get("cf-cache-status"),
    cacheControl: response.headers.get("cache-control"),
    cfRay: response.headers.get("cf-ray"),
    contentLength: body.byteLength,
    json,
  };
}

async function runHttpMatrix() {
  const rows = [];
  async function repeat(id, group, url) {
    let last = null;
    for (let index = 0; index < 1 + WARM_REPEATS; index += 1) {
      const heat = index === 0 ? "cold" : `warm${index}`;
      const started = Date.now();
      try {
        const result = await timeGet(url);
        last = result;
        const row = {
          id,
          group,
          heat,
          ok: result.status < 400 || (id === "http-admin-session" && result.status === 401),
          error: null,
          visibleMs: Date.now() - started,
          url,
          primaryWallMs: result.wallMs,
          primaryTtfbMs: null,
          cfCacheStatus: result.cfCacheStatus ? [result.cfCacheStatus] : [],
          status: result.status,
          contentLength: result.contentLength,
          cacheControl: result.cacheControl,
        };
        rows.push(row);
        console.log(
          `[HTTP ${row.ok ? "OK" : "FAIL"}] ${id} ${heat} ${result.wallMs}ms ${result.cfCacheStatus || "-"} ${result.status}`,
        );
      } catch (reason) {
        rows.push({
          id,
          group,
          heat,
          ok: false,
          error: String(reason?.message || reason),
          visibleMs: Date.now() - started,
          url,
          primaryWallMs: null,
          cfCacheStatus: [],
        });
        console.log(`[HTTP FAIL] ${id} ${heat} ${reason}`);
      }
    }
    return last;
  }

  // Sequential so HIT/MISS is not racing itself across scenarios.
  const first = await repeat(
    "http-catalog-home",
    "http-catalog",
    `${ORIGIN}/api/courses?view=relations&page=1`,
  );
  const total = Number(first?.json?.total) || 0;
  const pages = Number(first?.json?.pages) || (total > 0 ? Math.ceil(total / 20) : 0);

  const catalogQueries = [
    ["http-search-线性代数", "q=线性代数"],
    ["http-search-teacher-孙爱琳", "q=孙爱琳"],
    ["http-search-code-1004201162", "q=1004201162"],
    ["http-search-short-微", "q=微"],
    ["http-search-miss", "q=zzqxnevermatch999"],
    ["http-category-通识", "category=general"],
    ["http-category-数学", "category=math"],
    ["http-category-思政", "category=ideology"],
    ["http-category-英语", "category=english"],
    ["http-category-体育", "category=sports"],
    ["http-page-all-2", "page=2"],
    ...(pages > 2 ? [["http-page-all-last", `page=${pages}`]] : []),
    ["http-page-general-2", "category=general&page=2"],
    ["http-page-sports-2", "category=sports&page=2"],
  ];
  for (const [id, query] of catalogQueries) {
    await repeat(id, "http-catalog", `${ORIGIN}/api/courses?view=relations&${query}`);
  }

  const latest = await repeat(
    "http-latest",
    "http-latest",
    `${ORIGIN}/api/reviews/latest`,
  );
  if (latest?.json?.nextCursor) {
    await repeat(
      "http-latest-more",
      "http-latest",
      `${ORIGIN}/api/reviews/latest?cursor=${encodeURIComponent(latest.json.nextCursor)}`,
    );
  }

  const detailId = first?.json?.items?.[0]?.course_id ?? 378;
  const teacherId = first?.json?.items?.[0]?.teacher_id ?? 565;
  await repeat(
    "http-course-detail",
    "http-detail",
    `${ORIGIN}/api/courses/${detailId}`,
  );
  for (const [id, query] of [
    ["http-review-recognized", `teacherId=${teacherId}&sort=recognized`],
    ["http-review-latest", `teacherId=${teacherId}&sort=latest`],
    ["http-review-oldest", `teacherId=${teacherId}&sort=oldest`],
    ["http-review-rating-desc", `teacherId=${teacherId}&sort=rating_desc`],
    ["http-review-rating-5", `teacherId=${teacherId}&sort=recognized&rating=5`],
    ["http-review-rating-1", `teacherId=${teacherId}&sort=recognized&rating=1`],
  ]) {
    await repeat(
      id,
      "http-reviews",
      `${ORIGIN}/api/courses/${detailId}/reviews?${query}`,
    );
  }
  await repeat("http-config", "http-shell", `${ORIGIN}/api/config`);
  await repeat("http-admin-session", "http-shell", `${ORIGIN}/api/admin/session`);

  return { total, pages, detailId, teacherId, rows };
}

async function gotoLatest(page) {
  await page.goto(`${ORIGIN}/latest`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await waitLatestIdle(page);
}

async function clickNav(page, name) {
  const link = page.getByRole("navigation", { name: "主导航" }).getByRole("link", {
    name,
    exact: true,
  });
  await link.click();
}

async function clickCategory(page, label) {
  await page.getByRole("radio", { name: label, exact: true }).click();
}

async function clickPager(page, name) {
  const pager = page.getByRole("navigation", { name: "分页" });
  await pager.scrollIntoViewIfNeeded();
  const target = pager.getByRole("button", { name, exact: true });
  if ((await target.count()) > 0) {
    await target.click();
    return;
  }
  await pager.getByText(name, { exact: true }).click();
}

async function submitSearch(page, query) {
  const box = page.getByRole("searchbox", { name: /搜索课程/ });
  await box.click();
  await box.fill(query);
  await box.press("Enter");
}

async function openSelectOption(page, groupName, option) {
  const group = page.getByRole("group", { name: groupName });
  const trigger = group.getByRole("button").first();
  await trigger.click();
  const optionLocator = page.getByRole("option", { name: option, exact: true });
  await optionLocator.waitFor({ timeout: 10_000 });
  await optionLocator.click();
}

async function shot(page, name) {
  shotIndex += 1;
  const file = `${String(shotIndex).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: false });
  await page.screenshot({ path: join(ARTIFACTS, file), fullPage: false });
  return file;
}

function pickPrimary(events, kinds) {
  const wanted = new Set(kinds);
  return events.filter((event) => wanted.has(event.kind));
}

async function measure(page, collector, {
  id,
  group,
  heat,
  action,
  waitReady,
  primaryKinds,
}) {
  const mark = collector.length;
  const startedAt = Date.now();
  let error = null;
  try {
    await action();
    await waitReady(mark);
  } catch (reason) {
    error = String(reason?.message || reason);
  }
  const visibleMs = Date.now() - startedAt;
  const apis = collector
    .slice(mark)
    .filter((event) => event.at >= startedAt - 25);
  const primary = pickPrimary(apis, primaryKinds);
  const extras = apis.filter((event) => !primaryKinds.includes(event.kind));
  const row = {
    id,
    group,
    heat,
    ok: !error,
    error,
    visibleMs,
    url: page.url(),
    primary,
    extras: extras.map((event) => ({
      kind: event.kind,
      status: event.status,
      wallMs: event.wallMs,
      cfCacheStatus: event.cfCacheStatus,
    })),
    primaryDurationMs: median(primary.map((event) => event.durationMs ?? event.wallMs)),
    primaryTtfbMs: median(primary.map((event) => event.ttfbMs)),
    primaryWallMs: median(primary.map((event) => event.wallMs)),
    cfCacheStatus: primary.map((event) => event.cfCacheStatus).filter(Boolean),
  };
  measurements.push(row);
  const markLabel = error ? "FAIL" : "OK";
  const cache = row.cfCacheStatus.join(",") || "-";
  console.log(
    `[${markLabel}] ${id} ${heat} visible=${row.visibleMs}ms api=${row.primaryWallMs ?? "n/a"}ms cache=${cache}${error ? ` err=${error}` : ""}`,
  );
  return row;
}

async function runColdWarm(page, collector, spec) {
  for (let index = 0; index < 1 + WARM_REPEATS; index += 1) {
    const heat = index === 0 ? "cold" : `warm${index}`;
    try {
      if (spec.prepare) await spec.prepare(heat);
    } catch (reason) {
      measurements.push({
        id: spec.id,
        group: spec.group,
        heat,
        ok: false,
        error: `prepare: ${reason?.message || reason}`,
        visibleMs: null,
        url: page.url(),
        primary: [],
        extras: [],
        primaryDurationMs: null,
        primaryTtfbMs: null,
        primaryWallMs: null,
        cfCacheStatus: [],
      });
      console.log(`[FAIL] ${spec.id} ${heat} prepare ${reason?.message || reason}`);
      continue;
    }
    await measure(page, collector, {
      ...spec,
      heat,
    });
  }
}

async function navigationTiming(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return null;
    return {
      ttfbMs: Math.round(nav.responseStart - nav.requestStart),
      dclMs: Math.round(nav.domContentLoadedEventEnd),
      loadMs: Math.round(nav.loadEventEnd),
      transferSize: nav.transferSize,
    };
  });
}

async function runWalk(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 jufexk-prod-public-timing",
  });
  await context.route("**/*", async (route) => {
    const violation = forbiddenRequest(route.request());
    if (violation) {
      await route.abort("blockedbyclient");
      throw new Error(`Blocked forbidden request: ${violation.method} ${violation.url}`);
    }
    await route.continue();
  });
  const page = await context.newPage();
  const collector = attachCollector(page);

  try {
    await gotoCatalog(page);
  } catch (reason) {
    notes.push({ id: "catalog-first-load-error", error: String(reason?.message || reason) });
    await shot(page, "catalog-first-load-timeout").catch(() => {});
    throw reason;
  }
  const firstNav = await navigationTiming(page);
  const firstMeta = await readCatalogMeta(page);
  notes.push({
    id: "env",
    firstDocumentNav: firstNav,
    catalogTotal: firstMeta.total,
    catalogPages: firstMeta.pages,
    origin: ORIGIN,
  });
  await shot(page, "catalog-home");

  for (const search of SEARCH_CASES) {
    await runColdWarm(page, collector, {
      id: search.id,
      group: "search",
      prepare: async () => {
        await gotoCatalog(page);
      },
      action: () => submitSearch(page, search.query),
      waitReady: (mark) =>
        waitCatalogQuery(page, collector, mark, {
          q: search.query,
          page: 1,
        }),
      primaryKinds: ["catalog"],
    });
  }
  await shot(page, "search-last");

  await runColdWarm(page, collector, {
    id: "nav-courses-to-latest",
    group: "nav",
    prepare: async () => {
      await gotoCatalog(page);
    },
    action: () => clickNav(page, "课评"),
    waitReady: () => waitLatestIdle(page),
    primaryKinds: ["latest"],
  });
  await shot(page, "nav-latest");

  await runColdWarm(page, collector, {
    id: "nav-latest-to-courses",
    group: "nav",
    prepare: async () => {
      await gotoLatest(page);
    },
    action: () => clickNav(page, "课程"),
    waitReady: (mark) =>
      waitCatalogQuery(page, collector, mark, { q: "", category: "", page: 1 }),
    primaryKinds: ["catalog"],
  });

  for (const pill of CATEGORY_PILLS) {
    await runColdWarm(page, collector, {
      id: pill.id,
      group: "category",
      prepare: async () => {
        const away = pill.label === "全部" ? "体育" : "全部";
        await gotoCatalog(page);
        await clickCategory(page, away);
        await waitCatalogIdle(page);
      },
      action: () => clickCategory(page, pill.label),
      waitReady: (mark) =>
        waitCatalogQuery(page, collector, mark, {
          category: pill.category,
          page: 1,
        }),
      primaryKinds: ["catalog"],
    });
  }
  await shot(page, "category-last");

  await runColdWarm(page, collector, {
    id: "page-all-1-to-2",
    group: "catalog-page",
    prepare: async () => {
      await gotoCatalog(page, "page=1");
    },
    action: () => clickPager(page, "下一页"),
    waitReady: (mark) => waitCatalogQuery(page, collector, mark, { page: 2 }),
    primaryKinds: ["catalog"],
  });

  const lastPage = firstMeta.pages;
  if (lastPage > 2) {
    await runColdWarm(page, collector, {
      id: "page-all-last",
      group: "catalog-page",
      prepare: async () => {
        await gotoCatalog(page, "page=1");
      },
      action: () => clickPager(page, String(lastPage)),
      waitReady: (mark) =>
        waitCatalogQuery(page, collector, mark, { page: lastPage }),
      primaryKinds: ["catalog"],
    });
    await shot(page, "catalog-last-page");
  }

  await gotoCatalog(page);
  {
    const mark = collector.length;
    await clickCategory(page, "通识");
    await waitCatalogQuery(page, collector, mark, { category: "general", page: 1 });
  }
  const generalMeta = await readCatalogMeta(page);
  notes.push({ id: "general-meta", ...generalMeta });
  if (generalMeta.pages > 1) {
    await runColdWarm(page, collector, {
      id: "page-general-1-to-2",
      group: "catalog-page",
      prepare: async () => {
        await gotoCatalog(page, "category=general&page=1");
      },
      action: () => clickPager(page, "下一页"),
      waitReady: (mark) =>
        waitCatalogQuery(page, collector, mark, {
          category: "general",
          page: 2,
        }),
      primaryKinds: ["catalog"],
    });
  }

  await gotoCatalog(page);
  {
    const mark = collector.length;
    await clickCategory(page, "体育");
    await waitCatalogQuery(page, collector, mark, { category: "sports", page: 1 });
  }
  const sportsMeta = await readCatalogMeta(page);
  notes.push({ id: "sports-meta", ...sportsMeta });
  if (sportsMeta.pages > 1) {
    await runColdWarm(page, collector, {
      id: "page-sports-1-to-2",
      group: "catalog-page",
      prepare: async () => {
        await gotoCatalog(page, "category=sports&page=1");
      },
      action: () => clickPager(page, "下一页"),
      waitReady: (mark) =>
        waitCatalogQuery(page, collector, mark, {
          category: "sports",
          page: 2,
        }),
      primaryKinds: ["catalog"],
    });
  }

  await runColdWarm(page, collector, {
    id: "latest-load-more",
    group: "latest-page",
    prepare: async () => {
      await gotoLatest(page);
    },
    action: async () => {
      const more = page.getByRole("button", { name: "继续加载" });
      if ((await more.count()) === 0) {
        throw new Error("继续加载 button missing");
      }
      const before = await page.locator("main article, [role='main'] article").count();
      await more.click();
      await page.waitForFunction((prev) => {
        const pending = [...document.querySelectorAll("button")].some((el) =>
          (el.textContent || "").includes("加载中…"),
        );
        const count = document.querySelectorAll(
          "main article, [role='main'] article",
        ).length;
        return !pending && count > prev;
      }, before, { timeout: ACTION_TIMEOUT_MS });
    },
    waitReady: async () => {},
    primaryKinds: ["latest"],
  });
  await shot(page, "latest-load-more");

  await gotoCatalog(page);
  const topRow = page.locator("main a[href*='/courses/']").first();
  await topRow.waitFor({ timeout: 15_000 });
  const detailHref = await topRow.getAttribute("href");
  notes.push({ id: "review-detail-href", href: detailHref });
  await topRow.click();
  await page.waitForURL(/\/courses\/\d+/, { timeout: 15_000 });
  await waitReviewsIdle(page);
  await shot(page, "course-reviews");

  for (const sort of REVIEW_SORTS) {
    await runColdWarm(page, collector, {
      id: sort.id,
      group: "review-filter",
      prepare: async (heat) => {
        if (heat === "cold") return;
        const away = sort.option === "认可最多" ? "最新发布" : "认可最多";
        await openSelectOption(page, "点评筛选", away);
        await waitReviewsIdle(page);
      },
      action: () => openSelectOption(page, "点评筛选", sort.option),
      waitReady: () => waitReviewsIdle(page),
      primaryKinds: ["reviews"],
    });
  }

  for (const rating of REVIEW_RATINGS) {
    await runColdWarm(page, collector, {
      id: rating.id,
      group: "review-filter",
      prepare: async (heat) => {
        if (heat === "cold") return;
        const away = rating.option === "全部" ? "5 星" : "全部";
        const group = page.getByRole("group", { name: "点评筛选" });
        const triggers = group.getByRole("button");
        await triggers.nth(1).click();
        await page.getByRole("option", { name: away, exact: true }).click();
        await waitReviewsIdle(page);
      },
      action: async () => {
        const group = page.getByRole("group", { name: "点评筛选" });
        await group.getByRole("button").nth(1).click();
        await page.getByRole("option", { name: rating.option, exact: true }).click();
      },
      waitReady: () => waitReviewsIdle(page),
      primaryKinds: ["reviews"],
    });
  }
  await shot(page, "review-filters");

  const byId = new Map();
  for (const row of measurements) {
    if (!byId.has(row.id)) byId.set(row.id, []);
    byId.get(row.id).push(row);
  }
  const summary = [...byId.entries()].map(([id, rows]) => {
    const cold = rows.find((row) => row.heat === "cold");
    const warm = rows.filter((row) => row.heat.startsWith("warm"));
    return {
      id,
      group: rows[0]?.group,
      ok: rows.every((row) => row.ok),
      coldVisibleMs: cold?.visibleMs ?? null,
      warmVisibleMedianMs: median(warm.map((row) => row.visibleMs)),
      coldApiWallMs: cold?.primaryWallMs ?? null,
      warmApiWallMedianMs: median(warm.map((row) => row.primaryWallMs)),
      coldCache: cold?.cfCacheStatus ?? [],
      warmCache: warm.flatMap((row) => row.cfCacheStatus),
    };
  });

  const report = {
    origin: ORIGIN,
    ranAt: new Date().toISOString(),
    viewport: { width: 1280, height: 800 },
    warmRepeats: WARM_REPEATS,
    notes,
    summary,
    measurements,
    collector: collector.map((event) => ({
      kind: event.kind,
      status: event.status,
      wallMs: event.wallMs,
      durationMs: event.durationMs,
      ttfbMs: event.ttfbMs,
      cfCacheStatus: event.cfCacheStatus,
      url: event.url,
    })),
  };
  console.log(`UI walk scenarios=${summary.length}`);
  return report;
}

async function writeReport(report) {
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    join(ARTIFACTS, "prod-public-timing-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`\nWrote ${OUT}/report.json`);
}

async function main() {
  let http = { total: 0, pages: 0, detailId: null, teacherId: null, rows: [] };
  if (!process.env.SKIP_HTTP) {
    console.log("HTTP matrix (does not touch production UI)");
    http = await runHttpMatrix();
  }
  let ui = { summary: [], measurements: [], collector: [], notes: [] };
  const browser = await chromium.launch({ headless: true });
  try {
    ui = await runWalk(browser);
  } catch (reason) {
    notes.push({ id: "ui-walk-error", error: String(reason?.message || reason) });
    console.log(`UI walk aborted: ${reason?.message || reason}`);
  } finally {
    await browser.close();
  }
  const report = {
    origin: ORIGIN,
    ranAt: new Date().toISOString(),
    viewport: { width: 1280, height: 800 },
    warmRepeats: WARM_REPEATS,
    productUiUnchanged: true,
    notes: [...(http.notes ?? []), ...notes, ...(ui.notes ?? [])],
    http: {
      catalogTotal: http.total,
      catalogPages: http.pages,
      detailId: http.detailId,
      teacherId: http.teacherId,
      rows: http.rows,
    },
    summary: ui.summary,
    measurements: ui.measurements ?? measurements,
    collector: ui.collector ?? [],
  };
  await writeReport(report);
  if (
    measurements.some((row) => !row.ok) ||
    http.rows.some((row) => !row.ok)
  ) {
    process.exitCode = 1;
  }
}

await main();
