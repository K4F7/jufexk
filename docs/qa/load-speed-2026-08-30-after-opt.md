# 公开面加载速度 — 2026-08-30 优化后复测

对照基线 [`load-speed-2026-08-30.md`](./load-speed-2026-08-30.md)。
第二轮（#734）复测见 [`load-speed-2026-08-30-after-round2.md`](./load-speed-2026-08-30-after-round2.md)。
生产站当时已部署 [#720](https://github.com/K4F7/jxufe-course-review/pull/720)
（`perf: optimize public catalog loading and caching`，跟 [#705](https://github.com/K4F7/jufexk/issues/705)）。

未登录实测 **https://courses.sein.moe**。
用户在大陆。本探针出口经 `IAD`，墙钟含海外 RTT，**不当作用户指标**。
以 Worker `app` 为准。`cf-placement` 常见 `remote-SIN`。不是 RUM。

**不改生产站 UI。** `src/` 本轮为零 diff。

原始 JSON：`output/playwright/prod-public-timing/report.json`（gitignore）。
跑次：`2026-08-30T04:19:05Z`。目录仍是 **11167** 条 / **559** 页。

## 这轮优化在测什么

主干相对基线时点的公开面变化（只列影响加载的）：

- 列表读路径预计算改为 **stale + `waitUntil` 后台重建**，不再在请求里同步 `dirty` 重建。
- 课程详情、点评第一页、`/api/config` 与目录同一套 **`s-maxage=60, stale-while-revalidate=300`**（分 tag：`public-detail` / `public-config`）。
- 游客共享缓存前先过 **`isPublicCatalogCacheableRequest`**（带登录 / 投票 Cookie 则不进共享缓存）。
- 浏览器 30s 内存缓存 + 课程行 hover prefetch（主干 `src/lib/catalog-data-cache.ts`）。
- 公开页管理员会话：viewer 认证状态没变就不再重探。
- 每个 `/api/*` 带 **`Server-Timing: app;dur=`**。
- 体育虚拟行教师查询按名去重。

## 方法

与基线相同：每条 API 冷 1 次 + 热 2 次。
墙钟是本探针 `fetch` 全程，含海外 RTT，不当作用户指标。
`app` 是 Worker `Server-Timing`。用户结论只认 `app`。
热中位 HIT 约 **10–12ms**（边缘，大陆同样量级）。

## 对比（毫秒）

| 场景 | 基线冷 | 本次冷 | Worker `app` | 热中位 | 冷 Δ | 冷缓存 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 目录首页 | 1707 | 538 | 164 | 11 | **-68%** | EXPIRED |
| 搜索 线性代数 | 1479 | 380 | 79 | 10 | **-74%** | MISS |
| 搜索 孙爱琳 | 1369 | 368 | 66 | 11 | **-73%** | MISS |
| 搜索课号 `1004201162` | 1254 | 1403 | 1264 | 11 | +12% | MISS |
| 搜索短词「微」 | 1361 | 460 | 148 | 10 | **-66%** | MISS |
| 搜索未命中 | 870 | 360 | 38 | 12 | **-59%** | MISS |
| 通识 | 1212 | 1086 | 1023 | 10 | -10% | MISS |
| 数学 | 1121 | 375 | 57 | 12 | **-67%** | MISS |
| 思政 | 1125 | 351 | 47 | 10 | **-69%** | MISS |
| 英语 | 990 | 337 | 49 | 11 | **-66%** | MISS |
| 体育 | 1473 | 1301 | 1132 | 12 | -12% | MISS |
| 全部第 2 页 | 1766 | 435 | 121 | 11 | **-75%** | MISS |
| 全部末页 559 | 426 | 453 | 136 | 10 | +6% | MISS |
| 通识第 2 页 | 358 | 400 | 102 | 12 | +12% | MISS |
| 体育第 2 页（现已空页） | 1595 | 356 | 54 | 11 | 见下方说明 | MISS |
| 最新课评 | 305 | 272 | 14 | 293 | -11% | 仍 BYPASS |
| 课评继续加载 | 282 | 313 | 16 | 335 | +11% | 仍 BYPASS |
| 课程详情 `/api/courses/378` | 1082 | 351 | 48 | **12** | **-68%** | 现已可缓存 |
| 点评 认可最多 | 832 | 712 | 664 | **13** | -14% | 现已可缓存 |
| 点评 最新 / 最早 | 805 / 821 | 331 / 343 | 39 / 31 | 11 / 12 | **-58%** | MISS→HIT |
| 点评 评分最高 | 843 | 854 | 734 | 10 | +1% | MISS→HIT |
| 点评 5 星 / 1 星 | 547 / 569 | 597 / 611 | 443 / 503 | 31 / 12 | +7–9% | MISS→HIT |
| `/api/config` | 260 | 294 | 14 | **11** | 冷持平，热从 260→11 | 现已可缓存 |
| `/api/admin/session` | 48 | 280 | 0 | 291 | +483% | 仍 401 BYPASS |

## 浏览器可见（同一次 Playwright）

HTTP 矩阵先打过一遍，边缘多半已热。浏览器里部分目录请求是 **BYPASS**（不像无 Cookie 的 Node `fetch` 那样 HIT），和「带 `jufexk_voter` 等凭证就不进共享缓存」一致。

| 场景 | 可见就绪 | 关键 API | 缓存 |
| --- | ---: | ---: | --- |
| 搜索（线性代数等） | 448–595 | 335–485 | BYPASS |
| 课程 → 课评 | 357–375 | ~275 | BYPASS |
| 课评 → 课程 | 105–112 | 23–24 | HIT |
| 数学 / 思政 / 英语 pills | 402–460 | 339–379 | BYPASS |
| 通识 pill | 468–522 | 404–423 | BYPASS |
| 体育 pill | **1330–1342** | **1258–1265** | BYPASS |
| 全部换页（已 HIT） | 148–192 | 11–15 | HIT |
| 通识第 2 页 | 1170–1323 | 1005–1166 | BYPASS |
| 课评继续加载 | 363–382 | 289–309 | BYPASS |
| 点评改排序（已 HIT / 会话缓存） | 103–415 | 13–18 或无 XHR | HIT / 内存 |

## 结论

公开面冷路径整体明显变快。最大头来自 **预计算不再挡读** 和 **详情 / 点评 / config 能进 60s 边缘缓存**：

- 首页、多数搜索、数学/思政/英语、全部第 2 页：冷墙钟从 **1.0–1.8s 掉到 0.3–0.5s**。
- 体育列表现为 **2 条 / 1 页**（响应约 563 B）。基线「体育第 2 页」当时还有数据（约 1.6s）；本次 page=2 是空页（55 B / Worker 54ms），**不能当成同类加速**。
- 课程详情冷 **1.08s → 0.35s**，热 **12ms**（基线热仍是 1s+ BYPASS）。
- 点评「认可最多」冷仍约 0.7s（Worker 664ms），但热从 **700ms → 13ms**。
- 最新课评 Worker **14ms**。探针墙钟 ~280ms 是美东 RTT，大陆用户看不到。`no-store` 没变。

还慢、且这次没吃到同样红利的：

1. **通识 / 体育第一页** Worker 仍 **1.0–1.1s**（墙钟 1.1–1.3s）。体育这次只吐 **2 行** 也要 1.1s，不是「列表太大」。浏览切换里最肉眼可见。
2. **课号搜索** 无 Cookie 的 HTTP 冷路径 Worker **1264ms**（墙钟 1403，比基线还略差）。同一跑次里 Playwright 稍后打到 **485ms BYPASS**——预计算后台重建已经完成，但带投票 Cookie 仍不进共享缓存。
3. **点评「认可最多」「评分最高」** 源站仍 **0.7s**；缓存只救回访。
4. **浏览器目录常 BYPASS**，游客一旦有投票 Cookie，60s CDN 帮不上忙。
5. **`/api/admin/session` 401** Worker `app=0`。探针墙钟 ~280ms 是海外 RTT，不是业务查询，也不是大陆用户会付的价。

## 建议（仍不改可见加载文案）

1. 通识、体育首页和课号搜索：看 `Server-Timing` 对上的 SQL（类别过滤 + 虚拟体育行 / code 精确+FTS）。这三块现在是公开目录的尾巴。
2. 「认可最多」排序的点评查询（`endorsement_count`）值得单独收。缓存已经托住热路径。
3. 评估 `jufexk_voter` 是否必须让**目录列表** BYPASS。投票态只影响点评动作时，列表可以继续共享。
4. `/latest` Worker 已是十几毫秒，可维持 `no-store`。不要按本探针的海外墙钟判断课评流慢。
5. 公开壳的 admin session：Worker 已是 0ms。匿名详情能不打最好；不要按本探针 280ms 墙钟排优先级。

## 源码（优化后）

| 能力 | 文件 |
| --- | --- |
| stale 预计算 | [`public-list-precompute.ts`](../../src/public-list-precompute.ts) `mode: "stale"` |
| 分 scope 缓存 | [`public-catalog-cache.ts`](../../src/lib/public-catalog-cache.ts) |
| 路由挂 cache / stale 读 | [`public-catalog.ts`](../../src/routes/public-catalog.ts) |
| `Server-Timing` | [`index.ts`](../../src/index.ts) |
| 浏览器 30s 缓存 + prefetch | 主干 [`src/lib/catalog-data-cache.ts`](https://github.com/K4F7/jxufe-course-review/blob/main/src/lib/catalog-data-cache.ts)（本 QA 分支未含 #720 源码） |
| 管理员会话少探 | [`useAdminSession.tsx`](../../src/hooks/useAdminSession.tsx) |

关系列表查询仍是 [`queryPublicCourseRelations`](../../src/public-catalog-query.ts)。
课评流仍是 [`public-reviews-latest.ts`](../../src/public-reviews-latest.ts)，未缓存。

## 复现

```bash
pnpm run timing:prod-public
```

不进 CI。不登录、不写评价、不点「导师」。
