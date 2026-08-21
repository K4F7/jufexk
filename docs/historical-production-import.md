# 历史评价生产导入与验收

生产操作只允许在已批准的维护窗口执行。v2 冻结包固定放在 `D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-production-v2`，生产脚本只读取其中的 `manifest.json` 与 `importable-legacy-reviews.jsonl`；`catalog-relation-unavailable.jsonl` 中的 419 条由 #111 独立处理，不得上传。#111 确认候选 61 对 / 164 条的交接见 [issue111-handoff.md](./issue111-handoff.md)，候选包绝对路径为 `D:\19016\Documents\Workload\jufexk-production-inputs\issue111-relation-addition-v1`。体育课名 × 老师 10 对 / 64 条是其后的独立后续，见 [pe-course-teacher-handoff.md](./pe-course-teacher-handoff.md)，不得重放 522 / 164 / 120 / 12，也不得重放这 64 条。

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

## 体育课名 × 老师：已写入的 5 条任课关系 + 64 条历史评价

本批不得复用或改写上面的 522 条或 #111 的 164 / 120 / 12 条，也不得重放本批 64 条。领域决策见 [ADR-0018](./adr/0018-pe-course-name-teacher-binding.md)，交接见 [pe-course-teacher-handoff.md](./pe-course-teacher-handoff.md)。

候选包：`D:\19016\Documents\Workload\jufexk-production-inputs\issue111-pe-course-teacher-v1`。主工作区整理副本：`D:\19016\Documents\Workload\jufexk\.local-data\course-x-teacher\working\`。

2026-08-17 维护窗口已写入：课程 / 教师仍为 `3740 / 1951`，任课关系 `11567 → 11572`，公开历史评价 `818 → 882`。目录基线 marker 哈希未变。不要再执行该包的 apply 脚本。

## Issue 334：v5 批准包生产候选冻结包（只读预检）

#334 把 `review-approved-20260820-v5` 编成独立生产候选冻结包。不得覆盖 v5 批准包、#316 各路 `out_dir`、冻结矩阵包，也不得重放 522 / 164 / 120 / 12 / 64。默认停在预检；`--apply` 在本票明确授权前会直接拒绝。

候选包固定路径：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v1`。

```powershell
uv run --directory scripts/legacy_ocr python freeze_v5_production_candidate.py --source 'D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5' --catalog 'D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2' --imported-root 'D:\19016\Documents\Workload\jufexk-production-inputs' --out 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v1'
```

预检要求备份文件已存在，并核对 v2 目录 marker 与课程/教师计数 `3740 / 1951`。任课关系与公开历史评价按现场实数记录，不把旧批次的 11482 / 882 当作写入目标。退出码 `2` 表示预览完成且没有写入。

```powershell
$env:JUFEXK_BASE_URL = 'https://xk.sein.moe'
$env:JUFEXK_ADMIN_PASSWORD = '...' # 或 $env:ADMIN_PASSWORD
$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\<existing-backup>.sql'
pnpm run historical-import:v5
```

## Issue 340：所有者裁定后的 v2 候选包

#340 按所有者裁定重映射，编 v2，不覆盖 v1。`--apply` 仍拒绝，除非本票另有授权。

- 思政简称对正式名；一对多用老师唯一任课
- 大英/视听说按老师唯一大学英语或视听说课绑定，不猜 I/II/III/IV
- 体育一师一课（忽略体育1–4）；`足球69`=`足球`，`散打上课`=`散打`
- 空教师只接受回表公式栏补值，不从邻行继承

候选包：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v2`

```powershell
uv run --directory scripts/legacy_ocr python freeze_v5_production_candidate.py --source 'D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5' --catalog 'D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2' --imported-root 'D:\19016\Documents\Workload\jufexk-production-inputs' --out 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v2'
pnpm run historical-import:v5
```

## Issue 342：回表补 v2 空教师后的 v3 候选包

#342 回腾讯表读 26 行教师列公式栏原文，经 `--teacher-overrides` 编 v3，不覆盖 v2 / v1。表上仍空则保持排除，不从邻行继承。`--apply` 仍拒绝，除非本票另有授权。2026-08-21 这 26 行公式栏均为空或空白，overrides `items` 为空，因此 v3 与 v2 的 manifest / importable 哈希相同；`historical-import:v5` 当时按该哈希预检。

候选包：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v3`

```powershell
uv run --directory scripts/legacy_ocr python freeze_v5_production_candidate.py --source 'D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5' --catalog 'D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2' --imported-root 'D:\19016\Documents\Workload\jufexk-production-inputs' --out 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v3' --teacher-overrides 'D:\19016\Documents\Workload\jufexk-production-inputs\v5-teacher-overrides-v3.json'
pnpm run historical-import:v5
```

## Issue 343：一师多编号大学英语按已有任课落课（v4）

#343 在 #342 的 v3 之上给多编号英语老师定级：可见「视听说」只在 `英语视听说*` / `视听说*` 里选；可见「大英和视听说」先无括号 `大学英语I–IV`，再含修饰大学英语，再视听说族；同族优先 `I` / `1`，否则课号最小。只绑该老师已有任课，一格一个课号，不拆 `邱垂亿（大英）` / `萨曼莎/温华` / `赵娟（经典英语视听说）`。新候选包 v4，不覆盖 v3 / v2。`--apply` 仍拒绝。

候选包：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v4`

```powershell
uv run --directory scripts/legacy_ocr python freeze_v5_production_candidate.py --source 'D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5' --catalog 'D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2' --imported-root 'D:\19016\Documents\Workload\jufexk-production-inputs' --out 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v4' --teacher-overrides 'D:\19016\Documents\Workload\jufexk-production-inputs\v5-teacher-overrides-v3.json'
pnpm run historical-import:v5
```

## Issue 346：剥掉教师名后的课目标注（v5）

#346 把 `（大英）` / `（经典英语视听说）` 当课目标注从可见教师名去掉，再按 #343 规则落课：`邱垂亿（大英）`→`邱垂亿`，`黄荃（大英）`→`黄荃`，`赵娟（经典英语视听说）`→`赵娟`。不拆 `萨曼莎/温华`。新候选包 v5，不覆盖 v4。`--apply` 仍拒绝。

候选包：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v5`

```powershell
uv run --directory scripts/legacy_ocr python freeze_v5_production_candidate.py --source 'D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5' --catalog 'D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2' --imported-root 'D:\19016\Documents\Workload\jufexk-production-inputs' --out 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v5' --teacher-overrides 'D:\19016\Documents\Workload\jufexk-production-inputs\v5-teacher-overrides-v3.json'
pnpm run historical-import:v5
```

## Issue 348：按回表截图裁定补空教师（v6）

#348 在 v5 之上按所有者看图裁定写入 `--teacher-overrides`：MOOC 8 樊凤龙、MOOC 18 李珺、主要课程 155 王云、外教 3 Christine、外教 6 carl。常见急救知识（153）因目录非唯一任课排除；点名排除行与未点名空教师行不继承。新目录 v6，不覆盖 v5 / v4 / v3。`--apply` 仍拒绝。

候选包：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v6`

```powershell
uv run --directory scripts/legacy_ocr python freeze_v5_production_candidate.py --source 'D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5' --catalog 'D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2' --imported-root 'D:\19016\Documents\Workload\jufexk-production-inputs' --out 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v6' --teacher-overrides 'D:\19016\Documents\Workload\jufexk-production-inputs\v5-teacher-overrides-v6.json'
pnpm run historical-import:v5
```

## Issue 349：清洗教师名末尾括号旁注（v7）

#349 把可见教师名末尾 `（…）` / `(…)` 当旁注去掉后再匹配目录教师，例如 `孙伟(求评价!!!)`→`孙伟`。课目标注（`（大英）` 等）走同一规则。不拆 `萨曼莎/温华`。#348 占用 v6，本票编 v7，编译时带上 v6 的 `--teacher-overrides`。`--apply` 仍拒绝。本 PR（#353 / #352）授权的是 v6 写入，不对本 v7 候选执行 apply。

候选包：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v7`

```powershell
uv run --directory scripts/legacy_ocr python freeze_v5_production_candidate.py --source 'D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5' --catalog 'D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2' --imported-root 'D:\19016\Documents\Workload\jufexk-production-inputs' --out 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v7' --teacher-overrides 'D:\19016\Documents\Workload\jufexk-production-inputs\v5-teacher-overrides-v6.json'
pnpm run historical-import:v5
```

## Issue 352：导入 v6 并丢弃剩余空教师格

#352 把 v6 的 356 条写入生产。公开历史评价 `882 → 1238`。目录 3740 / 1951 / 11572 与 marker 不变。不重放 522 / 164 / 120 / 12 / 64。正式写入必须用尚不存在的新备份路径。

```powershell
$env:JUFEXK_BASE_URL = 'https://xk.sein.moe'
$env:JUFEXK_ADMIN_PASSWORD = '...'
$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\v6-historical-<UTC_TIMESTAMP>.sql'
pnpm run historical-import:v5
pnpm run historical-import:v5 -- --apply
```

腾讯表已封存，不能改格。剩余 57 格空教师评价在导入后标为所有者丢弃，不再当 missing_teacher 待办。已补名但目录未绑上的樊凤龙 / Christine / carl 不丢弃。

## Issue 354：候选包内表上带括号教师名一律清洗（v8）

#354 在 #349 匹配规则之上，把清洗后的教师名写进 lineage / 排除标签：`邱垂亿（大英）` 记作 `邱垂亿`，不再保留括号旁注。绑定与 v7 相同。不拆 `萨曼莎/温华`。新候选包 v8，不覆盖 v7。`historical-import:v5` 仍钉 v6，不对 v8 `--apply`。

候选包：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v8`

```powershell
uv run --directory scripts/legacy_ocr python freeze_v5_production_candidate.py --source 'D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5' --catalog 'D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2' --imported-root 'D:\19016\Documents\Workload\jufexk-production-inputs' --out 'D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v8' --teacher-overrides 'D:\19016\Documents\Workload\jufexk-production-inputs\v5-teacher-overrides-v6.json'
```


