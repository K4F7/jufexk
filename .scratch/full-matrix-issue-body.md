## Parent

- 领域词：`CONTEXT.md`（课程锚点、逐行上下文索引、截图质量验收、冻结清单、冻结矩阵编排、评价起始单元格、横向溢出）
- 规格：ADR 0001、ADR 0019、ADR 0020；#254 收口已关
- 全量定位矩阵：#43（`formula-bar-matrix-plan-v1`）
- 现场布局：`legacy-live-layout-v1` SHA-256 `b5dd5305d61fa3b9ab45a98154edbbeefa98fbc3b2a5dde446057e94145e70ff`
- 公式栏矩阵 plan SHA-256 `379f8d7cae7cbfd8bc31bcd336734c4f17bf7479ba113dcb13b8fcd19e4ae18d`
- 三表冒烟：#180（只读）
- 五表冒烟：#227 / #229（只读）
- 缺口补拍：#198 / #199（已关；只读）
- 冻结编排：#220 `legacy-matrix-freeze`
- 审核包：#200 `legacy-review-package`（本票不跑审核）

## 目标

一张票覆盖八张工作表的**全表矩阵现场拍摄**。八路并行：每个 agent 打开一个独立浏览器，等人把腾讯表格只读网址贴进该窗口后再拍自己那一张表。不要整表 14985 重写已进生产的 `record_sha256`。不要把进度写到 #200。

Owner 现场更正（2026-08-19，覆盖旧冻结 last_row）：

- **MOOC 只用到第 20 行**。旧冻结范围 MOOC 8–199（含 G46）作废。本票 MOOC 为 8–20 G–N。不探 G46，不把 G47 当成 G46。
- 其余七表旧冻结 last_row 过大，脚本会继续拍空白格。以现场实表最后一行为准，不得越过：

| 工作表 | owner last_row | 旧冻结 last_row（作废） |
|---|---|---|
| 主要课程 | **478** | 480 |
| 数学课 | **101** | 240 |
| 美育 | **14** | 201 |
| 大英和视听说 | **72** | 203 |
| 思政课 | **62** | 205 |
| 外教 | **7** | 199 |
| 体育课 | **55** | 211 |

越过 last_row 的已拍空白格不算本票范围；不得继续往下拍。

越界空白格已删（`captures.json` 条目、对应 json/jpg、越界 `row-*.context.json`）。范围内格子未动。美育 H14–M14 为空白，不补拍。

## 范围

| 工作表 | 本票矩阵 | 课名 / 教师 | 评价列 | 说明 |
|---|---|---|---|---|
| 主要课程 | 19–**478** | A / E | F–M | 空评价格不截评价图 |
| 数学课 | 8–**101** | B / C | D–J | |
| 美育 | 8–**14** | A / D | E–M | 大量空格，不截评价图 |
| 大英和视听说 | 8–**72** | B / E | H–O | |
| 思政课 | 8–**62** | A / F | G–N | |
| 外教 | 3–**7** | A / E（F=英文名） | G–N | |
| MOOC | **8–20** | B / F | G–N | 表止于 20。禁止探第 46 行 |
| 体育课 | 6–**55** | A / B | D–K | |

列字母只来自已冻现场布局，禁止再猜。

`in_production` 与 `packaged_not_imported`：**禁止重截、禁止改 `record_sha256`**。只拍需要画面的空缺 / 从未进包格，以及同行课名、教师上下文（公式栏双读，不发明教师名）。

## 已定决策

1. 一票八路。每张表一个 headed 浏览器。人把只读网址贴进**该窗口地址栏**。Agent 不得登录、不得改表、不得 `Ctrl+L` / `Ctrl+C` 浏览器地址栏。
2. 页面必须显示「只能查看」。公式栏 `#alloy-simple-text-editor` 须为 `contenteditable=false`。
3. 定位只走地址框 `input.bar-label`（原生 value + Enter）。禁止点网格。同行可 ArrowRight，每步立刻核对活动地址；不是下一列则停、回地址框。换表 / 换行 / 未中必须重新走地址框。
4. 正文权威是公式栏 DOM 双读。格子画面只对照位置和横向溢出。
5. 非空公式栏先按 `scrollHeight` 拉高再拍 `*-formula.jpg`。仍被切短则标 `formula_truncated_dom_authoritative`，DOM 仍是正文。
6. 需要画面的格两张、哈希必须不同：`<地址>-formula.jpg`、`<地址>-cell.jpg`。裁图带宽用 `windowCompositionBands`（formula y=80 h=320；cell 其下到 tab 条）。
7. 空评价格不截评价图。
8. 八路并行时**禁止**调用 `print_window_capture.ps1`：该脚本会把窗口 `SetWindowPos` 到 0,0 的 2560×1440 并抢前台，八路会互踩。本票用 Playwright 页截图；viewport 仍设 2560×1440。实际外框尺寸写入 field-notes。
9. 不写腾讯表格、不写业务库、证据不进 Git。开新目录，不覆盖 #180 / #229 / #198 / #199 / `formula-bar-full-*` / `formula-bar-rebuild-*`。
10. 冻结 CLI：绑现场布局 SHA。MOOC 只声明 8–20。现有 `g46_status=blocked_locator` 门禁会拒冒烟行 8–14 之外的 MOOC；G46 已在表外，15–20 仍要拍。若 CLI 拒 15–20，现场仍拍完 8–20，门禁另改，不得把 15–20 丢掉。
11. 本票不跑 #200。Capture QA `accepted` 且该表有逐行上下文之后，再另开审核 `out_dir`。

## 产物

gitignored：`scripts/legacy_evidence/output/full-matrix-20260819-v1/`

每张表：

- `captures/<表>/field-notes.md`
- `captures/<表>/<地址>-formula.jpg` + `<地址>-cell.jpg`（仅需画面的格）
- `captures/<表>/<地址>.json`（公式栏原文只进此文件，不进 inventory / QA / manifest）
- `captures/<表>/captures.json`
- `status/<表>.json` — `{ "sheet", "status": "waiting_url"|"running"|"done"|"blocked", "last_address", "notes" }`

根目录：`tencent-sheet.json`、`field-notes.md`、manifest / QA（能冻再冻）。

## 人工门

执行前：八个窗口已开。人把腾讯表格只读网址分别贴进八个窗口并回车。Agent 等到 `docs.qq.com` 且看见「只能查看」后再动表。

已知只读文档（人贴，agent 不自动导航、不从浏览器剪贴板抄）：`https://docs.qq.com/sheet/DUFVCWkdsRU5BdEhH`

## 验收

- [ ] 八张表都有独立浏览器会话与 `status/*.json`
- [ ] MOOC 最后一行是 20；未探 G46；未把 G47 当成 G46
- [ ] 定位只走地址框；未点网格
- [ ] 空评价格无评价图；非空格 formula/cell 哈希不同
- [ ] 已进生产 / 已打包未导入的 `record_sha256` 未改
- [ ] 未覆盖受保护包；未写腾讯表格 / 业务库；证据不进 Git
- [ ] 未把本票审核写进 #200

## 非目标

- 不跑 `legacy-review-package`
- 不重冻 #180 / #229 / #43 公式栏全量包
- 不修腾讯表格里的隐藏行
- 不导入生产
