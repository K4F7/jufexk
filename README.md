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
