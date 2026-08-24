# CI 规范

本文档是 PR / merge queue CI 拓扑、准入与扩展规则的唯一权威来源。部署、D1 迁移和生产运维 workflow 不属于本规范的主验证矩阵。

## Required gate 与当前拓扑

`CI / check` 是仓库唯一的 required gate。所有主验证子 job 必须列入它的 `needs` 并接受严格聚合：需要验证的变更只接受全部成功，文档类路径跳过时只接受全部跳过；取消、失败或意外缺失都不能被当成成功。

当前主验证矩阵共 5 个 runner：

- 1 个 `web_static`：Wrangler types、TypeScript、Node / catalog / secrets Vitest、Vite build 和 Wrangler dry-run。
- 2 个 `vitest_workers`：以两个分片运行全部 Workers Vitest，并保留 `--no-file-parallelism`。
- 2 个 `browser`：每个分片依次运行同一分片编号的完整桌面 Chromium 测试，以及带 `@mobile-smoke` 的移动 Chromium 专项。

桌面 Chromium 承担完整浏览器功能覆盖；移动 CI 只承担响应式布局与移动交互 smoke。本地 `pnpm check` 继续运行完整 Workers、静态检查、完整桌面和完整移动端浏览器测试。

现有文档类路径跳过规则保持不变。目录或工具专用检查必须按相关路径触发，不能默认加入所有 PR。

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
