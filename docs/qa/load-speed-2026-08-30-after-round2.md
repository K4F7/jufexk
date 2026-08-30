# 公开面加载速度 — 2026-08-30 第二轮优化后复测

对照：

- 基线（#720 前）：[`load-speed-2026-08-30.md`](./load-speed-2026-08-30.md)
- 第一轮后（#720）：[`load-speed-2026-08-30-after-opt.md`](./load-speed-2026-08-30-after-opt.md)

生产已部署 [#734](https://github.com/K4F7/jxufe-course-review/pull/734)
（`perf: 公开面第二轮尾部优化与复测`，跟 [#723](https://github.com/K4F7/jxufe-course-review/issues/723)）。
另有 [#732](https://github.com/K4F7/jxufe-course-review/pull/732) 首屏 JS 拆分；首页改到 `/latest`。

未登录实测 **https://courses.sein.moe**。
**用户都在大陆。** 本探针出口经 `IAD`，墙钟含海外 RTT（常见 250–300ms），**不当作用户指标，也不用来排优先级**。
只认 Worker `Server-Timing` 的 `app` / `query`。`cf-placement` 常见 `remote-SIN`。不是 RUM。

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
**只比较 Worker `app` / `query`。** 探针墙钟含 IAD 海外 RTT，表里不写、结论不用。

复测前探针打过首页、课号、通识、体育；HIT 响应仍带回生成时的 `Server-Timing`，源站对比仍有效。

点评 HTTP `sort=rating_desc` 现为 **400**（生产只接受 `recognized` / `latest` / `oldest`）。
Playwright 点评筛选整段失败：默认「最新」、多选星级、选项文案对不上本 QA 分支的旧选择器。**快慢以 HTTP `app` 为准。**

## 对比（Worker `app`，毫秒）

| 场景 | #720 `app` | 本次 `app` | 相对 #720 | 冷缓存 |
| --- | ---: | ---: | ---: | --- |
| 目录首页 | 164 | 244 | +49% | HIT |
| 搜索 线性代数 | 79 | 121 | +53% | MISS |
| 搜索 孙爱琳 | 66 | 97 | +47% | MISS |
| 搜索课号 `1004201162` | **1264** | **105** | **-92%** | HIT |
| 搜索短词「微」 | 148 | 135 | -9% | MISS |
| 搜索未命中 | 38 | 48 | +26% | MISS |
| 通识 | **1023** | **163** | **-84%** | HIT |
| 数学 | 57 | 51 | -11% | MISS |
| 思政 | 47 | 74 | +57% | MISS |
| 英语 | 49 | 79 | +61% | MISS |
| 体育 | **1132** | **104** | **-91%** | HIT |
| 全部第 2 页 | 121 | 137 | +13% | MISS |
| 全部末页 | 136 | 181 | +33% | MISS |
| 通识第 2 页 | 102 | 111 | +9% | MISS |
| 体育第 2 页 | 54（当时空页） | 91 | 现为有数据的第 2 页 | MISS |
| 最新课评 | 14 | 22 | +8ms | 仍 BYPASS |
| 课评继续加载 | 16 | 21 | +5ms | 仍 BYPASS |
| 课程详情 | 48 | 61 | +13ms | MISS |
| 点评 认可最多 | **664** | **45** | **-93%** | MISS |
| 点评 最新 / 最早 | 39 / 31 | 57 / 41 | +18 / +10 | MISS |
| 点评 评分最高 | 734 | — | API 已去掉 `rating_desc`（400） | BYPASS |
| 点评 5 星 / 1 星 | 443 / 503 | **36 / 40** | **-92% / -92%** | MISS |
| `/api/config` | 14 | 9 | -5ms | HIT |
| `/api/admin/session` | 0 | 0 | 业务仍是 0 | 仍 401 BYPASS |

可缓存接口热路径边缘 HIT 约 10ms（大陆边缘同样量级）。`/latest` 热路径 Worker 仍十几毫秒。

## 浏览器（只用来核对缓存是否 BYPASS）

关系列表带 `jufexk_voter` 仍 **BYPASS**（#734 只放宽了普通课程列表）。
Playwright 可见时间含本探针海外 RTT，**不写进用户结论**。源站以 HTTP `app` 为准。

能对上 HTTP 的：体育 pill / 通识第 2 页跟源站一起从 ~1s 掉到 ~100ms 量级。
思政 pill 这次浏览器 API 1444ms，同出口 HTTP 只有 74–184ms，当单次偏高，不判断回归。
点评改排序 / 星级选择器对不上现网 UI，整段失败。

## 结论

第二轮对准上次点名的尾巴，**源站**掉了一个数量级。大陆用户付的是这笔时间加国内边缘 RTT，不是本探针的 250–300ms 海外跳。

1. **课号搜索** **1264 → 105**（-92%）。
2. **通识第一页** **1023 → 163**（-84%）。
3. **体育第一页** **1132 → 104**（-91%）。体育重新变成 37 条 / 2 页，第 2 页有数据（91ms），不再是空页假加速。
4. **点评「认可最多」** **664 → 45**（-93%）。5 星 / 1 星 **443/503 → 36/40**。
5. `/latest` **16–25ms**，对大陆用户已经够快。`no-store` 没变，也不需要为海外墙钟改它。
6. `/api/admin/session` **`app=0`**。探针 ~270ms 是海外 RTT，不排进用户体验问题。

普通搜索（线性代数、孙爱琳、「微」）**97–135ms**，和 #720 同一量级。
关系列表带投票 Cookie 仍 BYPASS：大陆用户热路径 ≈ 这次的 Worker 耗时 + 国内 RTT，吃不到边缘 10ms HIT。

## 建议

1. 关系列表若也不序列化游客投票态，可像普通课程列表一样忽略 `jufexk_voter`。大陆用户 pill / 搜索热路径可以从「回源一次」变成边缘 HIT。
2. `/latest` 维持 `no-store` 即可。不要按本探针海外墙钟判断课评流慢。
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
