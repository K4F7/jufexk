# 本科培养方案理论课程采集

一次性授权浏览器会话，从教务「主控 > 培养方案 > 理论课程」采集本科当前四个在校年级的全部主修专业课清单。本流程只交付采集包与离线派生物，不导入 D1，不改 `/schedule`。

采集纪律对标 [目录基线采集](./catalog-baseline-acquisition.md)：人工登录后启动；查询串行；检查点可恢复；不保存口令、Cookie、ticket、学号或姓名。

## 范围

- 查询矩阵以页面下拉为准。年级变化后重读院(系)/部与专业。每个「年级 × 院系 × 专业」点检索并保存完整结果。
- 专业方向留空；只采 **主修**。
- 只采理论课程表。不点课程名链接，不进实践环节 / 毕业学分 / 专业课程模块 / 申请替代 / 教学计划表 / 查看培养方案。
- 院系下无专业或检索为空记入覆盖例外，不跳过计数。空结果与失败分开。
- 原始 GBK HTML 与脱敏查询参数只放本机受控目录，不进 Git、不进业务库。

## 操作

1. 在 Chrome / Edge 安装 `scripts/program-plan/userscript/jufexk-program-plan-collector.user.js`（`pnpm run build:program-plan-userscript` 重新打包）。
2. 人工登录 `jwxt.jxufe.edu.cn`，进入「主控 > 培养方案 > 理论课程」。
3. 选择本机采集目录，用「当前年级×专业」验收或「四个年级 × 全部主修专业」全量。
4. 会话失效时重新登录后点「授权并继续」。不要导出 Cookie。
5. 采集完成后运行：

```bash
pnpm run program-plan derive <capture-directory> [--output <derivation-directory>] [--catalog-codes codes.txt]
```

## 采集包

`manifest.json`、`queries.jsonl`、`coverage.json`、`source-dictionary.json`、`snapshots/<query-id>/page-xxxx.html`。schema：`program-plan-capture-package/v1`。清单含字节数、记录数、SHA-256。

覆盖声明列出每个年级×专业的终态：`complete`、`empty`、`exception`。

## 派生物

一行一课，键为 `grade + majorCode + courseCode + suggestedTerm`。同一课号跨多个学年学期保留多行。缺课号的行进入 `exceptions.jsonl`，不丢进 `courses.jsonl`。课程类别路径整段保留，不写入 `courses.enrollment_category`。

可选 `--catalog-codes` 只记录课号是否出现在公开目录；对不上不创建课程。

仓库内脱敏 fixture：`scripts/program-plan/fixtures/software-engineering-2025.html`（软件工程 2025 级主修理论课程页，含学期 rowspan、`[课号]课名`、公共课/专业教育课路径）。
