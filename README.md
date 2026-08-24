# 江财非官方课评

<p align="center">
  <img src="public/icon-512.png" width="128" height="128" alt="非官方课评@JUFE">
</p>

<p align="center">
  <strong>江西财经大学课程—教师评价站</strong><br>
  站内名称「非官方课评@JUFE」
</p>

<p align="center">
  <a href="https://courses.sein.moe">线上站点</a> ·
  <a href="./CONTEXT.md">领域词汇</a> ·
  <a href="./docs/adr/">架构决策</a>
</p>

[![CI](https://github.com/K4F7/jufexk/actions/workflows/ci.yml/badge.svg)](https://github.com/K4F7/jufexk/actions/workflows/ci.yml)
[![Deploy](https://github.com/K4F7/jufexk/actions/workflows/deploy.yml/badge.svg)](https://github.com/K4F7/jufexk/actions/workflows/deploy.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)](https://workers.cloudflare.com/)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

评价必须绑定课程的具体任课教师。公开内容经管理员人工审核后匿名展示；学号、邮箱与站内用户标识均不公开。

本站不是学校官方服务，目录来自获授权采集的教务可见开课全量，评价来自学生投稿与已审核的历史文字资料。

## 功能特性

- 📚 **权威课程目录**：课程、教师、任课关系由审核通过的原子目录基线包统一发布，来源身份可追溯
- ⭐ **任课评价**：按版本化评价规则对「课程 × 任课教师」打分；当前全站同一套四道三档题（课程难度、作业多少、给分好坏、收获多少），外加 1–5 本次推荐度与必填补充说明
- 👍 **认可信号**：登录用户可对评价给出一次可撤回的认可，不影响评分与排序
- 📝 **目录补充申请**：找不到课程或教师时可提交申请，管理员审核通过后才创建目录对象
- 🕰️ **历史评价**：已审核的历史文字作为匿名资料进入统一公开流，不参与评分统计
- 🧠 **任课关系 AI 总结**：根据已公开点评异步生成参考摘要，不参与评分或排序
- 🛡️ **反滥用**：Turnstile 人机验证、蜜罐、同源校验、IP HMAC 假名化限流与重复投稿控制
- 🔐 **校园身份**：普通用户主登录走江财 CAS 代登，校学生邮箱验证为次要入口；身份不公开，只承载评价与认可的唯一性
- 🎨 **现代 UI**：HeroUI v3 + Tailwind CSS v4，支持暗色 / 亮色主题

## 技术栈

| 层次 | 技术 |
| ---- | ---- |
| 前端 | React 19 · React Router 7 · HeroUI v3 · Tailwind CSS v4 · Vite |
| 后端 | Hono · Cloudflare Workers（静态资源 + `/api/*`） |
| 数据库 | Cloudflare D1（SQLite），迁移见 `migrations/` |
| 密钥 | Cloudflare Secrets Store（清单见 `docs/secrets.md`） |
| 测试 | Vitest（多套配置）· Playwright 浏览器测试 |
| 部署 | Wrangler · GitHub Actions（`production` Environment） |

## 快速开始

### 前置要求

- Node.js ≥ 22.13
- pnpm ≥ 11.20

### 本地开发

```bash
pnpm install --frozen-lockfile
pnpm exec wrangler d1 migrations apply jufexk --local
pnpm run dev
```

本机密钥放在不提交的 `.dev.vars`，再用 `pnpm run secrets:sync-local` 写入本地 Secrets Store。首位管理员用 `pnpm exec tsx scripts/admin/bind-student-ids.ts` 写入学号 HMAC。站点与学校名称在 `wrangler.jsonc` 的 `SITE_NAME`、`UNIVERSITY_NAME` 中配置。

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

AuthBridge 校园 JWT（`CAMPUS_JWT_*` / `CAMPUS_APP_ID` / `AUTHBRIDGE_BASE_URL`）与校学生邮箱投递（`MAIL_*`）已从 Worker 配置淘汰，不能再作为登录路径。

### 密钥（Cloudflare Secrets Store）

`IP_HASH_SECRET`、`TURNSTILE_SECRET`、`CAMPUS_IDENTITY_SECRET`、`CAS_CHALLENGE_SECRET`。不要把口令、API Token 或 `.dev.vars` 提交到仓库；`IP_HASH_SECRET` 必须使用与 Turnstile Secret 不同的随机值。管理员按校园学号绑定，不再使用共享 `ADMIN_PASSWORD`。完整清单与轮换见 `docs/secrets.md`。

### Turnstile

投稿端已接入标准 Turnstile widget 与服务端 Siteverify。创建 Widget（域名包含 `courses.sein.moe`、`localhost`、`127.0.0.1`）后：

1. 将公开 Site Key 配置为 `TURNSTILE_SITE_KEY` 普通变量；
2. 将对应 Secret 写入 Secrets Store 的 `TURNSTILE_SECRET`；
3. 重新部署。

Site Key 与 Secret 同时存在时服务端才启用并强制验证。仅有 Site Key 时隐藏无效 widget，并退化到蜜罐 + 同源校验 + 限流；仅有 Secret 时视为配置错误并拒绝公开写入；两者均未配置时也要求同源提交。

## 生产部署

仓库已包含真实 D1 `database_id` 和 `courses.sein.moe` Custom Domain 配置。首次部署或应用迁移：

```bash
pnpm exec wrangler d1 migrations apply jufexk --remote
pnpm run deploy
```

### GitHub Actions

`.github/workflows/deploy.yml` 在 `main` 推送且变更进入站点 / Worker 时构建并部署 Worker；类型检查、测试和 Playwright 只在 PR / merge queue 的 `ci.yml` 里跑。D1 迁移由 `.github/workflows/migrate.yml` 单独处理：只接受 `workflow_dispatch` 按需触发，合入 `main` 或部署 Worker 都不会自动跑。工作流绑定 `production` Environment，建议配置必需审核人。该 Environment 只需：

- `CLOUDFLARE_API_TOKEN`：Workers Scripts Edit（deploy）、D1 Edit（migrate）、Account Settings Read
- `CLOUDFLARE_ACCOUNT_ID`：目标 Cloudflare Account ID

CI 不导出含学生投稿的 D1 数据，避免敏感备份进入 GitHub Artifact。重大迁移前应由运维人员在受控终端执行 `pnpm exec wrangler d1 export`，并将备份保存到受限存储。

## 目录基线

课程、教师与任课关系由审核通过的原子目录基线包统一发布。基线发布后，旧式 CSV 合并 / 跳过入口永久返回 `409`；新增目录实体必须走目录补充申请及管理员审核。当前 JUFE 权威包为 `scripts/catalog-baseline/captures/full-approved-v2/manifest.json` 对应的 v2 基线。采集、派生、审核与发布流程见 `docs/catalog-baseline-acquisition.md`。

### 投稿问卷

公开投稿绑定已有任课关系。人机验证在进入「写评价」时启动；「补充课程或教师」使用独立的验证实例。

必填：课程、任课教师、四道三档题、本次推荐度（1–5）、补充说明（去空白后 10–1200 字）。学期与开课班为选填。找不到对象时可提交目录补充申请（见 [ADR-0002](./docs/adr/0002-catalog-addition-requests.md)）。

题目方向对齐中科大 iCourse 四维标签，文案与品牌不复制参考站点。规格见 [ADR-0023](./docs/adr/0023-ustc-aligned-four-tier-questions.md)。

## 项目结构

```
├── src/                    # Worker 入口（Hono）与 React 前端
│   ├── pages/              # 课程、教师、详情、登录、账号等页面
│   ├── components/         # AppShell、结果表格、评价区等组件
│   ├── lib/                # 认证、Turnstile、评价规则、标签等共享逻辑
│   ├── hooks/              # 公开评价分页、当前查看者等 React hooks
│   └── prototype/          # UI 原型变体（HeroUI v3）
├── migrations/             # D1 数据库迁移
├── scripts/
│   ├── catalog-baseline/   # 目录基线采集、派生、审核与发布
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
- `docs/adr/`：架构决策记录（目录身份、审核分层、密钥来源、校园身份等）
- `docs/catalog-baseline-acquisition.md`：目录基线采集与发布全流程
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

## 致谢

本项目在产品与实现上受益于这些公开工作，在此致谢：

- [评知校园](https://courses.pinzhixiaoyuan.com/)：课评表单的分段结构、对象绑定与填写节奏是本站投稿问卷的重要参考。
- [USTC-iCourse / ustc-course](https://github.com/USTC-iCourse/ustc-course)：前端信息架构与公开浏览体验大量参考了贵仓库的设计。课程列表、详情分层、评价阅读节奏都从中受益；四道三档题的方向也对齐 iCourse 的四维标签。非常喜欢这份前端设计。
- [SeRazon / jufe_cas](https://github.com/SeRazon/jufe_cas)：江财 CAS 实现

文案、品牌与数据模型均为本站自有；参考的是交互与协议，不是复制站点内容。

## 许可证

本项目采用 [MIT License](./LICENSE)。

## 支持

- 线上站点：[courses.sein.moe](https://courses.sein.moe)
- Issue / PRD：[github.com/K4F7/jufexk/issues](https://github.com/K4F7/jufexk/issues)
