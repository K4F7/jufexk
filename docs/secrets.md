# 密钥托管

Worker 运行时密钥以 Cloudflare Secrets Store 为权威来源。决策见 [ADR-0015](./adr/0015-cloudflare-secrets-store.md)。绑定在 `wrangler.jsonc` 的 `secrets_store_secrets`，读取时调用 `get()`。

当前 store：`default_secrets_store`（`323163a091874b07aacdf5500bff903e`）。

## 必要密钥

| Key | 位置 | 去向 | 说明 |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | Secrets Store | Worker 绑定 | 运维脚本仍可读环境变量 `ADMIN_PASSWORD` 或 `JUFEXK_ADMIN_PASSWORD` |
| `IP_HASH_SECRET` | Secrets Store | Worker 绑定 | 必须与管理员口令、Turnstile Secret 不同 |
| `TURNSTILE_SECRET` | Secrets Store | Worker 绑定 | 与公开 `TURNSTILE_SITE_KEY` 成对 |
| `CAMPUS_JWT_SECRET` | Secrets Store | Worker 绑定 | 已废弃 AuthBridge 占位 HS256 密钥；callback 不能再打开 |
| `CAMPUS_JWT_AES_KEY` | Secrets Store | Worker 绑定 | 已废弃 AuthBridge 占位 AES-GCM 密钥 |
| `CAMPUS_IDENTITY_SECRET` | Secrets Store | Worker 绑定 | 学号/`sub`/校学生邮箱 HMAC 摘要密钥，明文永不落库 |
| `MAIL_DELIVERY_TOKEN` | Secrets Store | Worker 绑定 | Resend API 投递 token；只放密钥清单，不进仓库 |
| `CAS_CHALLENGE_SECRET` | Secrets Store | Worker 绑定 | CAS 代登 MFA 中间态 AES-GCM 密钥；未绑定时回退到 `CAMPUS_IDENTITY_SECRET` |
| `CLOUDFLARE_API_TOKEN` | GitHub Environment `production` | GHA `wrangler deploy` / D1 迁移 | 部署引导凭证，不能改放到 Secrets Store 再给 Actions 用。需含 Workers Scripts Edit、D1 Edit、Account Settings Read、**Secrets Store Write** |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Environment `production` | GHA | 目标账户 `fa1d0d91a980d4e2c22ac7272f038bf8` |

不要写入 Secrets Store：

- `SITE_NAME`、`UNIVERSITY_NAME`、`TURNSTILE_SITE_KEY`、`CAMPUS_JWT_AUD`、`CAMPUS_APP_ID`、`AUTHBRIDGE_BASE_URL`、`MAIL_DELIVERY_URL`、`MAIL_FROM`、历史导入哈希、D1 `database_id`：`wrangler.jsonc` 公开配置。`CAMPUS_JWT_ENABLED` 不得写入仓库，也不能再打开 AuthBridge callback。
- Vitest 夹具口令：仅测试
- `JUFEXK_BASE_URL`、`JUFEXK_BACKUP_PATH`、`JUFEXK_OPERATOR`：运维参数

## 本机

`.dev.vars` 仍是本机值的来源。写入 local Secrets Store：

```bash
pnpm run secrets:sync-local
```

`wrangler dev` 读 local store，不会使用生产 secret。

## 轮换

```bash
pnpm exec wrangler secrets-store secret list 323163a091874b07aacdf5500bff903e --remote
pnpm exec wrangler secrets-store secret update 323163a091874b07aacdf5500bff903e --secret-id <ID> --scopes workers --remote
```

更新 Secrets Store 后 Worker 绑定立即读到新值，不必重新 `wrangler secret put`。`IP_HASH_SECRET` 轮换后已落库的 IP HMAC 不再匹配。Turnstile 若在 Cloudflare 控制台轮换 widget secret，再把新值 `update` 进 Secrets Store。

生产部署会执行 `pnpm exec tsx scripts/secrets/ensure-remote.ts`：若远程 store 还没有 `CAS_CHALLENGE_SECRET` 就生成一个，已有则跳过。生成值不进日志或仓库。
