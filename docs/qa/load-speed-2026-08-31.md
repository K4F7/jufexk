# 公开面加载速度 — 2026-08-31 复测

对照：

- 三轮总结：[`load-speed-2026-08-30-summary.md`](./load-speed-2026-08-30-summary.md)
- 第二轮（#734，`remote-SIN`）：[`load-speed-2026-08-30-after-round2.md`](./load-speed-2026-08-30-after-round2.md)

未登录实测 **https://courses.sein.moe**。
同一套 `pnpm run timing:prod-public`。目录仍是 **11167** / **559**。体育 **37** / **2**。通识 **8564** / **429**。

**用户都在大陆。** 只认 Worker `app` / `query`。本探针墙钟含海外 RTT，不当作用户指标。

跑次：`2026-08-31T11:30:55Z`。**不改生产站 UI。**

## 相对 #734 生产上多了什么

主干在 #734 之后主要是课评流 / 首屏：`/latest` 对 `jufexk_voter` + `jufexk_user_csrf` 可进共享缓存、推迟 viewer session、复用 bootstrap、拆 JS/CSS。
关系列表仍用严格缓存判断，**带 `jufexk_voter` 继续 BYPASS**。

## 方法与 placement

每条 API 冷 1 次 + 热 2 次。这次**没有**先打探针，冷路径都是真 MISS。

`wrangler.jsonc` 开了 `placement.mode = smart`。

| 跑次 | 冷路径 `cf-placement` |
| --- | --- |
| #734 复测 | 常见 `remote-SIN` |
| 本次 | 全程 `local-EWR` / `local-ORD` / `local-MIA` |

Worker 跑在美东、D1 不在旁边时，`app` 会含多次跨洋 SQL。这不是大陆用户会付的价。
#734 的 `remote-SIN` `app` 更接近大陆用户的源站。本次数字用来看缓存是否还在，**不能用来判断 #734 的 SQL 被回退**。

点评 `sort=rating_desc` 仍是 400。Playwright 点评筛选仍对不上现网 UI。

## 对比（Worker `app`，毫秒）

| 场景 | #734 `app`（SIN） | 本次 `app`（美东本地） | 本次冷缓存 | 热 |
| --- | ---: | ---: | --- | ---: |
| 目录首页 | 244 | 1571 | MISS | 10 HIT |
| 搜索 线性代数 | 121 | 1370 | MISS | 11 HIT |
| 搜索 孙爱琳 | 97 | 1215 | MISS | 11 HIT |
| 搜索课号 | 105 | 1185 | MISS | 10 HIT |
| 搜索「微」 | 135 | 1402 | MISS | 10 HIT |
| 搜索未命中 | 48 | 698 | MISS | 10 HIT |
| 通识 | 163 | 1007 | MISS | 10 HIT |
| 数学 / 思政 / 英语 | 51–79 | 913–946 | MISS | 11 HIT |
| 体育 | 104 | 1120 | MISS | 9 HIT |
| 全部第 2 页 | 137 | 1198 | MISS | 9 HIT |
| 通识 / 体育第 2 页 | 111 / 91 | 1096 / 1101 | MISS | 11 HIT |
| 最新课评 | 22（当时 BYPASS） | 223 | **现已 MISS→HIT** | **12 HIT** |
| 课评继续加载 | 21（BYPASS） | 222 | **MISS→HIT** | **10 HIT** |
| 课程详情 | 61 | 1124 | MISS | 11 HIT |
| 点评认可最多 | 45 | 722 | MISS | 11 HIT |
| 点评最新 / 最早 | 57 / 41 | 801 / 673 | MISS | 12 HIT |
| 点评 5 星 / 1 星 | 36 / 40 | 517 / 538 | MISS | 10 HIT |
| `/api/config` | 9 | 8 | MISS | 9 HIT |
| `/api/admin/session` | 0 | 0 | 401 BYPASS | 0 |

跑完再用同一出口复打：首页仍 `local-EWR` MISS，`app` 1406。不是「第一次冷启动」，是这个 placement 下源站就贵。

## 浏览器（只看缓存，不看可见毫秒）

关系列表带 `jufexk_voter` 仍 **BYPASS**，和 #734 一样。
课评主导航热路径已是 **HIT ~16ms**（#734 还是 BYPASS ~300ms 墙钟）。这是这轮唯一能在本探针上直接看见的产品变化。

点评筛选整段失败，选择器对不上现网。

## 结论

1. **边缘缓存还在。** 无 Cookie 的 HTTP 热路径仍是 **9–13ms HIT**。
2. **`/latest` 现在可缓存。** 冷 MISS 之后热 HIT。这是 #734 之后真正落地的公开面变化。
3. **本次 `app` 1.0–1.6s 不能当成优化回退。** 代码里课号快路径、stale 预计算、点评投影都在。数字差来自 Worker 跑在美东本地，不像 #734 的 `remote-SIN`。大陆用户应继续以 #734 的 50–160ms 为源站参照。
4. **关系列表仍 BYPASS `jufexk_voter`。** 游客点过点评后，pill / 搜索每次回源。这仍是唯一值得做的产品优化。
5. `/api/config` **8ms**、admin session **0ms**，没有新问题。

## 建议

1. 关系列表忽略游客 `jufexk_voter`（匿名 payload 没有 `viewer_*`）。
2. 以后从本探针复测：表里同时写 `cf-placement`；和 #734 比源站时只比 `remote-SIN`（或大陆出口）的 `app`。
3. 计时脚本的点评排序 / 星级选择器跟上现网。不影响本次结论。
