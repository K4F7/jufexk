## 生产候选冻结包与只读预检

输入只认 v5（evaluations SHA-256 `27ba8bff846bb74b77728ccf23075a193385c9d01157c77fea785d4ee04bdfae`，630 格）。新目录未覆盖冻结矩阵、#316 `out_dir`、v5 批准包、或已导入的 522 / 164 / 120 / 12 / 64。

候选包：`D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v1`

- 契约 `legacy-v5-historical-freeze-v1`
- manifest SHA-256 `f5f2548e6edae09ea5c5d5ff3dfd40cebfcf5fa3b1c77d7604a20f374a4e5b5c`
- 已绑定可导入 **46**
- 待补任课 **6** 对 / **25** 格（append-only，未写入）
- 排除 **559**（含 1 条已导入重放、空教师、课名/教师映射不上）
- 所有者裁定保留：`10|N` 课名仍为英语口语（目录无唯一课号，故排除不猜测）；第 173 行孙爱琳、第 180 行缪丽已绑定；`56|J` 未入库
- `wrote_tencent_or_business_db: false`，未执行 `--apply`

### 只读预检（退出码 2，零写入）

现场目录：课程 **3740**、教师 **1951**、任课关系 **11572**
公开历史评价：**882**
marker：课程/教师/任课 **3740 / 1951 / 11482**，content SHA-256 `1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588`（与基线一致）
与 marker 差异：课程 0、教师 0、任课现场 11572 vs marker 11482（基线后只新增关系，符合 ADR 0017）

工具：`pnpm run historical-import:v5`。`--apply` 在本票明确授权前会拒绝。PR #335。
