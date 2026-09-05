# CI 规范

本文档是 PR / merge queue CI 拓扑、准入与扩展规则的唯一权威来源。部署、D1 迁移和生产运维 workflow 不属于本规范的主验证矩阵。

生产部署与 D1 迁移分别使用 `production-deploy` 与 `production-migrate` concurrency group，各自排队，互不挤占。GitHub 每个 group 只保留一个 running 和一个 pending，后到的 pending 会顶掉同组未开始的任务；分开排队是为了避免后续 deploy 把排队中的 migrate 挤出队列，不再用同一 concurrency group 做互斥。同一 push 仍可能让两条 workflow 并行，因此 schema 变更应采用 expand/contract，使迁移与部署可独立推进。两者均保留正在执行的任务（`cancel-in-progress: false`），不以新任务取消旧任务。该设置不保证迁移先于部署；需要严格顺序时必须另行编排。

## Required gate 与当前拓扑

`CI / check` 是仓库唯一的 required gate。所有主验证子 job 必须列入它的 `needs` 并接受严格聚合：需要验证的变更只接受全部成功，文档类路径跳过时只接受全部跳过；取消、失败或意外缺失都不能被当成成功。

当前主验证矩阵共 5 个 runner：

- 1 个 `web_static`：Wrangler types、TypeScript、Node / catalog / secrets Vitest、Vite build 和 Wrangler dry-run。
- 2 个 `vitest_workers`：以两个分片运行全部 Workers Vitest，并保留 `--no-file-parallelism`。
- 2 个 `browser`：每个分片依次运行同一分片编号的完整桌面 Chromium 测试，以及带 `@mobile-smoke` 的移动 Chromium 专项。

桌面 Chromium 承担完整浏览器功能覆盖；移动 CI 只承担响应式布局与移动交互 smoke。本地 `pnpm check` 继续运行完整 Workers、静态检查、完整桌面和完整移动端浏览器测试。

主验证 job 复用 `.github/actions/setup-pnpm`：设置 Node 22，安装固定版本 Corepack，直接按 `package.json` 的 `packageManager` 安装 pnpm，再缓存 pnpm store。Corepack 安装关闭 npm audit/fund，不经过 pnpm/action-setup 的 self-installer 与版本切换。不同 runner 仍须分别 checkout 和 `pnpm install --frozen-lockfile`；不跨 runner 打包、传输 `node_modules`。

Browser job 使用 Playwright 官方 Noble 容器，镜像版本必须与 `pnpm-lock.yaml` 中实际解析的 `@playwright/test` 一致；升级 Playwright 时同步更新镜像。镜像预装浏览器与系统依赖，job 不再运行 `playwright install`。项目 npm 依赖仍须安装，Chromium 使用 `--ipc=host`。

PR 与 `merge_group` 目前保持相同测试覆盖。2026-09-05 核查 main 规则未启用 merge queue，因此不能仅凭 workflow 声明了 `merge_group` 就把 PR 全量测试降为 smoke；必须先确保每次合并都会经过完整检查。路径分类维持保守兜底：前后端共享类型、API 载荷和构建依赖未形成可靠影响映射前，不按目录猜测可以跳过浏览器。

现有文档类路径跳过规则保持不变。目录或工具专用检查必须按相关路径触发，不能默认加入所有 PR。Workflow YAML 与表达式复用 `web_static` runner 内的 actionlint 校验，不新增 runner。

Better Uptime（Better Stack）监控属于仓库外部配置。Issue #876 记录了 7 个 keyword monitor（5 秒超时、30 秒频率）；token 不入库，CI 不复制外部探针。收到告警时先在 Better Uptime 控制台核对监控 URL、状态码、超时与响应体；公开状态页异常不等同于应用请求错误。

## 新检查的准入规则

新增检查必须先证明存在当前检查无法捕获的具体失败面。优先把覆盖复用到现有 runner；不能只以“未来可能需要”为由增加矩阵。

新增 runner、分片、操作系统、Node 版本或浏览器矩阵时，对应 issue 必须记录：

- 已发生或可复现的失败证据，以及现有检查为何捕获不到；
- 预计增加的 runner-minutes；
- 对合并关键路径 wall-clock 的影响；
- 已评估的替代方案，以及不能复用现有 runner 的原因。

5 个主验证 runner 与成功 CI 中位约 3.5 分钟是持续优化建议和评审基线，不是不可突破的硬上限。有充分证据的扩展可以突破基线，但必须在 issue 和 PR 中说明成本与收益。

## 变更与契约测试

任何 CI 拓扑变更都必须同时：

- 更新本文档；
- 更新 workflow 契约测试；
- 在 PR 中说明变更前后的 wall-clock 与 runner-minutes，标明实测或估算口径。

契约测试只锁定拓扑、安全边界和 required gate 聚合语义。不要锁定 action 版本、步骤顺序、测试数量或偶然耗时；这些实现细节应允许独立演进。
