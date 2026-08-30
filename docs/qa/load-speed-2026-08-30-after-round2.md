# 公开面加载速度 — 2026-08-30 第二轮优化后复测

对照：

- 基线（#720 前）：[`load-speed-2026-08-30.md`](./load-speed-2026-08-30.md)
- 第一轮后（#720）：[`load-speed-2026-08-30-after-opt.md`](./load-speed-2026-08-30-after-opt.md)

生产已部署 [#734](https://github.com/K4F7/jxufe-course-review/pull/734)
（`perf: 公开面第二轮尾部优化与复测`，跟 [#723](https://github.com/K4F7/jxufe-course-review/issues/723)）。
另有 [#732](https://github.com/K4F7/jxufe-course-review/pull/732) 首屏 JS 拆分；首页改到 `/latest`。

未登录实测 **https://courses.sein.moe**。
同一套 `pnpm run timing:prod-public`，同一 Cloud Agent 出口（`cf-ray` 仍经 `IAD`）。
`cf-placement` 常见 `remote-SIN`。仍是单点远端样本，不是 RUM。

**不改生产站 UI。** `src/` 本轮为零 diff。

跑次：`2026-08-30T12:59:53Z`。目录仍是 **11167** 条 / **559** 页。
体育恢复为 **37** 条 / **2** 页（第一轮复测时只剩 2 条 / 1 页）。
通识仍是 **8564** 条 / **429** 页。

## 这轮优化在测什么

相对 #720 时点、影响上次指出的尾巴：

- 精确课号走 `c.code=?`，不再跑 FTS/相关度。
- 目录查询去掉 `COUNT(*) OVER()`，改 pageSize+1 + 并发 count。
- 虚拟体育按名批量查教师，并按名称并进分页。
- 点评认可/质疑用投影表，排序不再现场聚合。
- 普通课程列表允许只带 `jufexk_voter` 进共享缓存；**关系列表仍严格 BYPASS**。
- 管理员会话改 `ensure` 按需探测，匿名详情不再打 `/api/admin/session`。
- `Server-Timing` 拆出 `query` / `projection`。

## 方法

与前两轮相同：每条 API 冷 1 次 + 热 2 次。
墙钟是客户端 `fetch` 全程；`app` / `query` 是 Worker `Server-Timing`（不含边缘到本机的 RTT）。

复测前用同一出口探针打过首页、课号、通识、体育，所以这四条 HTTP「冷」墙钟是 **HIT ~10ms**，不能当源站冷对比。
下表对这四条以 **Worker `query`/`app`** 为准（HIT 响应仍带回生成时的源站耗时）。其余 MISS/BYPASS 同时给墙钟。

点评 HTTP `sort=rating_desc` 现为 **400**（生产只接受 `recognized` / `latest` / `oldest`）。
Playwright 点评筛选整段失败：默认「最新」、多选星级、选项文案对不上本 QA 分支的旧选择器。**源站快慢以 HTTP 为准。**

## 对比（毫秒）

| 场景 | 基线冷墙 | #720 冷墙 / app | 本次源站 `app` | 本次冷墙 | 相对 #720 源站 | 冷缓存 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 目录首页 | 1707 | 538 / 164 | 244 | 57（HIT） | +49% | HIT |
| 搜索 线性代数 | 1479 | 380 / 79 | 121 | 445 | +53% | MISS |
| 搜索 孙爱琳 | 1369 | 368 / 66 | 97 | 411 | +47% | MISS |
| 搜索课号 `1004201162` | 1254 | 1403 / **1264** | **105** | 11（HIT） | **-92%** | HIT |
| 搜索短词「微」 | 1361 | 460 / 148 | 135 | 449 | -9% | MISS |
| 搜索未命中 | 870 | 360 / 38 | 48 | 366 | +26% | MISS |
| 通识 | 1212 | 1086 / **1023** | **163** | 10（HIT） | **-84%** | HIT |
| 数学 | 1121 | 375 / 57 | 51 | 349 | -11% | MISS |
| 思政 | 1125 | 351 / 47 | 74 | 396 | +57% | MISS |
| 英语 | 990 | 337 / 49 | 79 | 388 | +61% | MISS |
| 体育 | 1473 | 1301 / **1132** | **104** | 14（HIT） | **-91%** | HIT |
| 全部第 2 页 | 1766 | 435 / 121 | 137 | 458 | +13% | MISS |
| 全部末页 | 426 | 453 / 136 | 181 | 484 | +33% | MISS |
| 通识第 2 页 | 358 | 400 / 102 | 111 | 441 | +9% | MISS |
| 体育第 2 页 | 1595 | 356 / 54（当时空页） | 91 | 408 | 现为有数据的第 2 页 | MISS |
| 最新课评 | 305 | 272 / 14 | 22 | 313 | +57% | 仍 BYPASS |
| 课评继续加载 | 282 | 313 / 16 | 21 | 319 | +31% | 仍 BYPASS |
| 课程详情 | 1082 | 351 / 48 | 61 | 393 | +27% | MISS |
| 点评 认可最多 | 832 | 712 / **664** | **45** | 360 | **-93%** | MISS |
| 点评 最新 / 最早 | 805 / 821 | 331 / 343 · 39 / 31 | 57 / 41 | 402 / 348 | +46% / +32% | MISS |
| 点评 评分最高 | 843 | 854 / 734 | — | 267 | API 已去掉 `rating_desc`（400） | BYPASS |
| 点评 5 星 / 1 星 | 547 / 569 | 597 / 611 · 443 / 503 | **36 / 40** | 345 / 328 | **-92% / -92%** | MISS |
| `/api/config` | 260 | 294 / 14 | 9 | 11（HIT） | 热仍 ~10ms | HIT |
| `/api/admin/session` | 48 | 280 / 0 | 0 | 268 | 墙钟仍是 RTT | 仍 401 BYPASS |

热中位：可缓存接口仍 **9–13ms HIT**。`/latest` 热仍 ~300ms BYPASS。

## 浏览器可见（同一次 Playwright）

关系列表带 `jufexk_voter` 仍 **BYPASS**（#734 只放宽了普通课程列表）。
HTTP 矩阵先打过，边缘多半已热；关系查询仍回源。

| 场景 | #720 可见 | 本次可见 | 本次 API | 缓存 |
| --- | ---: | ---: | ---: | --- |
| 搜索 线性代数 | 524 | 544 | 415 | MISS→热 HIT |
| 搜索 孙爱琳 / 课号 /「微」 | 428–595 | 476–572 | 388–468 | 仍 BYPASS |
| 课程 → 课评 | 375 | 384 | 296 | BYPASS |
| 课评 → 课程 | 105 | 109 | 11 | HIT |
| 通识 pill | 522 | 564 | 485 | BYPASS |
| 数学 / 英语 pills | 419–443 | 453–491 | 379–426 | BYPASS |
| 思政 pill | 460 | **1515** | **1444** | BYPASS（单次偏高，HTTP 源站只有 74ms） |
| 体育 pill | **1335** | **521** | 455 | BYPASS |
| 全部换页（已 HIT） | 148–164 | 179–181 | 12–15 | HIT |
| 通识第 2 页 | **1323** | **547** | 423 | BYPASS |
| 体育第 2 页 | （当时无第 2 页） | 530 | 407 | BYPASS |
| 课评继续加载 | 367 | 418 | 321 | BYPASS |
| 点评改排序 / 星级 | 103–415 | 失败 | — | 选择器对不上现网 UI |

## 结论

第二轮对准上次点名的尾巴，源站耗时掉了一个数量级：

1. **课号搜索** Worker **1264 → 105**（-92%）。
2. **通识第一页** Worker **1023 → 163**（-84%）。
3. **体育第一页** Worker **1132 → 104**（-91%）。体育重新变成 37 条 / 2 页，第 2 页有数据（91ms / 408ms 墙钟），不再是空页假加速。
4. **点评「认可最多」** Worker **664 → 45**（-93%）。5 星 / 1 星过滤 **443/503 → 36/40**。
5. 浏览器里最肉眼可见的是体育 pill **1.3s → 0.52s**、通识第 2 页 **1.3s → 0.55s**。

没有变、或不是这轮目标的：

- `/latest` Worker 仍 **16–25ms**，墙钟 ~300ms 仍是美东 RTT。`no-store` 没变。
- 关系列表带投票 Cookie 仍 BYPASS，所以 pill / 多数搜索的浏览器热路径还是 0.4–0.5s，吃不到 10ms CDN。
- `/api/admin/session` 401 墙钟仍 ~270ms（`app=0`）。匿名详情按设计不再打；公开壳若仍探，第一次还是这笔 RTT。
- 普通搜索（线性代数、孙爱琳、「微」）源站 97–135ms，和 #720 同一量级，略有波动。
- 思政 pill 这次浏览器 **1.5s** 是单次偏高；同出口 HTTP 只有 74–184ms。不要据此判断回归。

## 建议

1. 关系列表若也不序列化游客投票态，可像普通课程列表一样忽略 `jufexk_voter`。pill / 搜索热路径就能从 0.4s 掉到 ~10ms。
2. `/latest` 可维持 `no-store`；墙钟已是 RTT。
3. 计时脚本的 `sort=rating_desc` 和点评 Select 文案要跟现网（默认最新、多选星级、排序只剩认可/最新/最早）。这不影响本次源站结论。

## 源码（#734，主干）

| 能力 | 位置 |
| --- | --- |
| 课号快路径 / 去窗口总数 / 体育并页 | [`public-catalog-query.ts`](https://github.com/K4F7/jxufe-course-review/blob/main/src/public-catalog-query.ts) |
| 列表可带 voter 缓存 | [`public-catalog-cache.ts`](https://github.com/K4F7/jxufe-course-review/blob/main/src/lib/public-catalog-cache.ts) `isPublicCourseListCacheableRequest` |
| 点评投影排序 | [`public-catalog.ts`](https://github.com/K4F7/jxufe-course-review/blob/main/src/routes/public-catalog.ts) |
| 管理员会话按需 | [`useAdminSession.tsx`](https://github.com/K4F7/jxufe-course-review/blob/main/src/hooks/useAdminSession.tsx) `ensure` |

## 复现

```bash
pnpm run timing:prod-public
```

不进 CI。不登录、不写评价、不点「导师」。
