## 人审收口与批准包 v5

#316 八路现已全部 empty。此前 v1 未混入思政、且后续独立图文核验补跑后队列收缩。终态不覆盖 v1/v4，也不覆盖 #316 `out_dir`。

### 队列

- v3 剩余未批准格 **95**（`human-queue-20260820-v3/`）
- 其中 35 格冻结构图不足以审，已 live 地址框重截：`human-queue-20260820-v3-live-recapture/`（新证据版本）
- 人审决定后合并：通过 94，驳回 1，跳过 0，未决 0

### 所有者映射裁定

- `大英和视听说|10|N`：课名改为 **英语口语**（正文仍是公式栏「实用英语口语…」），教师张晓花
- `大英和视听说|56|J`：**删除**（公式栏「同2」）
- `主要课程|173|*`：教师 **孙爱琳** / 货币银行学
- `主要课程|180|*`：教师 **缪丽** / 跨文化商务沟通

### 批准包

`scripts/legacy_evidence/output/review-approved-20260820-v5/`

- 契约 `legacy-review-approved-package-v1`
- 自动批准 536 + 人审通过 94 = evaluations **630**
- courses 55 / teachers 148 / course_teachers 155
- excluded 1：`大英和视听说|56|J`
- `evaluations.jsonl` SHA-256 `27ba8bff846bb74b77728ccf23075a193385c9d01157c77fea785d4ee04bdfae`
- `wrote_tencent_or_business_db: false`

分表：大英 195、思政 178、体育 155、主要 72、MOOC 15、外教 14、美育 1。数学课本轮无 `never_packaged`。

本票不导入生产。下一步：新开生产候选冻结包 / 注入预检票，不得重放已导入的 522 / 164 / 64。
