# 产品分析留在 Cloudflare；看数面是 `/admin/bi`

日常指标在站内 `/admin/bi`（已绑定学号的管理员）。不接 Plausible / PostHog / GA。权威规格：[GitHub issue #814](https://github.com/K4F7/jufexk/issues/814)。

## 口径

- **注册用户增长**：D1 `users.created_at`，`public_code >= 1`，按日计数。保留号 `#000000` 不计。
- **真实课评浏览**：Workers Analytics Engine `review_view`。课程×教师点评列表在浏览器里成功渲染后打一次。分页 `loadMore` 不再打。教师详情页没有点评流，不打。
- **停留**：同一页 `pagehide` / `visibilitychange=hidden` 打 `review_dwell`，毫秒夹在 1 秒到 30 分钟。
- **尝试登录**：Worker 记 `login_submit` / `login_success` / `login_fail`（CAS 口令、MFA、扫码、邮箱）。打开 `/login` 记 `login_view`。QR status 轮询不打 submit。本机 DEV 登录不打点。
- **游客 UV / path**：已有 Cloudflare Web Analytics，仅作对照。Exclude Bots。Zone HTTP Unique Visitors 含爬虫，不当口径。

学号、邮箱、`auth_identities.subject`、口令、`users.id`、IP hash 不进分析点。actor 只分 `guest` / `user`。没有人级漏斗。

## 存储

写入 Analytics Engine dataset `jufexk_events`（预览 `jufexk_events_preview`），binding `BI`。`writeDataPoint` 不 await。查询用 SQL API，计数 `SUM(_sample_interval)`，必须带时间窗。保留约 90 天。不把点击流 upsert 进 D1。

## 看数

`GET /api/admin/bi` 聚合 D1 注册曲线与固定 AE SQL。Worker 使用 dashboard secret `BI_ANALYTICS_READ_TOKEN`（Account Analytics Read）和 var `CLOUDFLARE_ACCOUNT_ID`。未配置 token 时注册曲线仍返回。

可选对照：[Web Analytics](https://dash.cloudflare.com/?to=/:account/web-analytics) → `courses.sein.moe`。不要用 Workers Observability Query Builder。
