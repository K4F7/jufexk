# Infisical 是站点密钥的权威来源

站点密钥以 Infisical 为唯一权威来源，再同步到 Cloudflare Worker Secrets、GitHub Actions Environment 和本机 `.dev.vars`。Worker 运行时继续只读 wrangler 绑定，不调用 Infisical SDK，避免把 Infisical 凭证变成新的运行时密钥，也不把密钥拉取放进请求路径。

`ADMIN_PASSWORD`、`IP_HASH_SECRET`、`TURNSTILE_SECRET` 属于 `/worker`；`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 属于 `/ci`。`dev` 只服务本机 wrangler，`prod` 服务生产 Worker 与 CI。公开站点名、学校名、Turnstile Site Key、历史导入哈希和 D1 `database_id` 留在 `wrangler.jsonc`，测试夹具口令只存在于 Vitest bindings。

日常写入与轮换在 Infisical 完成；Cloudflare 与 GitHub 只接收同步结果。`ADMIN_PASSWORD` 须先在 Cloudflare 轮换，再把新值写入 Infisical，禁止把轮换前的生产口令导入仓库侧流程。

## Considered Options

- **Worker 运行时调用 Infisical SDK**：仍需托管 Infisical 凭证，并增加请求延迟与可用性依赖，否决。
- **继续以 `wrangler secret put` 和 GitHub UI 为来源**：密钥分散、无法审计轮换，否决。
- **CI 在部署时从 Infisical 拉取并写入 Worker**：会让 CI 重新获得改写生产口令的能力，与现有「Worker Secret 不由 CI 写入」冲突，否决。
