# 腾讯表格历史评价全量预览报告

处理范围：7 个工作表、51 张 PNG。所有结果均为本地预览，未应用 `0006_legacy_reviews.sql`，未写入线上 D1。

## OCR 运行

- 引擎：RapidOCR 3.9.1；
- GPU：RTX 5060 Ti；
- PyTorch：2.11.0+cu128；
- ONNX Runtime GPU：1.23.2；
- 检测、方向分类、文字识别三个会话的首 provider 均为 `CUDAExecutionProvider`；
- 原始 OCR 文本框：5962；
- 平均置信度：0.9732；
- 首次 51 页 OCR 耗时：1364.035 秒；
- 运行中显存约 4.6GB。OpenCV/img2table 的网格恢复仍主要使用 CPU。

## 结构恢复

首次 img2table 预览得到 810 条。复用 `raw_ocr_tokens.jsonl` 进行坐标二次恢复后得到 1150 条：

| 工作表 | 候选评价 |
| --- | ---: |
| 主要课程 | 696 |
| 数学课 | 110 |
| 英语 | 31 |
| 思政课 | 230 |
| 外教 | 15 |
| MOOC | 26 |
| 体育课 | 42 |

二次恢复只需约 12 秒，不重复 OCR。数学和思政使用首图表头列坐标、每页横线及教师列锚点恢复；窄幅尾页只处理实际可见列。

## 质量状态

- `needs_review=true`：1150；
- 已匹配现有课程和教师：0；
- 疑似重复：40；
- 检测到同一横向行带含多位教师：21。这些记录已清空教师自动归属并标记 `multiple_teacher_rows_in_band`；
- 课程/教师快照当前只有 2 门课程、1 位教师，因此不得把未匹配视为 OCR 失败，也不得自动创建对象；
- 无明确学期或开课班，不填写 `term` 和 `matched_offering_id`；
- 不生成或推算 `overall`。
- 后续恢复策略成功时，较早策略的失败只写入 `warnings`；只有整张图没有产生可信结构行时才进入 `errors`，原始 token 始终保留。
- 已生成 274 个教师原文聚合候选（90 个仅通过姓名形态初筛）和 17 个课程候选（11 个通过形态初筛）；这些数字不是匹配或批准结果。
- 已生成 68 个课程—教师组合候选；由于都包含单页、继承或教师上下文歧义，没有任何组合被自动标为可信关系。

## 文件

最终本地预览位于 `scripts/legacy_ocr/output/`：

- `legacy_reviews_preview.csv`；
- `unmatched_courses.csv`；
- `unmatched_teachers.csv`；
- `ambiguous_matches.csv`；
- `duplicates.csv`；
- `raw_ocr_tokens.jsonl`；
- `ocr_report.json`；
- `teacher_candidates_review.csv`、`course_candidates_review.csv`；
- `relation_candidates_review.csv`；
- 三份基础目录人工确认队列（教师、课程、任课关系，决策栏初始均为空）；
- `legacy_reviews_review_queue.csv`（1150 行，决策栏初始均为空）。

该目录被 Git 忽略，避免未确认的历史评价进入公开仓库。主要课程、英语和体育的部分续页仍只有原始 OCR token；抽查证明简单坐标模板会产生列错位，因此保守地没有把这些文本包装成结构化评价。下一步需要补齐课程、教师和任课关系快照，再重新运行匹配；人工确认前不得生成 `legacy_reviews_approved.csv`。
