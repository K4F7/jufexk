# Production public walk — 2026-08-26

Unauthenticated first-visit walk of **https://courses.sein.moe**.
Headless Chromium via `node scripts/prod-public-smoke.mjs` (Playwright 1.62.1).
Viewport 1280×800. No login, no review POST, no 导师 / Tencent sheets.

Reconnaissance-then-action: `networkidle` → wait for catalog idle →
screenshot → inspect roles → act.

Superseded / production now: first-load uses `CourseRelationRow` skeletons
（`加载中…`）, not `正在更新课程目录…`. Category-empty copy is
`目录暂无课程数据`; only top-bar `q` is a search-miss. The observations
below are a 2026-08-26 snapshot.

Raw machine report: `output/playwright/prod-public-smoke/report.json`
(gitignored). Screenshots are written under that directory's `artifacts/`
subdirectory by default; set `PROD_PUBLIC_SMOKE_ARTIFACTS` to override it.
Re-run: `node scripts/prod-public-smoke.mjs`.

The runner blocks and fails on login/review write requests. It also
fails when a browser `pageerror` occurs, even if all page assertions passed.

## Summary

| Status | Count |
| --- | ---: |
| passed | 17 |
| failed | 0 |
| skipped | 2 |

No product defects were observed on the exercised public paths.

## Passed

| Id | What was observed |
| --- | --- |
| `home-redirect` | `GET /` → `/courses` HTTP 200. |
| `courses-catalog` | 课程列表 loads. Nav is **课程 / 课评 / 导师**. Filters: 全部 / 通识 / 数学 / 思政 / 英语 / 体育. Default sort 评价数量. **共 11036 条** (course×teacher rows). |
| `filter-全部` | 全部 → `/courses`, 11036 条. |
| `filter-体育` | 体育 → `?category=sports`, **37 条**. First rows are 体育1-4 [乒乓球/击剑/…] . |
| `filter-英语` | 英语 → `?category=english`, **848 条**. |
| `filter-思政` | 思政 → `?category=ideology`, **769 条**. |
| `filter-数学` | 数学 → `?category=math`, **510 条**. |
| `search-线性代数` | Header search submits `q=线性代数`. Sort becomes 相关度. **共 65 条**. First hits: 线性代数（何明 / 何忠伟 / 吴佳伟 / …）. |
| `course-detail` | Opened `/courses/1323?teacher=194` 线性代数（何明）. Course code 1004703613, 6 reviews, AI 总结, 写点评, sidebar 其他老师的这门课. Dimension dashes / empty stars on historical rows. |
| `path-latest` | `/latest` heading **最新课评**. Authors include 匿名用户#000000. |
| `nav-课评` | 主导航「课评」→ `/latest`. |
| `login-page` | `/login` 账号密码 / 扫码登录. Fields **学号** + **校园密码**. Credentials not entered. |
| `submit-login-gate` | `/submit` → `/login?from=%2Fsubmit`. No review form, no POST. |
| `schedule-direct` | Direct `/schedule` works. Heading 排课模拟; 学期/年级/专业; empty 待选课表 / 开课班 / 模拟课表. Not in production nav. |
| `about` | Footer-linked `/about` heading 关于我们. |
| `teachers` | `/teachers` not in nav/footer; URL still works. Heading 教师资料, **1951 位教师**. |
| `soft-404` | `/this-page-should-not-exist` HTTP **200**, copy **页面不存在** + 返回首页. |

## Skipped (known product)

| Id | Why |
| --- | --- |
| `nav-hides-schedule` | Production nav omits 排课模拟 ([ADR-0030](../adr/0030-schedule-desktop-only.md)). Confirmed. `/schedule` still passed via direct URL. |
| `path-最新` | `GET /最新` is a SPA soft 404 (HTTP 200, 页面不存在). 课评 lives at `/latest`. Not an alias. |

## Console / page errors

**Page errors:** 0.

**Console `error` (11):** every one is
`Failed to load resource: the server responded with a status of 401 ()`
from `GET /api/admin/session` on each public navigation. Expected for a guest;
the shell probes admin session and the 401 is not a public-page failure.

**Console `warning`:** Chromium
`Error with Feature-Policy header: Some features are specified in both Feature-Policy and Permissions-Policy header: …`
on several navigations. Cloudflare / browser policy-header overlap, not app JS.

No React render errors, no failed catalog/review API calls in the console log.

## Screenshots

Taken after catalog idle. Numbered files also live under
`output/playwright/prod-public-smoke/` when the script is re-run.

| File | Step |
| --- | --- |
| `02-courses-catalog.png` | `/courses`, 全部, 11036 条 |
| `04-filter-体育.png` | 体育 filter, 37 条 |
| `08-search-linear-algebra.png` | `q=线性代数`, 65 条 |
| `09-course-detail.png` | 线性代数（何明） |
| `11-latest.png` | `/latest` |
| `13-login.png` | `/login` 学号+校园密码 |
| `14-submit-gate.png` | `/submit` redirected to login |
| `15-schedule.png` | `/schedule` empty first-visit |
| `17-about.png` | `/about` |
| `18-teachers.png` | `/teachers` |
| `19-soft-404.png` | unknown path |

## Durable tests

**Not added.** Existing `test/browser/*.browser.test.ts` already cover the same
surfaces against the local Vite prototype with mocked APIs:

- catalog filters / search — `catalog-category-filter.browser.test.ts`
- `/latest` — `latest-feed.browser.test.ts`
- login form + 学号/校园密码 — `login-page.browser.test.ts`
- guest `/submit` → `/login?from=` — `submit-review.browser.test.ts`
- SPA 404 — `not-found.browser.test.ts`
- `/about` footer — `site-footer.browser.test.ts`
- schedule nav visibility — `test/public-surface.node.test.ts` +
  `docs/adr/0030-schedule-desktop-only.md`

Those tests must not hit production. `import.meta.env.DEV` always shows 排课模拟
in the Playwright prototype, so a production-nav hide assertion does not fit
that runner. `scripts/prod-public-smoke.mjs` is a manual live walk only;
it is not wired into `pnpm test:browser` or CI.

Optional later (only if product wants an alias): a Worker or SPA redirect
`/最新` → `/latest`. Current behavior is the known soft 404.
