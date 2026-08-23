# 普通用户通过校学生邮箱验证接入，游客只读

_2026-08-24：#460 为“我的任课评价被认可”通知新增 `reviews.author_user_id` 内部作者关联；公开评价仍匿名，公开 API 永不返回该字段或认可者身份。进入 `pending_deletion` 不删除任课评价或作者关联；将来若实现最终删除，须在 finalize 前匿名化作者关联。_

_2026-08-22：生产校园登录只走江财 CAS 代登（#389）。标准 CAS 与 AuthBridge 废弃：`CAMPUS_JWT_ENABLED` 不能再打开 callback，`POST /api/auth/callback` 与 `GET /api/auth/campus` 固定关闭。校学生邮箱验证仍是非 CAS 次要入口。本文的身份三元组、`users.id`、CSRF、封禁/待删除形状与管理员隔离继续有效。_

_2026-08-21：生产登录路径曾改为 `stu.jxufe.edu.cn` 校学生邮箱验证（#324 / #325）。验证信经可配置 HTTPS 投递端点发出（生产为 Resend）；Worker 不直连 SMTP:25。该路径现为备选。_

_2026-08-19：AuthBridge 开通已按 [ADR-0022](./0022-launch-without-ordinary-user-auth.md) 关闭；现已废弃而不是搁置。_

_#137 已否决 Cloudflare Access OTP：Zero Trust 席位不适合全校投稿门。校园 JWT（[Mine-JUFE/AuthBridge](https://github.com/Mine-JUFE/AuthBridge)）不再作为登录路径。_

大多数访问者是游客，课程、教师、任课关系和公开评价只读页面匿名可访问。江财 CAS 代登、校学生邮箱验证或测试 HMAC 头只在投稿、认可等写操作上构成普通用户会话。管理员后台继续使用独立口令 session，不能与普通用户身份互换。

Worker 必须核销 CAS 代登成功或校学生邮箱挑战（或测试 HMAC 头），并把认证主体映射到站内稳定、不可公开的普通用户身份。AuthBridge JWT 不再作为登录方案。明文邮箱、AuthBridge `sub`（密文）、学号、管理员会话、IP hash 和既有 `submitter_hash` 都不直接承担任课评价或认可的业务唯一性。

## 游客、普通用户与管理员

- 公开只读不要求登录，也不把未登录当作错误。
- 普通用户会话只证明本次请求持有已验证的本站会话 cookie（CAS 代登或校学生邮箱；或测试 HMAC 头），并对应一个 `active` 的 `users.id`。
- 管理员口令登录只签发 `admin_sessions`；`jufexk_admin` cookie、校园 JWT 和测试 HMAC 头不得互相授权。

## JWT 验证边界

- AuthBridge 默认算法是 HS256，claims 为 `sub`、`exp`、可选 `aud`/`enc`/`iv`/`tag`。`enc=aes` 时 `sub` 是学号密文，必须先解密再哈希；`enc=ecc` 在未配置解密能力时失败关闭。
- 每次认证走共享 verifier：校验签名、`exp`、可选 `nbf`、配置的 `aud`、非空 `sub`。禁止只解码 payload、接受 `alg=none` 或把任意第三方/自签名 token 当普通用户。
- 验签密钥、AES 密钥和身份摘要密钥缺失时不得降级放行。`POST /api/auth/callback` 固定返回 503，不写 cookie；`CAMPUS_JWT_ENABLED` 不再能打开该路径。
- 原始 JWT、学号、密文 `sub` 和认证身份不得写入 D1、应用日志、错误响应或分析事件。状态变更仍须同源与 CSRF；JWT 已验证不等于请求不受 CSRF 影响。

## 普通用户与身份绑定

- `users.id` 是随机生成且永久稳定的站内标识。任课评价、认可、封禁和账号状态只引用该标识；公开 API 和页面永不返回它。
- 认证身份以 `(provider, issuer, subject)` 唯一。生产 CAS 代登：`provider` 为 `cas`，`issuer` 为 `ssl.jxufe.edu.cn`，`subject` 是规范化学号的 HMAC（密钥为 `CAMPUS_IDENTITY_SECRET`），不是学号明文。邮箱登录：`provider` 为 `email`，`issuer` 为 `stu.jxufe.edu.cn`，`subject` 是规范化邮箱的 HMAC。已废弃的 AuthBridge 身份若仍出现在库里，不与 CAS / 邮箱自动合并。
- 同一认证主体重复登录复用原普通用户。邮箱按规范化地址哈希；AuthBridge 每次加密会换 IV，因此必须解密后再哈希，不能把密文 `sub` 当主键。
- 明文邮箱不当主键，不进公开响应或日志。多个认证主体默认是不同普通用户。

## 会话、注销与封禁

- 普通用户 CSRF cookie 为 24 小时，`SameSite=Lax`。CAS / 邮箱登录会话 cookie（`jufexk_user_session`）由本站签发，`HttpOnly`、`Secure`、`SameSite=Lax`，寿命约 24 小时。站点不把管理员 `admin_sessions` 复用于普通用户。
- `resolveOrdinaryUser` 解析顺序：测试 HMAC 头（仅当测试密钥已绑定）→ 本站 CAS/邮箱会话 cookie。AuthBridge JWT cookie 与 Bearer 不再认证。
- 注销走 `POST /api/user/logout`，清除普通用户 cookie；前端 `/logout` 只是引导页。前端以 `/api/user/session` 为 viewer-state 来源，收到写接口 `401` 后清除本地状态。可写用户注销仍要 CSRF；`pending_deletion` 等不可写用户仍可注销。
- JWT 认证通过后仍查询普通用户状态。`banned`、`pending_deletion` 和 `deleted` 一律拒绝写入。
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
- #460 起，新任课评价以内部 `author_user_id` 关联普通用户，用于个人数据与认可通知；既有评价不回填，继续保持 `author_user_id = NULL`。公开评价仍匿名，`submitter_hash` 与作者关联均不下发。进入恢复期时保留任课评价及作者关联；未来 finalize 前必须匿名化作者关联。
- 本版不提供合并 API，也不按邮箱或学号猜测合并。多个认证主体默认是不同普通用户。将来若出现第二身份信号，合并只遵循这些冲突规则：存续普通用户（只保留一个 `users.id`，被合并方的认证身份迁到存续用户）；认证身份迁移与认可折叠必须在同一事务完成；两边对同一评价都有认可时折叠为一条；同一任课关系上已有两条任课评价时，不得自动丢弃或拼接。
- 封禁摘要、删号后再注册对抗与永久封禁专用流程另议。管理员 cookie 不能调用普通用户删除或恢复。

## 实施门槛

开通 AuthBridge 登录前按此检查。依据：[AuthBridge README](https://github.com/Mine-JUFE/AuthBridge/blob/main/README.md) 与 [demo-backend](https://github.com/Mine-JUFE/AuthBridge/blob/main/demo-backend/app.js)。

代码与密钥占位可以先合入；`POST /api/auth/callback` 在 `CAMPUS_JWT_ENABLED` 未设为 `1` 时维持 503、不写 cookie。不要用「密钥已绑定」当作产品开关。

校方 / AuthBridge 确认：

- `appid` 与 `app_aud`（JWT 默认不带 `aud` claim；`CAMPUS_JWT_AUD` 仍作为身份 `issuer` 回退）
- callback 白名单含 `https://xk.sein.moe/api/auth/callback`（不要带死 query）
- `encrypt_type`：AuthBridge 默认 `aes`。`enc=ecc` 在本站未实现解密前失败关闭
- `jwt_expires_in`：会话长度等于 JWT `exp`（cookie `maxAge` 跟随 `exp`）
- AuthBridge 基址（占位 `https://mc.jxufe.edu.cn/authbridge`）

Secrets Store：

- `CAMPUS_JWT_SECRET`、`CAMPUS_JWT_AES_KEY`、`CAMPUS_IDENTITY_SECRET` 已绑定。现值为开通前占位，上线前换成校方应用密钥
- AuthBridge `jwt_key` 若为偶数位 hex，按原始字节做 HS256，不要按 UTF-8 字符串验签
- 占位或真实值都不得提交进仓库或日志

AuthBridge 已废弃，不要再打开 `CAMPUS_JWT_ENABLED=1`。`POST /api/auth/callback` 即使该变量存在也返回 503。

## Considered Options

- **Cloudflare Access OTP + 应用 JWT**：功能能证明邮箱控制权，但每次登录占 Zero Trust 席位，免费档约 50 人，不适合全校投稿门，否决。
- **站点自行发送验证码或魔法链接并签发短期会话 cookie**：现为次要登录路径。校园登录只走 CAS 代登；投递走 HTTPS API（生产为 Resend），不在 Worker 里讲 SMTP。
- **把 AuthBridge 密文 `sub` 或学号直接作为业务主键**：密文随 IV 变化，学号也会变更或需要合并，否决。
- **把管理员 session 复用为普通用户**：破坏匿名边界与权限分离，否决。
- **公开只读也强制校园 JWT**：大多数用户只是游客，否决。
- **30 天后自动 finalize / 清掉认证身份**：登录仍是占位，本版不能悄悄删除身份；`restoreUntil` 只作文案，否决。
- **本版提供账号合并 API**：第一版校园 JWT 没有邮箱声明，不能把两个学号当成同一个人；合并只先记下冲突规则，否决。
