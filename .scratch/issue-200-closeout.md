## 收口：从未进生产的评价起始格已由后续冻结包审完

本票不再单独续跑 `#199` 的 `review-never-packaged-20260818-v1`。该目录是冒烟剩余三表的未完成尝试，格图仍落在 `formula-bar-full-20260729-v1`，且未吃进全表冻结。后续 `#311` 冻了八表全表矩阵（QA=`accepted`），`#316` 按表独立 `out_dir` 跑完 OCR + A/B + 仲裁 + 图文核验；未批准 / unresolved 交给 `#318` 人审，终态批准包为 v5。`#316` 明确不写本票、不覆盖本目录。

对照 `production-gap-inventory-v1` 里 `partition=never_packaged` 且公式栏非空的评价起始格：

- 有课名/教师上下文、且落在已冻范围内的键，均出现在 `#316` 各路 `package.json`
- `in_production` / `packaged_not_imported` 未进 A/B
- 未把尚未 `accepted` 的 capture 键混进包
- 本机 OCR：`det/cls/rec` 均为 `CUDAExecutionProvider`（RapidOCR 3.9.1 CUDA）；未回退 CPU
- 自动批准只来自 ADR-0020 图文核验（修订了开票时「approved 恒为 false」）
- 未写腾讯表格 / 业务库 / 生产导入

### 绑定

- 缺口清单 `#197` inventory SHA-256：`86cfa237d58c8ad8f4554e96a1a8c4bfc968c66494c502d8c7f4faaccbc4162c`
- 公式栏矩阵 plan SHA-256：`379f8d7cae7cbfd8bc31bcd336734c4f17bf7479ba113dcb13b8fcd19e4ae18d`
- 全表冻结 manifest SHA-256：`790f167190441dd0d2d6ebd67102b1ee1df5e26542fa9556958529bf7d60ae31`
- Capture QA：`accepted`（`qa_sha256` `465a0ff312548fe70b9c2c6f7aa70d2cd04fed5c2e9fdaa42bf2f8931c09322f`）
- live layout SHA-256：`b5dd5305d61fa3b9ab45a98154edbbeefa98fbc3b2a5dde446057e94145e70ff`

### `#316` 八路审核包 SHA-256（`package.json` 文件）

| 工作表 | 状态 | 路内 approved / routed | package SHA-256 |
|---|---|---|---|
| 主要课程 | completed_with_exceptions | 61 / 61 | `8bc9ea9643f3ae9547d0f59c7a68852b7c93a3d42d6e34a3986e0e480d5efca2` |
| 数学课 | empty / 无评价可审 | 0 / 0 | （无 package） |
| 美育 | completed_with_exceptions | 0 / 1 | `b1046c1d9c99cf3492154bfab0fbd0e9694c97b524357fd7b28510cfb4e03f38` |
| 大英和视听说 | completed_with_exceptions | 162 / 174 | `185b0516172df3245a93daa875c0d322e8283269eab0ad487e5c15f57e0ed7da` |
| 思政课 | completed_with_exceptions | 146 / 148 | `9b47f9d7c85ffffc94d493d23945c3bf21850d7052bfb1b983778469eca4238d` |
| 外教 | completed | 14 / 14 | `c234f7d8d1b5b77ace348678bdeb4c211bed07381df0f530be349650c727b2e6` |
| MOOC | completed | 15 / 15 | `6be5ce2f260ad9d9939b885d3d01ee7fc13b08b6e524ced30a48a209367e5b78` |
| 体育课 | completed_with_exceptions | 138 / 138 | `4880d30b2ab0345475e0315c65a20ff12afc97dbcbec032772a5e7c97648f679` |

目录：`scripts/legacy_evidence/output/full-matrix-ocr-20260819-v1/<工作表>/package.json`

`#229` other-smoke 独立审核包 SHA-256：`dd112ab044f5f387e50fab8edb6ebcece942cb1456b96556bd3db91147efebc2`（缺逐行上下文的 10 格已由全表上下文覆盖，未猜教师名）。

路内自动批准合计 536。仲裁未决 / 核验未过的格进 `#318` 人审；v5 批准包 `undecided_cells=0`（`manifest.json` SHA-256 `81566854cb1b4a0d13507364552ae3152fc30929ca01065523f97ad1b8f18034`）。

### 明确不在本票范围

- MOOC 第 20 行之后（含 `46|G–N`）：`#311` 不探 G46，冻结范围外
- `数学课|32|D`：全表冻结公式栏为空，无正文可审
- 未覆盖 `#180` 冒烟目录、`review-never-packaged-*`、`review-other-smoke-*`

不要续跑 `scripts/legacy_evidence/output/review-never-packaged-20260818-v1/`。人工批准包与生产注入见 `#318` / `#334`。
