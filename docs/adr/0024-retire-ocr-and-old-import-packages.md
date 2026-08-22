# 退役 OCR 抽取与旧历史评价导入包，只保留 v10

历史评价抽取（GPU OCR、公式栏矩阵、审核包）与多轮冻结导入已经完成。仓库不再保留 `scripts/legacy_ocr`、`scripts/legacy_evidence`，也不再保留 v2 / issue111 / v5-candidate-v1..v9 的生产导入入口。

当前唯一生产导入包是 `frozen-historical-v5-candidate-v10`，由 `pnpm run historical-import:v5` 调用 `/api/admin/historical-review-v5-imports`。#365 已把它写入生产（35 条，公开历史评价 1239 → 1274）。更早批次已经在库中，文档禁止重放。

目录基线批准包（`full-approved-v2`）不是历史评价导入包，继续作为课程 / 教师 / 任课关系权威。已导入行上的 `legacy_ocr` 来源字段与 `raw_ocr_text` 列保留，不做破坏性迁移。

权威规格：GitHub issue #391
