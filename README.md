# JUFE 选课志

由学生共同编辑的选课信息与课程评价站，运行于 Cloudflare Workers + Static Assets + D1。

## 功能

- 课程、教师搜索与分类浏览
- 专业课：点名、平时分、捞人、课堂质量、知识收获
- 体育课：点名、强度、考核方式、给分
- 匿名投稿、管理员审核、课程维护
- 金山表格导出的 UTF-8 CSV 批量导入

## 本地开发

```bash
npm install
npm run db:local
```

在 `.dev.vars` 中设置 `ADMIN_PASSWORD=本地管理员口令`，然后运行 `npm run dev`。

## Cloudflare 部署

```bash
npx wrangler d1 create jufexk
# 把返回的 database_id 写入 wrangler.jsonc
npx wrangler d1 migrations apply jufexk --remote
npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```

部署后在 Workers Custom Domains 中绑定 `xk.sein.moe`。不要把 Token、密码或 `.dev.vars` 提交到仓库。

## CSV 格式

列名：`code,name,category,department,credits,description`。`category` 为 `major`、`pe` 或 `general`，单次最多 500 行。
