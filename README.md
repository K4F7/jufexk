# 选课志

基于 Hono、Cloudflare Workers、D1 和 Vite 的课程—教师评价站。评价必须绑定课程的具体任课教师，公开内容均需管理员审核。

## 本地开发

```bash
npm ci
npx wrangler d1 migrations apply jufexk --local
npm run dev
```

管理员本地口令放在不提交的 `.dev.vars`：`ADMIN_PASSWORD=...`。站点与学校名称在 `wrangler.jsonc` 的 `SITE_NAME`、`UNIVERSITY_NAME` 中配置，因此复用到其他高校时无需修改源码。

## 生产部署

仓库已经包含真实 D1 `database_id` 和 `xk.sein.moe` Custom Domain 配置。首次部署或轮换口令时，在交互式终端运行：

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler d1 migrations apply jufexk --remote
npm run deploy
```

不要把口令、API Token 或 `.dev.vars` 提交到仓库。

## GitHub Actions

`.github/workflows/deploy.yml` 在 `main` 推送时依次执行类型检查、测试、构建、D1 迁移和 Worker 部署。工作流绑定 `production` Environment；建议在 GitHub 中配置必需审核人。仓库需配置：

- `CLOUDFLARE_API_TOKEN`：具有 Workers Scripts Edit 与 D1 Edit 权限的 API Token。
- `CLOUDFLARE_ACCOUNT_ID`：目标 Cloudflare Account ID。

`ADMIN_PASSWORD` 是 Worker Secret，不由 CI 写入。

CI 不导出含学生投稿的 D1 数据，避免敏感备份进入 GitHub Artifact。重大迁移前应由运维人员在受控终端执行 `wrangler d1 export`，并将备份保存到受限存储。

## Turnstile

投稿端已接入标准 Turnstile widget 与服务端 Siteverify。创建 Widget（域名包含 `xk.sein.moe`、`localhost`、`127.0.0.1`）后：

1. 将公开 Site Key 配置为 `TURNSTILE_SITE_KEY` 普通变量；
2. 交互式执行 `npx wrangler secret put TURNSTILE_SECRET`；
3. 重新部署。

只要 `TURNSTILE_SECRET` 存在，服务端即强制验证；未配置时仍有蜜罐、每 IP 哈希每小时 5 次限制及 30 天重复投稿控制。

## CSV 导入

后台支持符合 CSV 引号规则的逗号、双引号和单元格换行，可分别导入：

- 课程：`code,name,category,department,credits,description`
- 教师：`name,department,title,bio`
- 任课关系：`course_code,course_name,teacher_name,teacher_department`
- 开课班：`course_code,course_name,teacher_name,teacher_department,term,section,campus,schedule,status`

建议顺序为课程、教师、任课关系。学生统一身份认证需要学校提供可信的 SSO/OIDC/CAS 身份源，当前未伪造实现。

## 复用到其他高校

当前 `wrangler.jsonc` 指向 JUFE 的生产 Worker、D1、域名和 Turnstile Widget，不能原样用于其他学校。复用时至少需要：

1. 用 `wrangler d1 create <数据库名>` 创建独立 D1，并替换 `database_name` 与 `database_id`；
2. 修改 Worker `name`、`routes`、`SITE_NAME` 和 `UNIVERSITY_NAME`；
3. 为新域名创建独立 Turnstile Widget，替换 Site Key，并写入对应 Secret；
4. 应用全部迁移，再从后台导入本校课程、教师和开课班；
5. 删除初始迁移产生的两门示例课程和示例教师后再开放投稿。

不同学校不得共用 D1、管理员口令或 Turnstile Secret。

## 腾讯表格历史评价 OCR（试验）

历史文字评价使用独立的 `legacy_reviews` 模型，不写入要求 `overall` 的学生投稿表，也不伪造评分。迁移 `0006_legacy_reviews.sql` 目前只随代码交付；在样本预览经人工确认前，不要应用到远端 D1。

本机建议使用 Python 3.12。Windows 原生环境先以 RapidOCR CPU 验证行列恢复；RTX 50 系只有在 `onnxruntime.get_available_providers()` 明确包含 `CUDAExecutionProvider` 后才增加 `--cuda`。如需稳定使用 PaddleOCR GPU，优先在 WSL2/Linux 容器中运行。

```powershell
uv venv --python 3.12 .venv
uv pip install --python .venv scripts/legacy_ocr/requirements.txt
./scripts/legacy_ocr/export_reference.ps1
# 截图命名示例：主要课程_001.png、主要课程_002.png
.venv/Scripts/python scripts/legacy_ocr/pipeline.py `
  --input scripts/legacy_ocr/input `
  --reference scripts/legacy_ocr/reference.json `
  --out scripts/legacy_ocr/output `
  --max-rows 30
```

输入截图必须是腾讯表格 PNG 原图，并尽量保留表头。程序只读取截图和课程、教师、任课关系、开课班快照；不会连接或写入 D1。输出包括：

- `legacy_reviews_preview.csv`：完整预览和人工确认原因；
- `unmatched_courses.csv`、`unmatched_teachers.csv`：只报告，不自动创建；
- `ambiguous_matches.csv`：保留候选 ID、名称与分数；
- `duplicates.csv`：只标记疑似重复，不删除；
- `ocr_report.json`：模型、置信度、工作表统计、处理时间和错误。

只有课程与教师均唯一匹配、OCR 平均置信度达标、教师已有该课程任课关系，且不存在继承/截断/重复/开课班歧义时，`needs_review` 才可能为 `false`。人工确认时只修改预览副本；批准文件另存为 `legacy_reviews_approved.csv`，后续再由带事务、批次记录和批次回滚的专用导入器写入，默认仍为 `pending`。

### 投稿问卷交互方向

公开投稿将借鉴单题或分段分页、进度条、条件显示以及移动端固定“上一页/下一页”的形式，但不复制参考问卷文案和品牌。建议顺序为：评价对象（课程—开课班—教师）→总体与分类维度→课堂及考核→补充意见→匿名投稿确认。学生身份认证仍暂缓。
