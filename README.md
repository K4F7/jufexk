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

本机建议使用 Python 3.12。CPU 环境安装 `requirements.txt`；RTX 50 系 Windows 环境安装 `requirements-gpu.txt`，其中 PyTorch CUDA 12.8 用于向 ONNX Runtime 预加载 CUDA/cuDNN DLL。脚本在 `--cuda` 模式下会检查检测、方向分类和文字识别三个会话的首 provider，任何一个不是 `CUDAExecutionProvider` 都直接失败，禁止静默回退 CPU。

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

GPU 安装与运行：

```powershell
uv pip install --python .venv -r scripts/legacy_ocr/requirements-gpu.txt
.venv/Scripts/python scripts/legacy_ocr/pipeline.py `
  --input scripts/legacy_ocr/input `
  --reference scripts/legacy_ocr/reference.json `
  --out scripts/legacy_ocr/output `
  --max-rows 30 `
  --cuda
```

RTX 5060 Ti 实测环境为 PyTorch 2.11.0+cu128、ONNX Runtime GPU 1.23.2、RapidOCR 3.9.1。51 张截图全量预览使用约 4.6GB 显存，GPU 负责 OCR 推理，OpenCV/img2table 的网格恢复和 CSV 汇总仍主要使用 CPU，因此 CPU 占用较高属于正常现象。

输入截图必须是腾讯表格 PNG 原图，并尽量保留表头。程序只读取截图和课程、教师、任课关系、开课班快照；不会连接或写入 D1。输出包括：

- `legacy_reviews_preview.csv`：完整预览和人工确认原因；
- `unmatched_courses.csv`、`unmatched_teachers.csv`：只报告，不自动创建；
- `ambiguous_matches.csv`：保留候选 ID、名称与分数；
- `duplicates.csv`：只标记疑似重复，不删除；
- `teacher_candidates_review.csv`、`course_candidates_review.csv`：实体原文聚合清单，形态初筛不等于批准；
- `relation_candidates_review.csv`：只依据结构化课程/教师列生成的任课关系候选，不从评价正文猜教师；
- `teacher_catalog_review_queue.csv`、`course_catalog_review_queue.csv`、`relation_catalog_review_queue.csv`：决策栏全空的基础目录人工确认队列；
- `ocr_report.json`：模型、置信度、工作表统计、处理时间和错误。

只有课程与教师均唯一匹配、OCR 平均置信度达标、教师已有该课程任课关系，且不存在继承/截断/重复/开课班歧义时，`needs_review` 才可能为 `false`。人工确认时只修改预览副本；批准文件另存为 `legacy_reviews_approved.csv`，后续再由带事务、批次记录和批次回滚的专用导入器写入，默认仍为 `pending`。

全量 OCR 后可通过 `--ocr-cache scripts/legacy_ocr/output/raw_ocr_tokens.jsonl` 复用 token 调整结构恢复，不会再次占用 GPU。实体候选聚合命令为：

```powershell
.venv/Scripts/python scripts/legacy_ocr/aggregate_candidates.py `
  --preview scripts/legacy_ocr/output/legacy_reviews_preview.csv `
  --out scripts/legacy_ocr/output
```

人工确认必须经过显式队列，不能直接把预览文件当成批准文件：

```powershell
.venv/Scripts/python scripts/legacy_ocr/approval.py prepare `
  --preview scripts/legacy_ocr/output/legacy_reviews_preview.csv `
  --out scripts/legacy_ocr/output/legacy_reviews_review_queue.csv

.venv/Scripts/python scripts/legacy_ocr/approval.py finalize `
  --queue scripts/legacy_ocr/output/legacy_reviews_review_queue.csv `
  --reference scripts/legacy_ocr/reference.json `
  --approved scripts/legacy_ocr/output/legacy_reviews_approved.csv `
  --errors scripts/legacy_ocr/output/approval_errors.csv `
  --payload-dir scripts/legacy_ocr/output/import_payloads
```

审核人员逐行填写 `decision=approve|reject|skip`、现有课程/教师 ID 和 `review_note`；疑似重复但仍保留时还要填写 `duplicate_action=keep`。存在任意批准错误时不会生成批准文件。校验包括对象存在性、课程—教师关系、开课班归属、原始 OCR 证据和重复确认，输出字段不包含 `overall`。

基础目录队列与评价批准队列相互独立。先人工确认教师和课程，使用后台两阶段 CSV 预览/导入；随后重新导出 D1 快照，再确认任课关系。导入 `relations` 现在只写 `course_teachers`，不会虚构空学期或“导入默认班”；开课班必须通过 `offerings` 类型单独提供明确数据。

每个生成的 JSON payload 最多 40 条，并包含内容哈希幂等键，以兼容 D1 免费计划每次 Worker 调用的查询额度并避免重复提交。先提交到管理员接口 `/api/admin/legacy-imports/preview`，再提交 `/api/admin/legacy-imports`。D1 `batch()` 保证单个导入批次原子写入，记录默认 `pending`；`POST /api/admin/legacy-imports/:id/rollback` 可原子删除该批次记录并保留回滚审计状态。不要在未审核前调用导入接口。

管理员后台的“历史评价”标签已封装上述流程：选择批准 JSON 后只执行预览，服务端校验全部通过才显示“确认导入为待审核”；同一页面列出批次及待审/通过/驳回数量，并仅允许回滚仍为 `imported` 的批次。批次列表不返回 manifest、OCR 原文或 token，避免在列表接口暴露大段历史内容。

导入后的每条历史记录仍需在该页面逐条通过或驳回，驳回必须填写理由，并记录不可重复的审核事件。批次中一旦有记录完成审核，整批就禁止回滚，以免删除已公开内容和审核证据。只有 `approved` 的历史记录会在课程页和教师页的“历史文字资料”区块展示；该区块没有 `overall`，不参与任何评分、评价数量或排序统计。

### 投稿问卷交互方向

公开投稿将借鉴单题或分段分页、进度条、条件显示以及移动端固定“上一页/下一页”的形式，但不复制参考问卷文案和品牌。建议顺序为：评价对象（课程—开课班—教师）→总体与分类维度→课堂及考核→补充意见→匿名投稿确认。学生身份认证仍暂缓。
