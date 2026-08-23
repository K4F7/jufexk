# 选课志（jufexk）

<p align="center">
  <img src="public/icon-512.png" width="128" height="128" alt="非官方课评@JUFE">
</p>

[![Deploy](https://github.com/K4F7/jufexk/actions/workflows/deploy.yml/badge.svg)](https://github.com/K4F7/jufexk/actions/workflows/deploy.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)](https://workers.cloudflare.com/)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

江西财经大学课程—教师评价站（站内名称「非官方课评@JUFE」）。评价必须绑定课程的具体任课教师，公开内容均经管理员人工审核后匿名展示。

线上站点：[xk.sein.moe](https://xk.sein.moe)

## 功能特性

- 📚 **权威课程目录**：课程、教师、任课关系由审核通过的原子目录基线包统一发布，来源身份可追溯
- ⭐ **任课评价**：学生按版本化评价规则（问卷）对「课程 × 任课教师」打分，并填写必填补充说明
- 👍 **认可信号**：登录用户可对评价给出一次可撤回的认可，不影响评分与排序
- 📝 **目录补充申请**：找不到课程或教师时可提交申请，管理员审核通过后才创建目录对象
- 🕰️ **历史评价导入**：腾讯表格截图经 OCR、对抗分析、人工审核后作为匿名文字资料进入统一公开流
- 🛡️ **反滥用**：Turnstile 人机验证、蜜罐、同源校验、IP HMAC 假名化限流与 30 天重复投稿控制
- 🔐 **校内邮箱身份**：普通用户经校内邮箱身份认证登录，身份不公开，仅承载评价与认可的唯一性
- 🎨 **现代 UI**：HeroUI v3 + Tailwind CSS v4，支持暗色/亮色主题

## 技术栈

| 层次 | 技术 |
| ---- | ---- |
| 前端 | React 19 · React Router 7 · HeroUI v3 · Tailwind CSS v4 · Vite |
| 后端 | Hono · Cloudflare Workers（静态资源 + `/api/*`） |
| 数据库 | Cloudflare D1（SQLite），迁移见 `migrations/` |
| 密钥 | Cloudflare Secrets Store（清单见 `docs/secrets.md`） |
| 测试 | Vitest（多套配置）· Playwright 浏览器测试 · Python unittest（OCR 契约） |
| 部署 | Wrangler · GitHub Actions（`production` Environment） |

## 快速开始

### 前置要求

- Node.js ≥ 22.13
- pnpm ≥ 11.20
- Python 3.12 + [uv](https://docs.astral.sh/uv/)（仅历史评价 OCR 流水线需要）

### 本地开发

```bash
pnpm install --frozen-lockfile
pnpm exec wrangler d1 migrations apply jufexk --local
pnpm run dev
```

管理员本地口令放在不提交的 `.dev.vars`，再用 `pnpm run secrets:sync-local` 写入本地 Secrets Store。站点与学校名称在 `wrangler.jsonc` 的 `SITE_NAME`、`UNIVERSITY_NAME` 中配置，复用到其他高校时无需修改源码。

### 常用命令

| 命令 | 说明 |
| ---- | ---- |
| `pnpm run dev` | 启动 Wrangler 本地开发服务器 |
| `pnpm run prototype` | 启动 Vite 原型环境 |
| `pnpm test` | 运行全部 Vitest 套件 |
| `pnpm run test:browser` | Playwright 浏览器测试 |
| `pnpm run check` | 类型生成 + tsc + 全部测试 + 构建 + 部署 dry-run |
| `pnpm run build` / `pnpm run deploy` | 构建 / 构建并部署到 Cloudflare |
| `pnpm run db:local` | 应用本地 D1 迁移 |
| `pnpm run catalog-baseline` | 目录基线采集 CLI |

## 配置

### 普通变量（`wrangler.jsonc` 的 `vars`）

| 变量 | 说明 |
| ---- | ---- |
| `SITE_NAME` / `UNIVERSITY_NAME` | 站点与学校显示名 |
| `TURNSTILE_SITE_KEY` | Turnstile 公开 Site Key |
| `CAMPUS_JWT_AUD` / `CAMPUS_APP_ID` / `AUTHBRIDGE_BASE_URL` | 校内身份认证参数 |
| `MAIL_DELIVERY_URL` / `MAIL_FROM` | 验证信 HTTPS 投递端点与发件人（Resend） |
| `V5_IMPORT_*` / `ISSUE111_RELATION_MANIFEST_SHA256` | 唯一生产历史评价导入包与任课追加包的内容哈希 |

### 密钥（Cloudflare Secrets Store）

`ADMIN_PASSWORD`、`IP_HASH_SECRET`、`TURNSTILE_SECRET`、`CAMPUS_JWT_SECRET`、`CAMPUS_JWT_AES_KEY`、`CAMPUS_IDENTITY_SECRET`、`MAIL_DELIVERY_TOKEN`、`CAS_CHALLENGE_SECRET`。不要把口令、API Token 或 `.dev.vars` 提交到仓库；`IP_HASH_SECRET` 必须使用与管理员口令、Turnstile Secret 不同的随机值。

### Turnstile

投稿端已接入标准 Turnstile widget 与服务端 Siteverify。创建 Widget（域名包含 `xk.sein.moe`、`localhost`、`127.0.0.1`）后：

1. 将公开 Site Key 配置为 `TURNSTILE_SITE_KEY` 普通变量；
2. 将对应 Secret 写入 Secrets Store 的 `TURNSTILE_SECRET`；
3. 重新部署。

Site Key 与 Secret 同时存在时服务端才启用并强制验证。仅有 Site Key 时隐藏无效 widget，并退化到蜜罐 + 同源校验 + 限流；仅有 Secret 时视为配置错误并拒绝公开写入；两者均未配置时也要求同源提交。

## 生产部署

仓库已包含真实 D1 `database_id` 和 `xk.sein.moe` Custom Domain 配置。首次部署或应用迁移：

```bash
pnpm exec wrangler d1 migrations apply jufexk --remote
pnpm run deploy
```

### GitHub Actions

`.github/workflows/deploy.yml` 在 `main` 推送且变更进入站点/Worker 时构建并部署 Worker；类型检查、测试和 Playwright 只在 PR / merge queue 的 `ci.yml` 里跑。D1 迁移由 `.github/workflows/migrate.yml` 单独处理：可手动触发，或在 `main` 上变更 `migrations/**` 时自动执行。工作流绑定 `production` Environment，建议配置必需审核人。该 Environment 只需：

- `CLOUDFLARE_API_TOKEN`：Workers Scripts Edit（deploy）、D1 Edit（migrate）、Account Settings Read
- `CLOUDFLARE_ACCOUNT_ID`：目标 Cloudflare Account ID

CI 不导出含学生投稿的 D1 数据，避免敏感备份进入 GitHub Artifact。重大迁移前应由运维人员在受控终端执行 `pnpm exec wrangler d1 export`，并将备份保存到受限存储。

## 目录基线与历史评价

课程、教师与任课关系由审核通过的原子目录基线包统一发布。基线发布后，旧式 CSV 合并/跳过入口永久返回 `409`；新增目录实体必须走目录补充申请及管理员审核。当前 JUFE 权威包为 `scripts/catalog-baseline/captures/full-approved-v2/manifest.json` 对应的 v2 基线。采集、派生、审核与发布流程见 `docs/catalog-baseline-acquisition.md`。

当前唯一保留的历史评价生产导入包是 `frozen-historical-v5-candidate-v10`，由 `pnpm run historical-import:v5` 写入 `/api/admin/historical-review-v5-imports`。更早的 v2 / issue111 / v5-candidate-v1..v9 与 OCR 抽取流水线已退役，不得重放。操作说明见 `docs/historical-production-import.md` 与 [ADR-0024](./docs/adr/0024-retire-ocr-and-old-import-packages.md)。

### 投稿问卷（已定方向）

公开投稿采用**分段分页**问卷，进度条按段推进，移动端固定"上一页/下一页"，不复制参考问卷文案和品牌。四段：

1. 评价对象：表单式精准查找课程 → 开课班（选填）→ 任课教师；找不到对象时可提交"目录补充申请"（见 ADR-0002），页面底部亦有常驻入口；
2. 总体推荐度 + 分类维度（星级/点选）；
3. 课堂与考核细项 + 文字评价（全部选填）；
4. 匿名确认 + 提交。

人机验证在进入「写评价」时启动，并常驻分段进度条下方；「补充课程或教师」使用独立的验证实例。

必填仅三项：课程、任课教师、总体推荐度；学期与全部维度均为选填。

## 项目结构

```
├── src/                    # Worker 入口（Hono）与 React 前端
│   ├── pages/              # 课程、教师、详情、登录、账号等页面
│   ├── components/         # AppShell、结果表格、评分单元格等组件
│   ├── lib/                # 认证、Turnstile、评价字段、标签等共享逻辑
│   ├── hooks/              # 公开评价分页等 React hooks
│   └── prototype/          # UI 原型变体（HeroUI v3）
├── migrations/             # D1 数据库迁移
├── scripts/
│   ├── catalog-baseline/   # 目录基线采集、派生、审核与发布
│   ├── historical-import/  # 唯一生产历史评价导入包（v10）
│   └── secrets/            # 本地密钥同步
├── test/                   # Vitest 单元/集成测试与 Playwright 浏览器测试
├── docs/
│   ├── adr/                # 架构决策记录
│   ├── agents/             # Agent 工作流约定
│   └── secrets.md          # 密钥清单
├── prototypes/             # 独立 Vite 原型
└── CONTEXT.md              # 领域词汇表（统一语言）
```

## 文档地图

- `CONTEXT.md`：领域词汇表——课程、任课关系、评价、认可、目录基线等核心概念的唯一权威定义
- `docs/adr/`：架构决策记录（目录身份、审核分层、密钥来源、校内邮箱身份等）
- `docs/catalog-baseline-acquisition.md`：目录基线采集与发布全流程
- `docs/historical-production-import.md`：唯一保留的 v10 历史评价生产导入包
- `docs/secrets.md`：密钥清单与轮换说明
- `docs/agents/`：Issue 跟踪、triage 标签等协作约定

## 贡献指南

Issue 与 PRD 以 GitHub Issues 形式存放在 `K4F7/jufexk`，统一走 `gh` CLI。修复或实现任何 issue 必须走完整 PR 流程（不得直接在主工作区或 `main` 分支上修改）：

1. `gh issue view <number> --comments` 读取最新需求；
2. 同步本地 `main` 到最新 `origin/main`；
3. 创建 `codex/<issue-number>-<slug>` 分支与 `.worktree/` 下的独立 worktree；
4. 在 worktree 中 `pnpm install --frozen-lockfile` 后实现修改；
5. 运行与改动范围匹配的检查、测试与本地 code review；
6. 提交、推送并用 `gh pr create` 创建目标为 `main` 的 PR；
7. `gh pr merge --auto --merge` 排队自动合并，必需 CI 通过后合入；
8. 确认合入后清理 worktree 与本地分支。

详细约定见 `AGENTS.md` 与 `docs/agents/`。

## 复用到其他高校

当前 `wrangler.jsonc` 指向 JUFE 的生产 Worker、D1、域名和 Turnstile Widget，不能原样用于其他学校。复用时至少需要：

1. 用 `pnpm exec wrangler d1 create <数据库名>` 创建独立 D1，并替换 `database_name` 与 `database_id`；
2. 修改 Worker `name`、`routes`、`SITE_NAME` 和 `UNIVERSITY_NAME`；
3. 为新域名创建独立 Turnstile Widget，替换 Site Key，并写入对应 Secret；
4. 应用全部迁移，再为本校采集、审核并发布独立的原子目录基线包；
5. 删除初始迁移产生的两门示例课程和示例教师后再开放投稿。

不同学校不得共用 D1、管理员口令或 Turnstile Secret。

## 许可证

本项目采用 [MIT License](./LICENSE)。
