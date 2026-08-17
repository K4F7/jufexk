# 历史评价生产导入与验收

生产操作只允许在已批准的维护窗口执行。v2 冻结包固定放在 `D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-production-v2`，生产脚本只读取其中的 `manifest.json` 与 `importable-legacy-reviews.jsonl`；`catalog-relation-unavailable.jsonl` 中的 419 条由 #111 独立处理，不得上传。#111 确认候选 61 对 / 164 条的交接见 [issue111-handoff.md](./issue111-handoff.md)，候选包绝对路径为 `D:\19016\Documents\Workload\jufexk-production-inputs\issue111-relation-addition-v1`。

先准备管理员密码和已导出的生产备份绝对路径，执行只读预检。预检要求备份文件已存在，并核对 v2 目录 marker、3740 门课程、1951 位教师、11482 条任课关系、冻结包契约与 522 条可导入记录；退出码 `2` 表示预览完成且没有写入。

```powershell
$env:JUFEXK_BASE_URL = 'https://xk.sein.moe'
$env:JUFEXK_ADMIN_PASSWORD = '...' # 或 $env:ADMIN_PASSWORD
$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\historical-production-v2-<UTC_TIMESTAMP>.sql'
pnpm run historical-import:production -- 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-production-v2'
```

确认预览输出中的 Worker、目录 marker、课程/教师/任课关系计数和备份 SHA-256 后，在同一窗口执行写入。正式写入必须使用一个尚不存在的新备份绝对路径；脚本会先用 Wrangler 创建远程 D1 导出，再逐批提交最多 50 条记录，完整重放一次验证 `existing=522`，并输出可归档的 JSON 审计记录。

```powershell
$env:JUFEXK_BASE_URL = 'https://xk.sein.moe'
$env:JUFEXK_ADMIN_PASSWORD = '...' # 或 $env:ADMIN_PASSWORD
$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\historical-production-v2-<UTC_TIMESTAMP>.sql'
pnpm run historical-import:production -- 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-production-v2' --apply |
  Set-Content -Encoding utf8 'D:\19016\Documents\Workload\jufexk-production-inputs\audit\historical-production-v2.json'
```

任何契约、哈希、marker、目录计数、导入计数或幂等复核失败都会中止；保留备份和输出，按演练步骤恢复。公开验收应另外抽查课程与教师入口、搜索和排序页面，确认仅展示匿名文字评价，不宣称评分、投稿、审核或身份功能已上线。

## Issue 111：61 条任课关系 + 164 条追加历史评价

#111 不得复用或改写上面的 522 条冻结包。本仓库只提供工具；生产写入仍须另开维护窗口，且本缺陷合入本身不得写生产 D1。

候选包固定路径：`D:\19016\Documents\Workload\jufexk-production-inputs\issue111-relation-addition-v1`。164 条冻结包生成后固定放在 `D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-issue111-v1`。

### 1. 只新增 61 条任课关系

预检要求备份已存在，并核对 v2 marker 哈希、现场计数 `3740/1951/11482`、公开历史评价仍为 `522`，以及 61 对全部「课在、师在、关系不在」。默认走官方候选包入口；`--via-pairs` 改走冗余的 append-only `pairs` 入口，预检与写入语义相同。

```powershell
$env:JUFEXK_BASE_URL = 'https://xk.sein.moe'
$env:JUFEXK_ADMIN_PASSWORD = '...' # 或 $env:ADMIN_PASSWORD
$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\issue111-relations-<UTC_TIMESTAMP>.sql'
pnpm run catalog-relations:production
# 冗余入口：
# pnpm run catalog-relations:production -- --via-pairs
```

确认预览后，用一个尚不存在的新备份路径加 `--apply`。写入后现场计数必须是 `3740/1951/11543`，marker 哈希不变，幂等重放 `existing=61`，522 条历史评价不变。

最后手段（仅 runbook，不作为默认脚本）：在已备份的维护窗口对这 61 对执行 `INSERT OR IGNORE INTO course_teachers ... SELECT c.id,t.id FROM courses c CROSS JOIN teachers t WHERE c.code=? AND t.source_teacher_label=?`。禁止改课、改师、删关系。

### 2. 生成 164 条独立冻结包

官方关系入目录之后，才用候选包中的 164 条生成新冻结包。不要把隔离 241 / 弃用 14 混进去，也不要改 `review_id` 或已批准正文。

```powershell
uv run --directory scripts/legacy_ocr python freeze_issue111_historical_package.py --source 'D:\19016\Documents\Workload\jufexk-production-inputs\issue111-relation-addition-v1' --out 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-issue111-v1'
```

### 3. 导入 164 条

预检要求现场任课关系已是 `11543`，公开历史评价仍是 `522`。正式写入后合计 `686`，本批幂等复核 `existing=164`。此脚本只打 `/api/admin/historical-review-batch-imports`，不会改 #108 的 522 条入口或 `wrangler.jsonc` 钉扎。

```powershell
$env:JUFEXK_BASE_URL = 'https://xk.sein.moe'
$env:JUFEXK_ADMIN_PASSWORD = '...'
$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\issue111-historical-<UTC_TIMESTAMP>.sql'
pnpm run historical-import:issue111
pnpm run historical-import:issue111 -- --apply
```

