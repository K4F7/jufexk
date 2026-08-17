# 密钥托管

Infisical 是站点密钥的权威来源。决策见 [ADR-0014](./adr/0014-infisical-secret-source.md)。Worker 运行时只读 wrangler 绑定，不调用 Infisical。仓库通过 `.infisical.json` 连接到组织 `sern` 的项目 `xk`（`xk-epjy`）。

## 必要密钥

| Key | Infisical | 去向 | 状态 |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | `dev`/`prod` `/worker` | Worker Secret；运维脚本也读此名或 `JUFEXK_ADMIN_PASSWORD` | `dev` 已写入；`prod` 待 Cloudflare 轮换后再写入 |
| `IP_HASH_SECRET` | `dev`/`prod` `/worker` | Worker Secret | 生产已在 Cloudflare，待导入 Infisical |
| `TURNSTILE_SECRET` | `dev`/`prod` `/worker` | Worker Secret | 生产已在 Cloudflare，待导入 Infisical |
| `CLOUDFLARE_API_TOKEN` | `prod` `/ci` | GitHub Environment `production` | 已在 GitHub，待导入 Infisical |
| `CLOUDFLARE_ACCOUNT_ID` | `prod` `/ci` | GitHub Environment `production` | 已写入 Infisical `prod /ci` |

不要写入 Infisical：

- `SITE_NAME`、`UNIVERSITY_NAME`、`TURNSTILE_SITE_KEY`、历史导入哈希、D1 `database_id`：仓库/`wrangler.jsonc` 公开配置
- Vitest 中的 `test-password` / `test-ip-hash-secret`：仅测试夹具
- `JUFEXK_BASE_URL`、`JUFEXK_BACKUP_PATH`、`JUFEXK_OPERATOR`：运维参数，不是密钥

## 本机

安装 Infisical CLI 后执行 `infisical login`。`.infisical.json` 已指定项目，无需再设 `INFISICAL_PROJECT_ID`：

```bash
pnpm run secrets:pull
```

该命令从 `dev /worker` 写入不提交的 `.dev.vars`，不会写入 CI token。`ADMIN_PASSWORD` 尚未进入 Infisical 时会保留本机已有口令并提示待轮换。

## 同步

在 Infisical 控制台配置 Secret Sync，不要改 CI 去写 Worker Secret：

1. `prod /worker` → Cloudflare Workers 脚本 `jufexk`（`ADMIN_PASSWORD`、`IP_HASH_SECRET`、`TURNSTILE_SECRET`）
2. `prod /ci` → GitHub 仓库 Environment `production`（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）

首次同步应关闭目标端删除，避免清掉尚未纳入 Infisical 的密钥。`ADMIN_PASSWORD` 写入 Infisical 之前，不要对 Worker 开启覆盖同步。

## 轮换 ADMIN_PASSWORD

1. 在 Cloudflare 为 Worker `jufexk` 写入新的 `ADMIN_PASSWORD`
2. 确认后台登录可用
3. 把同一新值写入 Infisical `prod /worker` 与 `dev /worker`（若本机也改用新口令）
4. 此后只改 Infisical，由 Secret Sync 推送到 Cloudflare
