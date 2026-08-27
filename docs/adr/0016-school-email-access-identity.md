# 普通用户通过校学生邮箱验证接入，游客只读

_2026-08-26：[#612](https://github.com/K4F7/jufexk/issues/612) 学长学姐保留号 `#000000` 与普通用户共用公开主页关注与统计。仍不回填历史 / 旧评 / 上线前匿名评价的作者。保留号写入一行不可登录的 `users` 占位（稳定 `id`，`public_code` 仍不分配 0 以免改 CHECK），只作关注目标；公开 API 仍不返回 `users.id`、邮箱或学号。_

_2026-08-24：[#493](https://github.com/K4F7/jufexk/issues/493) 增加公开编号。每个普通用户在首次创建时顺序分配 `users.public_code`（从 1 起，展示为 `匿名用户#000001`），并可在五张官方 HeroUI 头像中选择 `avatar_key`。公开 API 与页面只下发公开编号，永不返回 `users.id`、邮箱或学号。整数 0 / `匿名用户#000000` 保留给 `author_user_id IS NULL` 的历史、旧评与上线前匿名任课评价，不回填作者。_

_2026-08-24：#500 再次从 Worker 解绑 `MAIL_*` 与 `REVIEW_AUTHOR_LOOKUP_TO`。#478 曾为点评作者查询把这些变量绑回，但 Secrets Store 没有对应条目，阻塞 `main` 部署。_

_2026-08-26：[#654](https://github.com/K4F7/jufexk/issues/654) 删除已废弃的校园 JWT 运行时代码、回调/状态路由、前端探测与专属测试。生产校园登录只保留 CAS 代登；历史身份表结构保持不变且不猜测合并。_

_2026-08-24：#480 退役共享 `ADMIN_PASSWORD`。管理员改为手动绑定校园统一身份学号（HMAC 与 CAS `auth_identities.subject` 相同）；已绑定用户校园登录后签发独立 `admin_sessions`。明文学号不落库。口令登录、Cloudflare Secrets Store 中的 `ADMIN_PASSWORD` 不再授权管理分区。_

_2026-08-24：#460 为“我的任课评价被认可”通知新增 `reviews.author_user_id` 内部作者关联；公开评价仍匿名，公开 API 永不返回该字段或认可者身份。进入 `pending_deletion` 不删除任课评价或作者关联；将来若实现最终删除，须在 finalize 前匿名化作者关联。_

_2026-08-24：[#459](https://github.com/K4F7/jufexk/issues/459) 的私有个人主页复用 `author_user_id` 查询新任课评价，并让目录补充申请的随附评价继承提交者。只关联上线后的新写入；既有评价与申请保持 `author_user_id = NULL`，不按 `submitter_hash` 认领。个人主页仅返回当前 active 普通用户自己的数据，响应不下发 `users.id`。_

_2026-08-22：生产校园登录只走江财 CAS 代登（#389）。校学生邮箱验证仍是非 CAS 次要入口。本文的身份三元组、`users.id`、CSRF、封禁/待删除形状与管理员隔离继续有效。_

_2026-08-21：生产登录路径曾改为 `stu.jxufe.edu.cn` 校学生邮箱验证（#324 / #325）。验证信经可配置 HTTPS 投递端点发出（生产为 Resend）；Worker 不直连 SMTP:25。该路径现为备选。_

_#137 已否决 Cloudflare Access OTP：Zero Trust 席位不适合全校投稿门。_

大多数访问者是游客，课程、教师、任课关系和公开评价只读页面匿名可访问。江财 CAS 代登、校学生邮箱验证或测试 HMAC 头只在投稿、认可等写操作上构成普通用户会话。管理员后台使用独立 `admin_sessions`，不能与普通用户身份互换。

Worker 必须核销 CAS 代登成功或校学生邮箱挑战（或测试 HMAC 头），并把认证主体映射到站内稳定、不可公开的普通用户身份。明文邮箱、学号、管理员会话、IP hash 和既有 `submitter_hash` 都不直接承担任课评价或认可的业务唯一性。

## 游客、普通用户与管理员

- 公开只读不要求登录，也不把未登录当作错误。
- 普通用户会话只证明本次请求持有已验证的本站会话 cookie（CAS 代登或校学生邮箱；或测试 HMAC 头），并对应一个 `active` 的 `users.id`。
- 管理员不再使用共享口令。已绑定 CAS 学号的普通用户访问 `/api/admin/*` 时可获签发 `admin_sessions`；`jufexk_admin` cookie 仍不得调用普通用户删除或恢复，测试 HMAC 头不得单独成为管理员。

## 普通用户凭据边界

- 生产只接受本站签发的 `jufexk_user_session`；测试 HMAC 头只在测试密钥已绑定时有效。任意 Bearer、未知 cookie、管理员 cookie、IP hash 与 `submitter_hash` 都不得认证普通用户。
- 会话校验必须验证版本、站内用户、过期时间与 HMAC；身份摘要密钥缺失时不得降级放行。
- 原始口令、学号、邮箱与认证 subject 不得写入应用日志、公开响应或分析事件。状态变更仍须同源与 CSRF；持有会话不等于请求免除 CSRF。

## 普通用户与身份绑定

- `users.id` 是随机生成且永久稳定的站内标识。任课评价、认可、封禁和账号状态只引用该标识；公开 API 和页面永不返回它。对外识别作者只使用公开编号（`users.public_code`，展示为 `匿名用户#xxxxxx`）。
- 公开编号按首次登录顺序递增，从 1 起。`0` 只作为学长学姐保留号展示，不写入可登录普通用户的 `public_code`。既有用户按 `created_at`、`id` 回填。头像只允许五张官方 HeroUI 占位图。
- 认证身份以 `(provider, issuer, subject)` 唯一。生产 CAS 代登：`provider` 为 `cas`，`issuer` 为 `ssl.jxufe.edu.cn`，`subject` 是规范化学号的 HMAC（密钥为 `CAMPUS_IDENTITY_SECRET`），不是学号明文。邮箱登录：`provider` 为 `email`，`issuer` 为 `stu.jxufe.edu.cn`，`subject` 是规范化邮箱的 HMAC。历史 provider 行保持原样，不与 CAS / 邮箱自动合并。
- 同一认证主体重复登录复用原普通用户。邮箱按规范化地址哈希。
- 明文邮箱不当主键，不进公开响应或日志。多个认证主体默认是不同普通用户。

## 会话、注销与封禁

- 普通用户 CSRF cookie 为 24 小时，`SameSite=Lax`。CAS / 邮箱登录会话 cookie（`jufexk_user_session`）由本站签发，`HttpOnly`、`Secure`、`SameSite=Lax`，寿命约 24 小时。站点不把管理员 `admin_sessions` 复用于普通用户。
- `resolveOrdinaryUser` 解析顺序：测试 HMAC 头（仅当测试密钥已绑定）→ 本站 CAS/邮箱会话 cookie。任意 Bearer 与未知 cookie 不认证。
- 注销走 `POST /api/user/logout`，清除普通用户 cookie；前端在当前页用 AlertDialog 二次确认后再调用，不再提供独立 `/logout` 页。前端以 `/api/user/session` 为 viewer-state 来源，收到写接口 `401` 后清除本地状态。可写用户注销仍要 CSRF；`pending_deletion` 等不可写用户仍可注销。
- 会话认证通过后仍查询普通用户状态。`banned`、`pending_deletion` 和 `deleted` 一律拒绝写入。
- `GET /api/user/session` 对 `pending_deletion` 且凭证仍能解析到该普通用户时返回 `authenticated: false`、`accountStatus: "pending_deletion"`、`restoreUntil`（`pending_deletion_at + 30` 天的 ISO-8601）和 CSRF；不因探测 session 而恢复账号。游客、`banned`、`deleted` 保持游客形状，不增加 `accountStatus`。

## 评价、认可与幂等身份

- 第一版每个普通用户对每个任课关系最多有一条当前任课评价，数据库唯一键为 `(user_id, relation_id)`。
- 认可的数据库唯一键为 `(user_id, review_id)`。状态变更携带客户端幂等键，服务端以 `(user_id, operation, idempotency_key)` 保存。
- `user_id`、认证身份、幂等记录和认可者列表只存在于内部边界。公开评价继续匿名。

## 既有匿名数据

- 历史评价永久保持 `user_id = NULL`，不能被后来注册的普通用户认领。
- 普通用户身份上线前的匿名任课评价和 `submitter_hash` 不自动关联账号。

## 滥用、保留与账号删除

- `active` 普通用户可在同源与 CSRF 下 `POST /api/user/deletion`，请求体 `confirm` 必须为 `DELETE`。成功后立刻进入 `pending_deletion`，写入 `pending_deletion_at`，停止全部写入，并删除该 `user_id` 下全部认可。已是 `pending_deletion` 或不可写时不得重入、不得改写 `pending_deletion_at`。
- 恢复期 session 形状见上一节。响应与公开接口不得出现 `user_id`、认证身份或学号。
- `POST /api/user/deletion/restore` 仅当解析到的普通用户当前为 `pending_deletion`，且必须同源与 CSRF。成功后回到 `active` 并清空 `pending_deletion_at`，不重建认可。对 `active` / `banned` / `deleted` / 游客返回冲突或未登录，不改状态。
- 文案恢复期为 30 天，`restoreUntil` 只供前端说明。本版不 finalize：不加到期清理任务，不删除认证身份，不把账号标为 `deleted`。过了 30 天仍可恢复。`deleted` 只用于写拒绝测试或未来 finalize。
- #459 / #460 起，新任课评价以内部 `author_user_id` 关联普通用户，用于个人数据与认可通知；既有评价不回填，继续保持 `author_user_id = NULL`。公开评价仍匿名，`submitter_hash` 与作者关联均不下发。进入恢复期时保留任课评价及作者关联，账号恢复后个人主页数据继续可见；未来 finalize 前必须匿名化作者关联。
- 本版不提供合并 API，也不按邮箱或学号猜测合并。多个认证主体默认是不同普通用户。将来若出现第二身份信号，合并只遵循这些冲突规则：存续普通用户（只保留一个 `users.id`，被合并方的认证身份迁到存续用户）；认证身份迁移与认可折叠必须在同一事务完成；两边对同一评价都有认可时折叠为一条；同一任课关系上已有两条任课评价时，不得自动丢弃或拼接。
- 封禁摘要、删号后再注册对抗与永久封禁专用流程另议。管理员 cookie 不能调用普通用户删除或恢复。

## 运行时边界

- `CAMPUS_IDENTITY_SECRET` 仍用于 CAS 学号与邮箱身份摘要以及本站会话签名，不是产品开关。
- 生产不提供第三方校园 JWT 状态或回调 API；校园登录入口只有 CAS 代登。
- 历史 `auth_identities` 行与编号迁移保留，不删除、不改写、不与现行 CAS / 邮箱身份自动合并。

## Considered Options

- **Cloudflare Access OTP + 应用 JWT**：功能能证明邮箱控制权，但每次登录占 Zero Trust 席位，免费档约 50 人，不适合全校投稿门，否决。
- **站点自行发送验证码或魔法链接并签发短期会话 cookie**：现为次要登录路径。校园登录只走 CAS 代登；投递走 HTTPS API（生产为 Resend），不在 Worker 里讲 SMTP。
- **把第三方认证 subject 或学号直接作为业务主键**：认证 subject 与学号都可能变化或需要合并，否决。
- **把管理员 session 复用为普通用户**：破坏匿名边界与权限分离，否决。
- **公开只读也强制登录**：大多数用户只是游客，否决。
- **30 天后自动 finalize / 清掉认证身份**：登录仍是占位，本版不能悄悄删除身份；`restoreUntil` 只作文案，否决。
- **本版提供账号合并 API**：没有可靠信号能把两个认证主体判定为同一个人；合并只先记下冲突规则，否决。
