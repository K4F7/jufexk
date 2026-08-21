## Parent

- 领域词：`CONTEXT.md`（审核包、单元格审核任务、图文核验）
- 规格：ADR 0001、ADR 0019、ADR 0020
- 全表拍摄与冻结：#311 / #312
- 冻结包：`scripts/legacy_evidence/output/full-matrix-freeze-20260819-v1/`（QA accepted，5905 格，布局 SHA `b5dd5305d61fa3b9ab45a98154edbbeefa98fbc3b2a5dde446057e94145e70ff`）
- 缺口清单：`scripts/legacy_evidence/output/production-gap-20260818-v1/production-gap-inventory.json`
- 上下文：`scripts/legacy_evidence/output/full-matrix-ocr-20260819-v1/context-index.json`（749 行）
- **不要**写进 #200；不要复用 `review-never-packaged-*` / `review-other-smoke-*` / 体育 6–14 隔离样板
- 后续：#318 人工队列与批准数据包

## 目标

**八路独立无人值守**，每张表一路，跑到 `legacy-review-package` 收口为止：

1. OCR（`inventory --worksheet` → CUDA RapidOCR → 再 inventory，直到该表不再 `needs_ocr`）
2. 同一 `out_dir` 续跑 workflow `legacy-review-package`：隔离 A/B → 仲裁 → 独立图文核验 → 编译审核包

核验通过的格 `approved=true`。本票停在审核包。不编人工队列、不编批准数据包、不导入生产。那一段另开票。

无 CUDA 则该路停，不回退 CPU。

## 八路

| 路 | 工作表 | 行范围 | `out_dir` |
|---|---|---|---|
| 1 | 主要课程 | 19–478 | `scripts/legacy_evidence/output/full-matrix-ocr-20260819-v1/主要课程/` |
| 2 | 数学课 | 8–101 | `…/数学课/` |
| 3 | 美育 | 8–14 | `…/美育/` |
| 4 | 大英和视听说 | 8–72 | `…/大英和视听说/` |
| 5 | 思政课 | 8–62 | `…/思政课/` |
| 6 | 外教 | 3–7 | `…/外教/` |
| 7 | MOOC | 8–20 | `…/MOOC/` |
| 8 | 体育课 | 6–55 | `…/体育课/` |

每路先 inventory / OCR（已有产物就续跑），再：

```
workflow legacy-review-package
  out_dir: <该路 out_dir>
  evidence_dir: scripts/legacy_evidence/output/full-matrix-freeze-20260819-v1
  context_path: scripts/legacy_evidence/output/full-matrix-ocr-20260819-v1/context-index.json
  layout: scripts/legacy_evidence/output/live-layout-20260819-v1/live-layout.json
  gap: scripts/legacy_evidence/output/production-gap-20260818-v1/production-gap-inventory.json
  worksheet / first_row / last_row: 上表
  ocr_dir: <该路 out_dir>/ocr
```

`agent_budget` 建议：该路待审起始格 × 3 + 16（上限 1024）。同一 `out_dir` 是续跑权威。

## 已定决策

1. 一路一表，互不覆盖 `out_dir`。八路可并行。
2. 只路由 `never_packaged` 且公式栏非空、有格图、有同行上下文的评价起始格。
3. `in_production` / `packaged_not_imported` / 空白格不进本票。
4. 美育 H14–M14 空白，不补拍。美育若「无评价可审」记 done，不空转 A/B。
5. MOOC 8–20，不探 G46。
6. OCR 三个会话均为 `CUDAExecutionProvider`。
7. 正文权威是公式栏。不得发明第三版通顺稿。思政课画面冲突仍用公式栏正文，标 `formula_bar_visual_conflict`，继续审映射与溢出。
8. 自动批准只来自独立图文核验（ADR 0020）。仲裁不批准。
9. 不截图、不点网格、不写腾讯 / 业务库 / Git。
10. 不编人工复核 Excel、不编批准数据包、不跑生产导入。

## 完成情况（2026-08-19）

七路已有终态 package / empty inventory。**思政课未完全收口**：inventory 仍为 `ready`，剩 1 格 pending 图文核验（`思政课|27|M`），故本票保持 OPEN。

| 路 | 工作表 | inventory | package | 批准 / 路由 | unresolved | 说明 |
|---|---|---|---|---|---|---|
| 1 | 主要课程 | empty | completed_with_exceptions | 55 / 61 | 11 | 另有 6 格核验未过 |
| 2 | 数学课 | empty | 无（无评价可审） | 0 / 0 | 0 | 范围内无 `never_packaged` 待审 |
| 3 | 美育 | empty | completed_with_exceptions | 0 / 1 | 1 | 无自动批准 |
| 4 | 大英和视听说 | empty | completed_with_exceptions | 7 / 174 | 22 | |
| 5 | 思政课 | **ready** | completed_with_exceptions | 66 / 149 | 29 | **pending_verify=1，未收口** |
| 6 | 外教 | empty | completed | 14 / 14 | 0 | |
| 7 | MOOC | empty | completed | 13 / 15 | 0 | 2 格核验未过；未探 G46 |
| 8 | 体育课 | empty | completed_with_exceptions | 138 / 138 | 17 | |

未批准 / unresolved 留在各路 `package.json`。人工队列与批准数据包见 #318（思政课当时未混入）。

未写 #200；未覆盖受保护包；未写腾讯 / 生产。

## 验收

- [ ] 八路均有独立 `out_dir` 与终态 inventory / package（美育、数学课可为 empty / 无评价可审）— **差思政课 1 格核验**
- [x] 需要 OCR 的路 CUDA 证据齐全，无 CPU 回退
- [x] 有待审格的已收口路跑完 A/B、仲裁、图文核验；通过的格 `approved=true`
- [x] 未批准 / unresolved 格留在该路 package，供后续票编人工队列
- [x] 未写 #200；未覆盖受保护包；未写腾讯 / 生产
