# 密钥托管

Worker 运行时密钥以 Cloudflare Secrets Store 为权威来源。决策见 [ADR-0015](./adr/0015-cloudflare-secrets-store.md)。绑定在 `wrangler.jsonc` 的 `secrets_store_secrets`，读取时调用 `get()`。

当前 store：`default_secrets_store`（`323163a091874b07aacdf5500bff903e`）。

## 必要密钥

| Key | 位置 | 去向 | 说明 |
| --- | --- | --- | --- |
| `IP_HASH_SECRET` | Secrets Store | Worker 绑定 | 必须与 Turnstile Secret 不同 |
| `TURNSTILE_SECRET` | Secrets Store | Worker 绑定 | 与公开 `TURNSTILE_SITE_KEY` 成对 |
| `CAMPUS_IDENTITY_SECRET` | Secrets Store | Worker 绑定 | 学号/`sub`/校学生邮箱 HMAC 摘要密钥，明文永不落库 |
| `CAS_CHALLENGE_SECRET` | Secrets Store | Worker 绑定 | CAS 代登 MFA 中间态 AES-GCM 密钥；未绑定时回退到 `CAMPUS_IDENTITY_SECRET` |
| `CLOUDFLARE_API_TOKEN` | GitHub Environment `production` | GHA deploy / migrate / bind-admin | 部署引导凭证，不能改放到 Secrets Store 再给 Actions 用。deploy 需 Workers Scripts Edit、Account Settings Read；migrate / bind-admin 需 D1 Edit、Account Settings Read |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Environment `production` | GHA | 目标账户 `fa1d0d91a980d4e2c22ac7272f038bf8` |
| `CAMPUS_IDENTITY_SECRET`（可选副本） | GitHub Environment `production` | GHA `Bind admin student IDs` | 必须与 Secrets Store 中的同名值一致。Secrets Store 不能回读，本机没有 `.dev.vars` 时用这条工作流写管理员学号 HMAC |
| `EHALL_COOKIE` | Louis `.env.jwxt-sync`（不入库） | Louis Docker collector | 浏览器 eHall `Cookie` 请求头；先从 eHall 跳转到 JWXT，仅在容器进程内存中保留会话；失效后人工轮换 |
| `CLOUDFLARE_API_TOKEN` | Louis `.env.jwxt-sync`（不入库） | Louis Docker publisher | 仅用于运行时发布同步结果；不得写入镜像、日志或仓库 |
| `CLOUDFLARE_ACCOUNT_ID` | Louis `.env.jwxt-sync`（不入库） | Louis Docker publisher | 目标 Cloudflare 账户标识；不得写入镜像、日志或仓库 |

Worker/GHA 的 JWXT 编排变量和凭据已移至归档分支；`main` 不再提供定时入口。Louis 任务必须由维护者显式启动，且只在当前 Cookie 已验证有效后运行。

不要写入 Secrets Store：

- `SITE_NAME`、`UNIVERSITY_NAME`、`PUBLIC_SURFACE`、`TURNSTILE_SITE_KEY`、历史导入哈希、D1 `database_id`：`wrangler.jsonc` 公开配置。
- 预览 Worker `jufexk-preview` 共用同一 Secrets Store；会话 Cookie 按 Host 隔离，不会写回生产 D1。
- 已淘汰、不要再绑定：`CAMPUS_JWT_AUD`、`CAMPUS_APP_ID`、`AUTHBRIDGE_BASE_URL`、`CAMPUS_JWT_SECRET`、`CAMPUS_JWT_AES_KEY`、`CAMPUS_JWT_ENABLED`、`MAIL_DELIVERY_URL`、`MAIL_FROM`、`MAIL_DELIVERY_TOKEN`、`REVIEW_AUTHOR_LOOKUP_TO`。远程 store 里若还留着旧密钥，可之后人工删除，不要重新绑到 Worker。#478 曾为点评作者查询把邮件变量绑回，#500 再次解绑以免 deploy 依赖不存在的 Secrets Store 条目。
- Vitest 夹具字符串（Secrets Store 绑定的测试替代值）：仅测试
- `JUFEXK_BASE_URL`、`JUFEXK_BACKUP_PATH`、`JUFEXK_OPERATOR`、`JUFEXK_ADMIN_COOKIE`、`JUFEXK_ADMIN_CSRF`：运维参数。管理员不再使用共享口令，先绑定学号再复制会话 Cookie。

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

生产部署不再自动补齐密钥。若远程 store 还没有 `CAS_CHALLENGE_SECRET`，在受控终端执行 `pnpm exec tsx scripts/secrets/ensure-remote.ts`：列表已能认出该名、或 create 返回 `secret_name_already_exists` / `[code: 1003]`，都视为已存在并成功退出。生成值不进日志或仓库。
