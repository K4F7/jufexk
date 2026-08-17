# 选课志（jufexk）

[![Deploy](https://github.com/K4F7/jufexk/actions/workflows/deploy.yml/badge.svg)](https://github.com/K4F7/jufexk/actions/workflows/deploy.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)](https://workers.cloudflare.com/)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

江西财经大学课程—教师评价站（站内名称「江财选课参考」）。评价必须绑定课程的具体任课教师，公开内容均经管理员人工审核后匿名展示。

线上站点：[xk.sein.moe](https://xk.sein.moe)

## 功能特性

- 📚 **权威课程目录**：课程、教师、任课关系由审核通过的原子目录基线包统一发布，来源身份可追溯
- ⭐ **任课评价**：学生按版本化评价规则（问卷）对「课程 × 任课教师」打分，可附选填补充说明
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
| `pnpm run legacy-evidence` | 历史评价证据处理 CLI |

## 配置

### 普通变量（`wrangler.jsonc` 的 `vars`）

| 变量 | 说明 |
| ---- | ---- |
| `SITE_NAME` / `UNIVERSITY_NAME` | 站点与学校显示名 |
| `TURNSTILE_SITE_KEY` | Turnstile 公开 Site Key |
| `CAMPUS_JWT_AUD` / `CAMPUS_APP_ID` / `AUTHBRIDGE_BASE_URL` | 校内身份认证参数 |
| `HISTORICAL_IMPORT_*` / `ISSUE111_*` | 历史导入制品的内容哈希校验值 |

### 密钥（Cloudflare Secrets Store）

`ADMIN_PASSWORD`、`IP_HASH_SECRET`、`TURNSTILE_SECRET`、`CAMPUS_JWT_SECRET`、`CAMPUS_JWT_AES_KEY`、`CAMPUS_IDENTITY_SECRET`。不要把口令、API Token 或 `.dev.vars` 提交到仓库；`IP_HASH_SECRET` 必须使用与管理员口令、Turnstile Secret 不同的随机值。

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

`.github/workflows/deploy.yml` 在 `main` 推送时依次执行类型检查、测试、构建、D1 迁移和 Worker 部署。工作流绑定 `production` Environment，建议配置必需审核人。该 Environment 只需：

- `CLOUDFLARE_API_TOKEN`：Workers Scripts Edit、D1 Edit、Account Settings Read、Secrets Store Write
- `CLOUDFLARE_ACCOUNT_ID`：目标 Cloudflare Account ID

CI 不导出含学生投稿的 D1 数据，避免敏感备份进入 GitHub Artifact。重大迁移前应由运维人员在受控终端执行 `pnpm exec wrangler d1 export`，并将备份保存到受限存储。

## 目录基线与历史评价

课程、教师与任课关系由审核通过的原子目录基线包统一发布。基线发布后，旧式 CSV 合并/跳过入口永久返回 `409`；新增目录实体必须走目录补充申请及管理员审核。当前 JUFE 权威包为 `scripts/catalog-baseline/captures/full-approved-v2/manifest.json` 对应的 v2 基线。采集、派生、审核与发布流程见 `docs/catalog-baseline-acquisition.md`。

<details>
<summary><strong>教务课程快照与 OCR 校对工作簿</strong></summary>

`scripts/legacy_ocr/build_review_workbook.py` 可合并金智教务系统保存的分页 HTML，并结合已有 OCR 输出生成：

- `course_overview_review.xlsx`：课程、教师、任课关系、开课班、OCR 别名候选和历史评价人工校对页；
- `import_samples/01_courses.csv` 至 `04_offerings.csv`：符合后台协议的 UTF-8 BOM CSV；
- `import_samples/catalog_reference_sample.json`：仅供本地 OCR 重新匹配使用的临时 ID 快照，不可当作远端 D1 ID。

分页参数可重复传入，必须按页码顺序排列，以便正确继承跨页课程行：

```powershell
uv run python scripts/legacy_ocr/build_review_workbook.py `
  --catalog-html "<第1页目录>/saved_resource(1).html" `
  --catalog-html "<第2页目录>/saved_resource(1).html" `
  --catalog-html "<第3页目录>/saved_resource(1).html"
```

生成器会校验重复键、枚举、字段长度和课程/教师引用。生成的 CSV 仅用于离线核对和历史管道兼容，不得提交到已禁用的旧式目录导入接口。OCR 课程别名和重匹配结果始终需要人工确认，不得直接作为批准数据。

人工在工作簿 `OCR课程别名核对` 页的 `decision` 列选择 `approve`、`reject` 或 `skip` 并保存后，使用以下命令生成新的评价预览。每个 OCR 课程名最多只能批准一个目标；课程代码和名称必须同时存在于匹配快照中：

```powershell
uv run python scripts/legacy_ocr/apply_alias_decisions.py `
  --workbook scripts/legacy_ocr/output/course_overview_review.xlsx `
  --preview scripts/legacy_ocr/output/rematched/legacy_reviews_preview.csv `
  --reference scripts/legacy_ocr/output/import_samples/catalog_reference_sample.json `
  --out scripts/legacy_ocr/output/rematched/alias_applied_preview.csv `
  --report scripts/legacy_ocr/output/rematched/alias_apply_report.json
```

该命令不覆盖原始 OCR 预览；应用别名后的记录仍保持 `needs_review=true`，必须继续经过 `approval.py prepare/finalize` 的逐行人工审核。

</details>

<details>
<summary><strong>腾讯表格历史评价 OCR 流水线（试验）</strong></summary>

历史文字评价使用独立的 `legacy_reviews` 模型，不写入要求 `overall` 的学生投稿表，也不伪造评分。

本机建议使用 Python 3.12。CPU 环境安装 `requirements.txt`；RTX 50 系 Windows 环境安装 `requirements-gpu.txt`，其中 PyTorch CUDA 12.8 用于向 ONNX Runtime 预加载 CUDA/cuDNN DLL。脚本在 `--cuda` 模式下会检查检测、方向分类和文字识别三个会话的首 provider，任何一个不是 `CUDAExecutionProvider` 都直接失败，禁止静默回退 CPU。

```powershell
uv venv --python 3.12 .venv
uv pip install --python .venv scripts/legacy_ocr/requirements.txt
./scripts/legacy_ocr/export_reference.ps1
# 截图命名示例：主要课程_001.png、主要课程_002.png
.venv/Scripts/python scripts/legacy_ocr/pipeline.py `
  --input scripts/legacy_ocr/input `
  --reference scripts/legacy_ocr/reference.json `
  --out scripts/legacy_ocr/output `
  --max-rows 30
```

GPU 安装与运行：

```powershell
uv pip install --python .venv -r scripts/legacy_ocr/requirements-gpu.txt
.venv/Scripts/python scripts/legacy_ocr/pipeline.py `
  --input scripts/legacy_ocr/input `
  --reference scripts/legacy_ocr/reference.json `
  --out scripts/legacy_ocr/output `
  --max-rows 30 `
  --cuda
```

RTX 5060 Ti 实测环境为 PyTorch 2.11.0+cu128、ONNX Runtime GPU 1.23.2、RapidOCR 3.9.1。51 张截图全量预览使用约 4.6GB 显存，GPU 负责 OCR 推理，OpenCV/img2table 的网格恢复和 CSV 汇总仍主要使用 CPU，因此 CPU 占用较高属于正常现象。

输入截图必须是腾讯表格 PNG 原图，并尽量保留表头。程序只读取截图和课程、教师、任课关系、开课班快照；不会连接或写入 D1。输出包括：

- `legacy_reviews_preview.csv`：完整预览和人工确认原因；
- `unmatched_courses.csv`、`unmatched_teachers.csv`：只报告，不自动创建；
- `ambiguous_matches.csv`：保留候选 ID、名称与分数；
- `duplicates.csv`：只标记疑似重复，不删除；
- `teacher_candidates_review.csv`、`course_candidates_review.csv`：实体原文聚合清单，形态初筛不等于批准；
- `relation_candidates_review.csv`：只依据结构化课程/教师列生成的任课关系候选，不从评价正文猜教师；
- `teacher_catalog_review_queue.csv`、`course_catalog_review_queue.csv`、`relation_catalog_review_queue.csv`：决策栏全空的基础目录人工确认队列；
- `ocr_report.json`：模型、置信度、工作表统计、处理时间和错误。

只有课程与教师均唯一匹配、OCR 平均置信度达标、教师已有该课程任课关系，且不存在继承/截断/重复/开课班歧义时，`needs_review` 才可能为 `false`。人工确认时只修改预览副本；批准文件另存为 `legacy_reviews_approved.csv`，后续再由带事务、批次记录和批次回滚的专用导入器写入，默认仍为 `pending`。

全量 OCR 后可通过 `--ocr-cache scripts/legacy_ocr/output/raw_ocr_tokens.jsonl` 复用 token 调整结构恢复，不会再次占用 GPU。实体候选聚合命令为：

```powershell
.venv/Scripts/python scripts/legacy_ocr/aggregate_candidates.py `
  --preview scripts/legacy_ocr/output/legacy_reviews_preview.csv `
  --out scripts/legacy_ocr/output
```

人工确认必须经过显式队列，不能直接把预览文件当成批准文件：

```powershell
.venv/Scripts/python scripts/legacy_ocr/approval.py prepare `
  --preview scripts/legacy_ocr/output/legacy_reviews_preview.csv `
  --out scripts/legacy_ocr/output/legacy_reviews_review_queue.csv

.venv/Scripts/python scripts/legacy_ocr/approval.py finalize `
  --queue scripts/legacy_ocr/output/legacy_reviews_review_queue.csv `
  --reference scripts/legacy_ocr/reference.json `
  --approved scripts/legacy_ocr/output/legacy_reviews_approved.csv `
  --errors scripts/legacy_ocr/output/approval_errors.csv `
  --payload-dir scripts/legacy_ocr/output/import_payloads
```

审核人员逐行填写 `decision=approve|reject|skip`、现有课程/教师 ID 和 `review_note`；疑似重复但仍保留时还要填写 `duplicate_action=keep`。存在任意批准错误时不会生成批准文件。校验包括对象存在性、课程—教师关系、开课班归属、原始 OCR 证据和重复确认，输出字段不包含 `overall`。

基础目录队列与评价批准队列相互独立。先人工确认教师、课程和任课关系，并将批准结果编译进原子目录基线或目录补充申请；不要调用已永久禁用的旧式两阶段 CSV 接口。开课班必须单独提供明确的学期和班次数据，不能虚构空学期或"导入默认班"。

每个生成的 JSON payload 最多 40 条，并包含内容哈希幂等键，以兼容 D1 免费计划每次 Worker 调用的查询额度并避免重复提交。先提交到管理员接口 `/api/admin/legacy-imports/preview`，再提交 `/api/admin/legacy-imports`。D1 `batch()` 保证单个导入批次原子写入，记录默认 `pending`；`POST /api/admin/legacy-imports/:id/rollback` 可原子删除该批次记录并保留回滚审计状态。不要在未审核前调用导入接口。

管理员后台的"历史评价"标签已封装上述流程：选择批准 JSON 后只执行预览，服务端校验全部通过才显示"确认导入为待审核"；同一页面列出批次及待审/通过/驳回数量，并仅允许回滚仍为 `imported` 的批次。批次列表不返回 manifest、OCR 原文或 token，避免在列表接口暴露大段历史内容。

导入后的每条历史记录仍需在该页面逐条通过或驳回，驳回必须填写理由，并记录不可重复的审核事件。批次中一旦有记录完成审核，整批就禁止回滚，以免删除已公开内容和审核证据。只有 `approved` 的历史记录会在课程页和教师页的"历史文字资料"区块展示；该区块没有 `overall`，不参与任何评分、评价数量或排序统计。

</details>

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
│   ├── legacy_ocr/         # 腾讯表格截图 OCR 与人工校对流水线（Python）
│   ├── legacy_evidence/    # 历史评价证据处理（TypeScript）
│   ├── historical-import/  # 历史评价生产导入
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

本仓库为私有项目，暂未选择开源许可证；未经授权不得复制、分发或用于其他用途。
