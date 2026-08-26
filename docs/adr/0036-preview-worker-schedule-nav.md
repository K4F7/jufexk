# 排课模拟只挂预览站导航，生产站不展示

_2026-08-26：生产自定义域不挂排课入口；Cloudflare `preview` 环境单独部署 `jufexk-preview`。与 [ADR-0030](./0030-schedule-desktop-only.md) 不冲突：预览站上的 `/schedule` 仍只做电脑端。_

生产站 `courses.sein.moe`（Worker `jufexk`）主导航是课程 / 课评 / 导师。排课模拟仍保留 `/schedule`，知道地址的人可以直达，但不从生产导航进入。

预览站是 Wrangler named env `preview`：Worker `jufexk-preview`，只走 `workers.dev`，独立 D1 `jufexk-preview`。导航展示「排课模拟」。会话 Cookie 按 Host 隔离。预览写入不回生产库。

`GET /api/config` 下发 `showScheduleNav`：`PUBLIC_SURFACE=preview` 或 loopback 为真。本机 Vite DEV 另外用 `import.meta.env.DEV` 显示入口。

## Consequences

- 不要把生产 D1 或生产 AI 摘要队列绑到 preview。
- 预览要「看起来同一份数据」时，运维在本机 `pnpm db:clone-preview`（先清空预览对象再导入完整 dump，保留同一 `database_id`，不必先 apply migrations）；CI 不导出含学生投稿的库。
- Turnstile widget 需允许预览主机名，否则预览站人机验证会失败。

## Considered Options

- **独立 preview Worker + 独立 D1（采纳）**：可打开的预览站，写入不回流生产。
- **只靠 Vite DEV**：线上构建没有 DEV 开关，打不开预览站。
- **共用生产 D1**：预览写评价会进生产库，否决。
