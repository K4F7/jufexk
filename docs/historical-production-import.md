# 历史评价生产导入

仓库只保留一份已确认的生产导入包：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v10`。配套任课关系包是 `D:\19016\Documents\Workload\jufexk-production-inputs\issue365-relation-addition-v1`。

#365 已写入生产：先补 7 条任课（`11572 → 11579`），再导入 35 条历史评价（`1239 → 1274`）。目录课程 / 教师 / marker 不变。不要再对该包 `--apply`，也不要重放更早的 522 / 164 / 120 / 12 / 64 / 357 批次。OCR 抽取与 v2 / issue111 / v5-candidate-v1..v9 入口已退役，见 [ADR-0024](./adr/0024-retire-ocr-and-old-import-packages.md)。

生产操作只允许在已批准的维护窗口执行。脚本只读取该包的 `manifest.json` 与 `importable-legacy-reviews.jsonl`。

```powershell
$env:JUFEXK_BASE_URL = 'https://xk.sein.moe'
$env:JUFEXK_ADMIN_PASSWORD = '...' # 或 $env:ADMIN_PASSWORD
$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\issue365-relations-<UTC_TIMESTAMP>.sql'
pnpm run catalog-relations:v10
# 已写入后不要再 --apply

$env:JUFEXK_BACKUP_PATH = 'D:\19016\Documents\Workload\jufexk-production-inputs\backups\issue365-historical-<UTC_TIMESTAMP>.sql'
pnpm run historical-import:v5
# 已写入后不要再 --apply
```

任何契约、哈希、marker、目录计数、导入计数或幂等复核失败都会中止。公开验收只抽查匿名文字评价，不宣称评分或身份功能已上线。
