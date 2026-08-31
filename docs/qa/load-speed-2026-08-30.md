# 公开面加载速度 — 2026-08-30

> 这是 **#705 / #720 优化前** 的基线。
> 三轮总结见 [load-speed-2026-08-30-summary.md](./load-speed-2026-08-30-summary.md)。
> 第一轮后见 [load-speed-2026-08-30-after-opt.md](./load-speed-2026-08-30-after-opt.md)。
> 第二轮后见 [load-speed-2026-08-30-after-round2.md](./load-speed-2026-08-30-after-round2.md)。
> 2026-08-31 复测见 [load-speed-2026-08-31.md](./load-speed-2026-08-31.md)。

未登录实测 **https://courses.sein.moe**。
用户在大陆。本探针出口在 Cloudflare `IAD`，墙钟含海外 RTT，**不当作用户指标**。
有 `Server-Timing` 之后以 `app` / `query` 为准。这是单点样本，不是 RUM。

计时：`pnpm run timing:prod-public` → `scripts/prod-public-timing.mjs`。
原始 JSON：`output/playwright/prod-public-timing/report.json`（gitignore）。

**不改生产站 UI。** 目录空闲只认现有 #418 骨架读屏钩子
`[role=status][aria-label=加载中…]`，不写回「正在更新课程目录」。

预览 Worker `jufexk-preview`：仓库里 D1 `database_id` 仍是占位符，
GHA `deploy.yml` 会跳过 preview 部署。本环境没有 `CLOUDFLARE_API_TOKEN`，
不能 `wrangler deploy --env preview`。本地 `wrangler dev :8787` 只有种子目录
（32 条关系），不能代表公开面。要把脚本指到已有预览站：

```bash
PROD_PUBLIC_ORIGIN=https://jufexk-preview.<account>.workers.dev pnpm run timing:prod-public
```

不必走 GitHub Actions。

## 方法

- 每条 API：冷 1 次 + 热 2 次（同进程立刻重打）。
- 目录 GET：`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`。
- 课评 / 课程详情 / `/api/config`：`no-store`，`cf-cache-status: BYPASS`。
- 用户可见：点击/提交 → 列表就绪。HTTP 矩阵先跑，浏览器里目录多为 CDN HIT。
- 刷新目录会保留旧「共 N 条」，只等骨架会过早返回；脚本已改为等 URL + 新的
  `GET /api/courses?view=relations`。下表 **API 墙钟以 HTTP 矩阵为准**。
  浏览器可见只收录确有对应 XHR 的样本。

首屏文档 Navigation Timing：TTFB 62ms，DCL 194ms（SPA 壳，目录数据另算）。

## API 墙钟（毫秒）

冷 = 该 URL 本轮第一次（MISS 或 EXPIRED）。热 = 随后两次的中位。

### 顶栏搜索 → `GET /api/courses?view=relations&q=`

| 场景 | 冷 | 热中位 | 冷缓存 |
| --- | ---: | ---: | --- |
| 课程名「线性代数」 | 1479 | 11 | MISS |
| 教师「孙爱琳」 | 1369 | 11 | MISS |
| 课号 `1004201162` | 1254 | 11 | MISS |
| 短词「微」 | 1361 | 11 | MISS |
| 未命中 `zzqxnevermatch999` | 870 | 11 | MISS |

### 主导航

| 场景 | 冷 | 热中位 | 缓存 |
| --- | ---: | ---: | --- |
| 课程 → 课评 `GET /api/reviews/latest` | 305 | 296 | 总是 BYPASS |
| 课评 → 课程 `GET /api/courses?view=relations` | 1707（首页冷） | 11 | 热 HIT |
| 浏览器：课程 → 课评 可见就绪 | 384–396 | — | API ~300 + 约 80ms 壳 |

导师是外链 pi-review，未跟。

### 类别 pills → `GET /api/courses?view=relations&category=`

| 场景 | 冷 | 热中位 | 冷缓存 |
| --- | ---: | ---: | --- |
| 首页全部 `page=1` | 1707 | 11 | EXPIRED |
| 通识 | 1212 | 11 | MISS |
| 数学 | 1121 | 11 | MISS |
| 思政 | 1125 | 11 | MISS |
| 英语 | 990 | 10 | MISS |
| 体育 | 1473 | 10 | MISS |

### 换页

目录默认 `pageSize=20`。当时全量 **11167** 条关系、**559** 页。

| 场景 | 冷 | 热中位 | 冷缓存 |
| --- | ---: | ---: | --- |
| 全部 第 2 页 | 1766 | 11 | MISS |
| 全部 末页 559 | 426 | 12 | MISS |
| 通识 第 2 页 | 358 | 10 | MISS |
| 体育 第 2 页 | 1595 | 9 | MISS |
| 课评「继续加载」`/api/reviews/latest?cursor=` | 282 | 276 | BYPASS |
| 浏览器：课评继续加载 可见 | 336–347 | — | API ~265 + 约 70ms |

末页比第 2 页快，说明当前痛点不是深 `OFFSET`，而是默认「评价数量」排序下的
首页/邻页关系查询（计数 + 相关度 CASE + 预计算）。

### 课程页课评筛选

打开当时投稿最多的关系：`/courses/378?teacher=565`（货币银行学 / 孙爱琳，13 条）。

| 场景 | 冷 | 热中位 | 缓存 |
| --- | ---: | ---: | --- |
| `GET /api/courses/378` 详情 | 1082 | 1056 | 总是 BYPASS |
| 排序 认可最多 | 832 | 701 | BYPASS |
| 排序 最新 / 最早 / 评分最高 | 805–843 | 788–826 | BYPASS |
| 评分 5 星 / 1 星 | 547 / 569 | 533 / 541 | BYPASS |
| 浏览器：第一次改排序 可见 | 889–1172 | — | 回选同一项走会话缓存，约 80–110ms、无 XHR |

### 壳上额外请求（每页都会打）

| 请求 | 墙钟 | 状态 |
| --- | ---: | --- |
| `GET /api/config` | 255–263 | 200 BYPASS |
| `GET /api/admin/session` | 48–52 | 401 BYPASS（游客预期） |

## 源码落点

| 交互 | UI | `api()` | 路由 / 查询 |
| --- | --- | --- | --- |
| 顶栏搜索 | [`AppShell.tsx`](../../src/components/AppShell.tsx) `ShellCourseSearch` | [`CoursesPage.tsx`](../../src/pages/CoursesPage.tsx) `GET /api/courses?view=relations&q=` | [`public-catalog.ts`](../../src/routes/public-catalog.ts) → [`queryPublicCourseRelations`](../../src/public-catalog-query.ts)；词法 [`catalog-search.ts`](../../src/lib/catalog-search.ts)、排序 [`catalog-search-ranking.ts`](../../src/lib/catalog-search-ranking.ts) |
| 主导航 | [`AppShell.tsx`](../../src/components/AppShell.tsx) 课程 `/courses`、课评 `/latest` | 上表；[`LatestPage.tsx`](../../src/pages/LatestPage.tsx) | [`handleLatestPublicReviews`](../../src/public-reviews-latest.ts) historical ∪ legacy ∪ reviews |
| 类别 pills | [`CoursesPage.tsx`](../../src/pages/CoursesPage.tsx) + [`public-categories.ts`](../../src/lib/public-categories.ts) | 同目录 API，`category=` | [`publicCategoryFilterSql`](../../src/lib/public-course-presentation.ts)；体育合并 [`VIRTUAL_PE_SPORTS`](../../src/lib/public-course-presentation.ts) |
| 目录换页 | [`CatalogResultsStates.tsx`](../../src/components/CatalogResultsStates.tsx) HeroUI `Pagination`，`?page=` | 同目录 API | `COUNT(*)` + `COUNT(*) OVER()` + `ensurePublicListPrecomputes`（[`public-list-precompute.ts`](../../src/public-list-precompute.ts)） |
| 课评换页 | [`LatestPage.tsx`](../../src/pages/LatestPage.tsx) + [`useLoadMoreOnVisible.ts`](../../src/hooks/useLoadMoreOnVisible.ts) | `GET /api/reviews/latest?cursor=` | 同上 union |
| 点评筛选 | [`CourseReviewSection.tsx`](../../src/components/CourseReviewSection.tsx) 排序/星级；状态在 [`CourseDetailPage.tsx`](../../src/pages/CourseDetailPage.tsx) | `GET /api/courses/:id/reviews?teacherId=&sort=&rating=` | [`getPublicReviewPage`](../../src/routes/public-catalog.ts) |
| 访客 CDN | — | — | [`public-catalog-cache.ts`](../../src/lib/public-catalog-cache.ts) `s-maxage=60` |

## 瓶颈（只写表能撑住的）

1. **目录未命中缓存要 0.9–1.8s。** 热 10ms 说明边缘缓存有效。游客第一次点新 `q` / `category` / `page` 都付原价。读路径会 `ensurePublicListPrecomputes`；`dirty` 时同步重建。
2. **课程详情稳定 ~1.05s 且永不缓存。** 打开任课关系页比再搜一次还慢。
3. **点评筛选首次 ~0.5–0.8s API、可见可到 ~1.2s。** `no-store`。回到已选过的排序/星级走 React 会话缓存，几乎不打网。
4. **体育 pill 与体育第 2 页偏慢（1.5–1.6s）。** 与虚拟体育行合并一致；通识第 2 页只要 358ms。
5. **课评流没有目录那种秒级尖峰。** 探针墙钟 ~300ms 含美东 RTT，不当作用户指标。
6. **`/api/admin/session` 401** 当时探针约 50ms。不挡目录；大陆用户侧更短。
7. **未命中搜索（870ms）快于命中（1.2–1.5s）。** 有命中才走完整相关度 CASE / 名称变体 `EXISTS`。

## 建议（本轮不实现）

按收益 / 侵入排序。都不改可见加载文案。

1. **给游客课程详情和点评第一页加短 `s-maxage` + 现有 `public-catalog` tag。**
   详情 1s、点评 0.8s 每次都打源站。和目录同一套 purge。
2. **列表读路径不要同步重建预计算。** `dirty` 时用旧投影，后台刷新。对应首页 1.7s。
3. **体育浏览少做虚拟行逐条 `COUNT`。** 体育第 2 页 1595ms vs 通识 358ms。
4. **公开壳不要探管理员会话。** 或延后到真正进 `/admin`。每页少一次 401。
5. **`/api/config` 也可短缓存。** 260ms × 每页。
6. **点评筛选的会话缓存已经对。** 优先缓存 HTTP，而不是再加可见 Spinner。
7. **要加快回归：本机 `wrangler deploy --env preview`，不要等 GHA。**
   先 `pnpm db:create-preview` 换掉占位 D1，再 `pnpm db:clone-preview`。
   计时脚本用 `PROD_PUBLIC_ORIGIN`。CI 的 preview 步在占位符未换掉前本来就会 skip。

## 复现

```bash
pnpm run timing:prod-public
# 或
PROD_PUBLIC_ORIGIN=https://courses.sein.moe node scripts/prod-public-timing.mjs
```

不进 CI。不登录、不写评价、不点「导师」。
