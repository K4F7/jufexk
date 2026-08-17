# Issue 111 交接：61 对任课关系候选导入

给接手的 agent：所有者已批准把下面这个候选包推进正式目录补充，再单独冻结并导入对应历史评价。本文件不含评价正文。

## 权威输入（本机绝对路径，勿提交仓库）

候选包：

`D:\19016\Documents\Workload\jufexk-production-inputs\issue111-relation-addition-v1`

| 文件 | 用途 |
|---|---|
| `manifest.json` | 契约 `legacy-issue111-relation-addition-v1`，状态 `package_ready_for_owner_review` |
| `VERIFY.json` | 61 对已核验：课存在、师存在、关系缺失，`failures=0` |
| `catalog-addition-requests.jsonl` | 61 条 `request_kind=relation` |
| `reviews.jsonl` | 164 条可在关系入目录后冻结导入；含已批准正文，勿提交 Git |
| `owner-review.md` | 课号/教师/评价数表 |

工作副本（同一内容）：

`C:\Users\sern\.grok\worktrees\workload-jufexk\issue116\.local-data\issue111\packages\relation-addition-v1`

隔离交接（不要导入）：

`C:\Users\sern\.grok\worktrees\workload-jufexk\issue116\.local-data\issue111\packages\keep-isolated\HANDOFF-v3.md`

无课名弃用（不要导入）：

`C:\Users\sern\.grok\worktrees\workload-jufexk\issue116\.local-data\issue111\packages\abandoned-no-course`

## 绑定哈希

- v2 目录 content SHA-256：`1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588`
- v2 manifest SHA-256：`c26d125dc56dfadf93638d2f94241c2ed6dd8c844f16e06262ae890798bd1070`
- v2 artifact SHA-256：`aab562b8ff5cbe8159128769749616f6285fa0b8a9fab9bb6a49d6e70e72504a`
- 历史批准包 manifest SHA-256：`edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af`
- 首批冻结包仍是 522 条；本批不得改写或重放 #108

生产目录当前计数必须保持为课程 `3740`、教师 `1951`。任课关系在写入这 61 条之后应为 `11482 + 61 = 11543`。

## 419 条终态（所有者已裁定）

| 分区 | 关系 | 评价 | 导入 |
|---|---:|---:|---|
| 确认候选（本包） | 61 | 164 | 关系入目录后另做新冻结包再导入 |
| 保持隔离 | 76 | 241 | 否 |
| 无课名弃用 | 3 | 14 | 否，明确排除 |

人工包裁定：会计信息系统×杨小毛隔离（声明行是社会学通论×杨小毛，不改绑）；投资银行学×朱少华、投资银行学×蓝青、中外礼仪×李文明因无课名弃用。

## 必须按这个顺序做

1. **只补任课关系。** 课程和教师身份已在 v2。禁止 `POST /api/catalog-requests`（那会新建课程/教师身份）。禁止猜映射。
2. **预检。** 再读 `VERIFY.json`，确认 61 对仍全部是「课在、师在、关系不在」。任一失败立刻停。
3. **维护窗口写入 61 条 `course_teachers`。** 只新增，不改课、不改师、不删旧关系。写入前后课程/教师计数不变。
4. **新冻结包。** 官方关系进入目录之后，才能用这 164 条生成独立冻结包。不要复用 `frozen-historical-production-v2` 的 522 条 artifact，也不要把 241/14 条混进去。
5. **导入 164 条历史评价。** 另一次维护窗口；幂等复核目标是本批 `existing=164`（或与当时生产已有 522 并存的合计，按当时线上实数核，不得覆盖 522）。
6. **公开验收。** 只展示匿名文字评价；不写来源、作者、评分。

## 禁止

- 不导入隔离桶和弃用桶
- 不把截图上看到的另一对身份写进目录
- 不修改稳定 `review_id` 或已批准正文
- 不把评价正文、截图、OCR 原文提交到 Git 或 issue 评论
- 不在未获维护窗口授权时写生产

## 发现缺陷时

停下来另开缺陷 issue。#111 是受控生产操作；不要顺手改导入契约。
