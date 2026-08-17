# 基线后只新增官方任课关系，历史评价按批次追加

_与 [ADR-0013](./0013-carry-forward-approved-catalog-subset.md)（基线发布后的变化仍只能走目录补充申请）以及 `CONTEXT.md`「目录补充申请」条目冲突——此处明确收窄：用户侧 `POST /api/catalog-requests` 仍只用于新建课程或教师身份；所有者已批准、且课/师身份已在权威目录中的缺失任课关系，不再假装成课程/教师申请。_

目录基线发布后，用户目录补充申请仍只用于新建课程或教师身份。所有者已批准、且课程/教师身份已在权威目录中的缺失任课关系，走独立的只新增写入路径：仅 `INSERT OR IGNORE` `course_teachers`，不改课、不改师、不删旧关系，也不更新目录基线 marker。

历史评价导入不再是「全球只有一个冻结包」。#108 的 `legacy-historical-production-freeze-v2`（522 条）继续钉扎在原入口与原哈希；#111 的 164 条使用新契约 `legacy-issue111-historical-freeze-v1` 与独立入口，不得改写或重放 522 条。

## 冗余入口

维护窗口保留两条等价安全写入路径，避免单一 API 故障卡住导入：

- 任课关系：`POST /api/admin/catalog-relation-additions`（官方候选包）与 `POST /api/admin/import/relations`（同一套只新增预检，可用包或 `pairs`）
- 历史评价：`POST /api/admin/historical-review-imports`（#108）与 `POST /api/admin/historical-review-batch-imports`（#111）

旧式可合并/跳过 CSV `/api/admin/import` 仍永久禁用。`POST /api/catalog-requests` 仍不得用于只补任课关系。

## Considered Options

- **复用目录补充申请批准课程申请**：会 `INSERT` 教师并在课号冲突时改课名，否决。
- **改掉 #108 的 522 常量以塞进 164 条**：会破坏已导入批次的契约钉扎，否决。
- **重新打开旧式 CSV 导入**：可改课/师/删关系，否决。
