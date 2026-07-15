# 主要课程 OCR 试验样本

试验输入：`D:\19016\Downloads\major\QQ20260716-050529.png`。这是“主要课程”工作表的首张可用截图，但截图顶部已经处于某个合并课程区块内部，当前课程名称在画面之外。

## 结果

- 截图：1 张；
- RapidOCR 文本框：123 个；
- 平均 OCR 置信度：0.9547；
- img2table 检出的独立评价单元格：55 个；
- 按试验约束输出：前 30 条；
- 自动公开或写入 D1：0 条；
- `needs_review=true`：30 条。

本地输出位于 `scripts/legacy_ocr/output/`，包括完整预览、未匹配课程/教师、歧义、重复、原始 OCR token JSONL 和报告。该目录被 Git 忽略，避免未经确认的历史评价进入公开仓库。

## 已验证能力

- 能从“学生评价1…9”的横向多评价列中逐格拆分独立评价；
- 当前两个评价列表头缺失时，可由首个可识别编号“学生评价3”反推评价1/2列；
- 教师列不再与评价列混淆，样本中可恢复“陈江华”“陈凌”等教师原文；
- 每条记录保留截图、表格行列、OCR 原文、置信度和 token 坐标；
- 30 条试验上限只产生 warning，不被误报成 OCR 错误。

## 需要人工确认的典型情况

1. 截图从合并课程区块中段开始，课程名称不在画面中：`course_context_missing_at_screenshot_start`。
2. 课程/教师基础快照只有 2 门课程、1 位教师，无法匹配绝大多数历史记录。
3. 某些评价单元格没有独立 OCR token，仅有 img2table 合并文字，置信度为 0，必须复核。
4. 教师单元格为空时，只在同一截图区块向下继承，并记录 `inherited_from`；跨截图暂不自动继承。
5. 课程标题行本身含评价但没有教师时，标记 `teacher_unresolved_section_row`，不猜任课教师。

## 人工确认流程

1. 打开原 PNG，按 `source_file` 和 `source_row` 定位单元格。
2. 核对 `raw_ocr_text`、`comment` 和 `ocr_tokens_json`，修正 OCR 错字但保留原文。
3. 从已有 D1 候选中确认课程和教师；不得在此阶段自动创建对象。
4. 无明确学期时保持 `term`、`matched_offering_id` 为空。
5. 清除所有 review reason 后，另存为 `legacy_reviews_approved.csv`。
6. 批量导入器实现并审核前，不应用 `0006_legacy_reviews.sql` 到远端 D1。
