# 冻结矩阵之后的审核包由 Grok workflow 编排，正文仍以公式栏为准

状态：已接受

日期：2026-08-18

权威规格：GitHub issue #179

修订：[ADR-0001](./0001-legacy-review-tiered-moderation.md) 中「单元格审核不得使用 Grok」一条，仅限**矩阵冻结之后**的审核编排。#220 再允许 Grok workflow `legacy-matrix-freeze` **编排**冻结：它只 `execute` 仓库 locator / capture / 冻前构图 QA CLI。截图、地址框定位和评价单元格清单仍必须由确定性程序完成，不得改用模型点格或看图。

## 背景

历史评价提取已分成两段：先用地址框与公式栏双读冻结 `formula-bar-matrix-plan-v1`（14985 格），再对评价起始单元格做 OCR、对抗分析与仲裁。#180 继续负责冒烟 capture 与构图；#179 只回答冻结之后的审核包如何编排。

既有 `scripts/legacy_evidence` 的 Luna/Sol 隔离 runner 能跑 A/B，但公式栏成为正文权威之后，模型不再承担通顺转写。同时 Grok workflow 适合把「已冻结 manifest → 批次 → 隔离 A/B → 仲裁 → 未批准审核包」编成可重复运行。Grok 进程中断不可按 journal 跨进程恢复，所以磁盘上的 inventory / matrix / attempts 才是恢复权威。

## 决策

1. **主机分工**：Capture、地址框定位、矩阵键生成、冻前构图 QA 与逐行上下文索引仍走现有 TypeScript。Grok 可以编排：`legacy-matrix-freeze` 按工作表与行范围调用这些 CLI，再冻新 manifest；`legacy-review-package` 只编排已冻结公式栏证据与 capture manifest。两个 workflow 都不截图、不点网格、不登录、不写腾讯表格。人必须先打开只读会话并声明「只能查看已就绪」。缺表、缺输出目录或未声明只读就绪则 pause。未给末行时先 `scan-extent`，范围取已扫到表尾的冻结末行（默认七表：主要课程、数学课、美育、大英和视听说、思政课、MOOC、体育课；不含外教）。`recapture_required` 停在该范围并留下检查点，不覆盖 #180。Grok 进程被杀后不得假装 journal 可跨进程恢复；同一 `out_dir` 才是续跑权威。
2. **确定性清单**：`scripts/legacy_evidence/review_package.ts` 生成审核包清单。模型不得创建或删除矩阵键。同一工作表最多 8 个相邻待审格一批；公式栏正文 ≥400 字缩到 4 格，≥800 字缩到 1 格。
3. **恢复与无人值守**：成功/失败都追加到 gitignored 的 `matrix.json` 与 `attempts.json`。同一批次先干净重试一次，两次失败再二分，单格两次失败才 `unresolved: agent_exhausted`；其余格保持有效。只缺一侧结论的格子必须再入队。workflow 在给定冻结范围内循环到没有待审格：每波按剩余 `agent_budget` 决定批次数（每波最多 8 批），OCR → A/B → 仲裁 → compile 之间不等人。指纹两次相同或预算不足时停下并留下检查点。重新跑同一 `out_dir` 即续跑。Grok 进程被杀后不得假装可 resume。建议按待审起始格 × 3 加 16 预留设置 `agent_budget`（上限 1024）。冻结上下文索引盖不住的行不得猜测，标 `missing_context`。
4. **OCR**：仍强制本机 GPU RapidOCR（三个会话均为 `CUDAExecutionProvider`），workflow 只调用 `scripts/legacy_ocr/ocr_review_cells.py` 对已路由评价起始格的裁图做识别。CUDA 不可用必须停，不得回退 CPU。缺 OCR 时清单状态为 `needs_ocr`，不派发 A/B。
5. **A/B 审什么**：正文权威是公式栏原值。分析 A 看裁图、行上下文和公式栏原值，不看 OCR；分析 B 额外看 OCR。双方输出课程/教师可见值、锚点继承、横向溢出和画面/公式栏对应关系，不得发明第三版通顺稿，也不得改写公式栏正文。
6. **思政课系统性画面冲突**：公式栏非空且 `visible_text_conflicts_with_formula` 时，仍采用公式栏正文，标记 `formula_bar_visual_conflict`，A/B 只审映射与溢出。不得因为常见画面冲突把整表打成 `unresolved`。定位失败（`halt_batch`、地址错位、双读不一致）仍按格 `unresolved` 并要求重截。
7. **批准门**：A/B 与仲裁本身不批准。独立图文核验通过后可由 [ADR-0020](./0020-verifier-gated-auto-approval.md) 把该格标为 `approved=true`。核验失败或缺失则保持未批准。不得写入业务数据库。

## 被否决的方案

- **继续只用 Luna/Sol 做正文转写**：公式栏已是正文权威，再让模型通顺化会制造第三版稿，否决。
- **用 Grok workflow 截图或定位**：#180 / #220 已否决；编排可以走 Grok，定位与抓图仍是程序。旧 `navigation.jsonl` 点格会错位，否决。
- **画面与公式栏冲突一律 unresolved**：思政课全表都会被倒进人工转写，否决。
- **仲裁即批准**：仲裁只选边；批准改走 [ADR-0020](./0020-verifier-gated-auto-approval.md) 的独立图文核验，否决把仲裁直接当批准。
- **把证据或评价正文纳入 Git**：否决。

## 后果

仓库增加项目级 workflow `.grok/workflows/legacy-matrix-freeze.rhai` 与 `.grok/workflows/legacy-review-package.rhai`，以及确定性清单编译器。编排可以走 Grok；定位与抓图仍是程序。#180 冒烟包保持只读。冻结完成后，`legacy-review-package` 可在该包的上下文覆盖范围内无人值守跑完机器审核与图文核验。没有逐行上下文的行不得猜测。生产导入仍是后续独立授权。
