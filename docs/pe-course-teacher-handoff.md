# 体育课名 × 老师交接

给接手的 agent：所有者已按课名 × 老师、体育一师一课裁定这 10 对 / 64 条历史体育评价，并已写入生产。本文件不含评价正文。领域决策见 [ADR-0018](./adr/0018-pe-course-name-teacher-binding.md)；只新增任课关系见 [ADR-0017](./adr/0017-append-only-official-relation-additions.md)。

本批是 #111 之后的独立后续。当时待补 5 条任课；2026-08-17 已写入 5 条任课关系与 64 条历史评价。不得改写或重放 #108 的 522 条，也不得重放 #111 的 164 / 120 / 12 条，或本批这 64 条。

## 权威输入（本机绝对路径，勿提交仓库）

工作区整理目录：

`D:\19016\Documents\Workload\jufexk\.local-data\course-x-teacher`

| 路径 | 用途 |
|---|---|
| `working/pe-course-teacher-v1/` | 完整工作包：`pairs.jsonl`、隔离空桶、生产候选 |
| `working/pe-course-teacher-v1/production-candidates/` | 10 对 / 64 条候选；当时 5 条待补任课 |
| `working/production-inputs-snapshot/` | `jufexk-production-inputs\issue111-pe-course-teacher-v1` 的副本 |
| `imported-already/` | #111 已写入生产的对照包，不要重放 |
| `excluded/` | 无课名 / 配不成 / 未闭合，不要导入 |

生产输入原件：

`D:\19016\Documents\Workload\jufexk-production-inputs\issue111-pe-course-teacher-v1`

| 文件 | 用途 |
|---|---|
| `VERIFY.json` | 写入前核验：课存在、师存在；当时 5 对关系缺失、5 对已有，`failures=0` |
| `catalog-addition-requests.jsonl` | 当时 5 条 `request_kind=relation` |
| `relations.jsonl` | 10 对绑定与裁定说明 |
| `reviews.jsonl` | 64 条已批准正文，勿提交 Git |
| `owner-review.md` | 课名 × 老师 / 课号 / 评价数表 |
| `PRODUCTION-STATUS.md` | 已写入：`3740 / 1951 / 11572 / 882` |

`apply-pe-course-teacher.mjs` 是当时维护窗口用的本机脚本，不是本仓库默认入口。不要再对生产执行。

## 绑定哈希

- v2 目录 content SHA-256：`1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588`
- v2 artifact SHA-256：`aab562b8ff5cbe8159128769749616f6285fa0b8a9fab9bb6a49d6e70e72504a`
- 历史批准包 manifest SHA-256：`edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af`
- 目录基线 marker 的任课关系计数仍是基线值 `11482`；现场任课关系在写入后为 `11572`

## 10 对终态（所有者已裁定，已写入）

| 可见课名 × 可见教师名 | 目录教师 | 课号 | 评价 | 任课 |
|---|---|---|---:|---|
| 健美操 × 陈军 | 陈军2 | 1005002192 | 6 | 已补 |
| 健美操 × 刘璇 | 刘璇 | 1005002192 | 6 | 原已有 |
| 健美操 × 熊健萍 | 熊建萍 | 1005002192 | 4 | 已补 |
| 网球 × 杜立群 | 杜立群 | 1005002272 | 5 | 原已有 |
| 网球 × 瞿长雄 / 夏老师 | 夏长建 | 1005002272 | 5 | 原已有 |
| 击剑 × 吴超群 | 吴超群 | 1005002536 | 8 | 原已有 |
| 击剑 × 徐贞 | 徐贞 | 1005002536 | 7 | 已补 |
| 击剑 × 马荣华 | 马荣华 | 1005002536 | 8 | 已补 |
| 排球 × 黄琼华 | 黄琼华 | 1005002652 | 7 | 已补 |
| 羽毛球 × 程荣辉 | 程荣辉 | 1005001892 | 8 | 原已有 |

重审要点：陈军落到体育老师陈军2（陈军1 是法学）；熊健萍落到目录熊建萍；表上瞿长雄与「夏老师」落到目录夏长建，不新建教师。

## 禁止

- 不按体育1 / 体育2 建课或分组
- 不用可见课名新建课程
- 不把重名老师绑到非体育身份
- 不把表上姓名直接写成新的来源教师身份
- 不导入 `excluded/`，不重放已写入批次
- 不修改稳定 `review_id` 或已批准正文
- 不把评价正文、截图、OCR 原文提交到 Git 或 issue 评论
- 不在未获维护窗口授权时写生产
