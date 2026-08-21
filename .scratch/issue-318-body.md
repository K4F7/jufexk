## Parent

- 领域词：`CONTEXT.md`（审核包、批准数据包、图文核验）
- 规格：ADR 0001、ADR 0020
- 前置：#316（八路无人值守跑到审核包；本票 **Blocked by #316**）
- 冻结包：`scripts/legacy_evidence/output/full-matrix-freeze-20260819-v1/`
- 八路审核 `out_dir`：`scripts/legacy_evidence/output/full-matrix-ocr-20260819-v1/<表>/`
- CLI：#319（`human-queue` / `compile-approved`）
- **不要**写进 #200

## 目标

#316 收口之后：把未自动批准的格编成**少量人工审核队列**；人审完后由程序编译批准数据包。本票不导入生产。

## 人工队列（每条必须有）

1. **当时截图**：该格 `*-cell.jpg`（有 conflict 图则一并附上）
2. **行列**：工作表名、原始行号、列字母（键 `工作表|行|列`）
3. **需要审核的原文**：公式栏原值 `formula_bar_value`，不得另写一稿

另写：课名 / 教师（冻结同行上下文）、未批准原因（核验失败 / unresolved / missing_context / 映射不成立）。

只收 #316 各路 package 里 `approved != true` 且不是 `not_applicable` 的格。空白格、已进生产、已打包未导入不进队。

交付物（gitignored，新目录，不覆盖 #316 `out_dir`）：

- 人工队列清单（JSON + 给人看的表）
- 每条可点开截图路径
- 人工决定列：通过 / 驳回 / 跳过 + 备注

## 批准数据包

程序只编译 Excel / 清单里**明确的人工决定**，加上 #316 已 `approved=true` 的格。Excel 不可直接导入。产出版本化 JSONL 批准数据包（课程、教师、任课关系、历史评价、排除报告、证据哈希）。

## 已定决策

1. 等 #316 八路都有终态再开编。未收口的表不得混进队列。
2. 不得发明第三版通顺稿。
3. 不写腾讯表格、不写业务库、证据不进 Git。
4. 网站生产导入是后续独立授权，本票不做。

## 完成情况（2026-08-19）

#316 当时七路已收口、思政课仍有 1 格 pending 图文核验，故队列**未混入思政课**。

人工核验包（Markdown，沿用既有 `manual-review.md` + 相对路径截图）：

- `scripts/legacy_evidence/output/human-queue-20260819-v1/manual-review.md`
- `scripts/legacy_evidence/output/human-queue-20260819-v1/human-queue.json`
- zip：`scripts/legacy_evidence/output/human-queue-20260819-v1.zip`

队列 **226** 格（自动批准 227 格未进队；缺图/缺原文 0）：

| 表 | 入队 |
|---|---|
| 大英和视听说 | 189 |
| 主要课程 | 17 |
| 体育课 | 17 |
| MOOC | 2 |
| 美育 | 1 |
| 外教 | 0（14/14 已自动批准） |
| 数学课 | 0（无待审） |
| 思政课 | 未混入（当时未收口） |

人工决定：226 格全部 `通过`（`note=人工全量通过`）。

批准数据包：`scripts/legacy_evidence/output/review-approved-20260819-v1/`

- auto_approved 227 + human_passed 226 = evaluations **453**
- courses 43 / teachers 106 / course_teachers 52
- excluded 0，undecided 0
- `wrote_tencent_or_business_db: false`

未导入生产；未写 #200。思政课收口后需再编一次队列才能补进。

## 验收

- [x] 人工队列每条都有截图、行列、公式栏原文
- [x] #316 已自动批准的格不进人工队
- [x] 人工决定后能编出批准数据包
- [x] 未导入生产；未写 #200

## 非目标

- 不重跑 OCR / A/B / 图文核验
- 不改冻结包
- 不执行 `historical-import:production`
