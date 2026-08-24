# Worker 密钥改由 Cloudflare Secrets Store 托管

运行时密钥以账户级 Cloudflare Secrets Store 为权威来源，通过 `secrets_store_secrets` 绑定到 Worker，读取时调用 `get()`。GitHub Actions 只保留部署引导用的 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`；这两项必须留在 GitHub，因为 Actions 要先用它们访问 Cloudflare，不能改从 Secrets Store 拉取。

`IP_HASH_SECRET`、`TURNSTILE_SECRET` 不再使用 per-Worker `wrangler secret put`，也不再经 Infisical 同步。本机 `wrangler dev` 使用同一 store id 的 local Secrets Store；`.dev.vars` 只作本地写入源，不参与生产。测试夹具仍可注入字符串，由读取辅助函数兼容。共享 `ADMIN_PASSWORD` 已退役，管理员改为学号绑定（#480）。

本决策取代 [ADR-0014](./0014-infisical-secret-source.md)。

## Considered Options

- **继续 Infisical + Worker Secret 同步**：多一个控制面会，本站只用 GHA 与 Worker，否决。
- **把 `CLOUDFLARE_API_TOKEN` 也放进 Secrets Store**：Actions 无法在无 Cloudflare 凭证时读取它，否决。
- **继续 per-Worker `wrangler secret put`**：不能在账户内复用，轮换要逐个 Worker，否决。
