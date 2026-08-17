# 普通用户通过校园 AuthBridge JWT 接入，游客只读

_#137 已否决 Cloudflare Access OTP：Zero Trust 席位不适合全校投稿门。生产认证方改为 [Mine-JUFE/AuthBridge](https://github.com/Mine-JUFE/AuthBridge) 在 CAS 验票后按应用签发的 HS256 JWT。应用尚未进入校方白名单时，callback 保持关闭，不跳转、不请求 AuthBridge。_

_与 `CONTEXT.md`「校内邮箱身份」冲突——第一版校园 JWT 没有邮箱声明；资格来自 CAS / AuthBridge，不是校内邮箱 OTP。词汇表仍保留该条目，待身份源稳定后再改。_

大多数访问者是游客，课程、教师、任课关系和公开评价只读页面匿名可访问。校园 JWT 只在投稿、认可等写操作上构成普通用户会话。管理员后台继续使用独立口令 session，不能与普通用户身份互换。

Worker 必须独立验签 JWT，并把认证方主体映射到站内稳定、不可公开的普通用户身份。AuthBridge `sub`（密文）、学号、管理员会话、IP hash 和既有 `submitter_hash` 都不直接承担任课评价或认可的业务唯一性。

## 游客、普通用户与管理员

- 公开只读不要求登录，也不把未登录当作错误。
- 普通用户会话只证明本次请求持有已验证的校园 JWT（或测试 HMAC 头），并对应一个 `active` 的 `users.id`。
- 管理员口令登录只签发 `admin_sessions`；`jufexk_admin` cookie、校园 JWT 和测试 HMAC 头不得互相授权。

## JWT 验证边界

- AuthBridge 默认算法是 HS256，claims 为 `sub`、`exp`、可选 `aud`/`enc`/`iv`/`tag`。`enc=aes` 时 `sub` 是学号密文，必须先解密再哈希；`enc=ecc` 在未配置解密能力时失败关闭。
- 每次认证走共享 verifier：校验签名、`exp`、可选 `nbf`、配置的 `aud`、非空 `sub`。禁止只解码 payload、接受 `alg=none` 或把任意第三方/自签名 token 当普通用户。
- 验签密钥、AES 密钥和身份摘要密钥缺失时不得降级放行。`CAMPUS_JWT_ENABLED` 未设为 `1` 时，`POST /api/auth/callback` 固定返回 503，不写 cookie。
- 原始 JWT、学号、密文 `sub` 和认证身份不得写入 D1、应用日志、错误响应或分析事件。状态变更仍须同源与 CSRF；JWT 已验证不等于请求不受 CSRF 影响。

## 普通用户与身份绑定

- `users.id` 是随机生成且永久稳定的站内标识。任课评价、认可、封禁和账号状态只引用该标识；公开 API 和页面永不返回它。
- 认证身份以 `(provider, issuer, subject)` 唯一。`provider` 为 `authbridge`，`issuer` 为 JWT `aud`（缺省时为配置的 `CAMPUS_JWT_AUD`，再缺省为 `authbridge`），`subject` 是学号或稳定 `sub` 的 HMAC，不是明文。AuthBridge 当前签发的 JWT 通常没有 `aud` claim。
- 同一认证主体重复登录复用原普通用户。AuthBridge 每次加密会换 IV，因此必须解密后再哈希，不能把密文 `sub` 当主键。
- 站点第一版没有邮箱声明，因此不按邮箱合并账号。多个认证主体默认是不同普通用户。

## 会话、注销与封禁

- 普通用户 CSRF cookie 为 24 小时，`SameSite=Lax`。校园 JWT cookie 若将来由开放的 callback 写入，必须 `HttpOnly`、`Secure`、`SameSite=Lax`。站点不把管理员 `admin_sessions` 复用于普通用户。
- 注销走 `POST /api/user/logout`，清除普通用户 cookie；前端 `/logout` 只是引导页。前端以 `/api/user/session` 为 viewer-state 来源，收到写接口 `401` 后清除本地状态。
- JWT 认证通过后仍查询普通用户状态。`banned`、`pending_deletion` 和 `deleted` 一律拒绝写入。

## 评价、认可与幂等身份

- 第一版每个普通用户对每个任课关系最多有一条当前任课评价，数据库唯一键为 `(user_id, relation_id)`。
- 认可的数据库唯一键为 `(user_id, review_id)`。状态变更携带客户端幂等键，服务端以 `(user_id, operation, idempotency_key)` 保存。
- `user_id`、认证身份、幂等记录和认可者列表只存在于内部边界。公开评价继续匿名。

## 既有匿名数据

- 历史评价永久保持 `user_id = NULL`，不能被后来注册的普通用户认领。
- 普通用户身份上线前的匿名任课评价和 `submitter_hash` 不自动关联账号。

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

预览验证后再打开 `CAMPUS_JWT_ENABLED=1`：

- 浏览器自动 POST `token` 到 callback 后写入 `jufexk_campus_jwt`（`HttpOnly` / `Secure` / `SameSite=Lax`）并 303 回站内
- 错误签名、错误 `aud`、过期、`enc=ecc` 拒绝；注销走 `POST /api/user/logout`
- 公开响应、错误提示与日志不出现 JWT、学号、密文 `sub` 或 `user_id`
- 回滚：去掉 `CAMPUS_JWT_ENABLED`，callback 立即回到 503

真实 Worker + D1 HTTP 测试必须覆盖：未启用 503、启用后写 cookie 建会话、错误签名/`aud`/时效拒绝、响应不泄露身份。

## Considered Options

- **Cloudflare Access OTP + 应用 JWT**：功能能证明邮箱控制权，但每次登录占 Zero Trust 席位，免费档约 50 人，不适合全校投稿门，否决。
- **站点自行发送验证码或魔法链接并签发 JWT**：需要新增邮件投递与撤销体系；校园 JWT 已由 AuthBridge 在 CAS 后签发，否决。
- **把 AuthBridge 密文 `sub` 或学号直接作为业务主键**：密文随 IV 变化，学号也会变更或需要合并，否决。
- **把管理员 session 复用为普通用户**：破坏匿名边界与权限分离，否决。
- **公开只读也强制校园 JWT**：大多数用户只是游客，否决。
