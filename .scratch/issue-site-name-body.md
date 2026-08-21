## 问题描述

产品公开站点名从「江财选课参考」改为「JUFE评课社区」。页头、浏览器标题、分享卡片、登录验证信发件名必须一致。仓库代号 `jufexk`、领域词「选课志」、测试夹具里的 mock `siteName` 不改。

## 位置

- `wrangler.jsonc` 的 `SITE_NAME`、`MAIL_FROM`
- `index.html` 的 `<title>` / `og:title`
- 前端兜底：`src/App.tsx`、`src/components/AppShell.tsx`、`src/prototype/ShellNavVariants.tsx`、`src/prototype/PrototypeGalleryPage.tsx`
- 邮件兜底：`src/email-login.ts`、`vitest.config.ts` 的 `MAIL_FROM`
- 文档：`README.md`、`docs/ui/foundations.md`
- 断言：`test/site-icon.test.ts`

## 建议

所有用户可见的「江财选课参考」改成「JUFE评课社区」。`SITE_NAME` 仍由 `wrangler.jsonc` 提供；兜底字符串与配置保持一致。不要改 `UNIVERSITY_NAME`、Worker 名、路由或认证 audience。

## 验收

- `/api/config` 返回的 `siteName` 为 `JUFE评课社区`
- 页头品牌、文档标题、og:title、登录验证信主题/发件名都用新名
- 配置缺失时的兜底也是新名
- 仓库 README 图标 alt 与站内名称一致
