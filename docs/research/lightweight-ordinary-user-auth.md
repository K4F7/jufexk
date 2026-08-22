# 普通用户认证：最轻量的正确路径

研究日期：2026-08-17。结论基于仓库现状、ADR-0016、GitHub Issues、Cloudflare / better-auth 一手文档，以及后续对「全校投稿门 / 自托管邮件」的澄清。外部产品条款可能变更，正式上线前应复核。

**2026-08-22 废止校园 JWT / 标准 CAS：** 生产校园登录只走 jufe_cas 代登（#389 / ADR-0022）。AuthBridge callback 与未注册 service 的标准 CAS 不再作为可开通方案。下文保留为历史研究，不要再按「生产只适配校园 JWT」实现。

**2026-08-17 第三次修订：** 不再做邮箱验证或 Access OTP。生产只适配江财校园 JWT。公开可核对的发行方是 [Mine-JUFE/AuthBridge](https://github.com/Mine-JUFE/AuthBridge)：CAS 验票后按应用签发 JWT（默认 HS256，`token` 经 callback POST 交给应用）。本仓库没有 AuthBridge 源码与验签密钥，因此 `resolveCampusJwt` 只留占位、一律返回 null；测试仍走 HMAC 头。拿到 `iss`/`aud`/密钥后再接线。这与 ADR-0016 的 Access-only 条款冲突，实现验签前须改 ADR。

**2026-08-17 修订：** 初稿建议继续走 Cloudflare Access OTP。随后核对 Zero Trust 免费席位，并确认本站要的是「证明访问者控制本校邮箱、才有投稿资格」，不是团队 ZTNA。项目已有自托管邮件服务器。该邮件方案已被第三次修订否决。

领域用词遵循 `CONTEXT.md`：**普通用户**、**校内邮箱身份**、**认证身份**、**普通用户会话**。不使用「学生账号」。

本文回答四个容易混淆的问题：

1. **#137 按原文是「配 Access」，不是「应用发信」。** Access 自己向允许邮箱发 One-time PIN。但 Access 把每次登录计成 Zero Trust **席位**，免费档约 50 人，不适合全校投稿门。
2. **不需要 better-auth。** 它会再造用户表、长期 session cookie，并要求应用实现 `sendVerificationOTP` / `sendMagicLink`。有自托管邮件时，Worker 只需投递一封验证信并签发短期 JWT。
3. **Workers 不能对 25 端口出站 SMTP。** 自托管邮件必须经 HTTPS API 或本机中继，不能在 Worker 里直连 SMTP。
4. **最轻切片：** 精确匹配 `@jxufe.edu.cn` → 发一次性验证信 → 签发短期 JWT（测试环境保留现有 HMAC 占位）→ 卡住 `POST /api/reviews` 与认可。账号合并、删除 UI、Access、better-auth 都不做。

## 项目现状

- jufexk 是 Hono + Cloudflare Workers + D1 单体应用。普通用户认证契约仍写在 [ADR-0016](../adr/0016-school-email-access-identity.md)：Cloudflare Access OTP + `jxufe.edu.cn` + 应用 JWT；当时否决自建 OTP/魔法链接，依据是「Access 已提供 OTP、域策略和可验证 JWT」。
- 生产 JWT 验证尚未实现。`src/ordinary-user-session.ts` 只在绑定了 `ORDINARY_USER_TEST_AUTH_SECRET` 时接受测试 HMAC 头 `X-Jufexk-Ordinary-User` + `X-Jufexk-Ordinary-User-Mac`，注释写明生产 Access JWT 验证属于 #138。
- `POST /api/reviews`（投稿）**尚未**走 `resolveOrdinaryUser`。当前门是蜜罐、Turnstile、同源 `Origin`、每 IP 哈希限流与 `submitter_hash` 去重（`src/index.ts`）。插入语句不写 `user_id`。
- 认可写路径已经按普通用户身份门控：`PUT/DELETE /api/reviews/:id/endorsement` 调用 `resolveOrdinaryUser`，无用户返回 401，非 `active` 返回 403，并校验同源与 CSRF（`src/review-endorsements.ts`）。`review_endorsements.user_id` 引用站内 `users.id`（`migrations/0015_review_endorsements.sql`）。
- D1 已有最小 `users(id, status, created_at)` 表。`/login` 已挂路由，但 `LoginPage.tsx` 是死胡同文案。
- 工单拆分（#95 已关闭）：
  - [#137](https://github.com/K4F7/jufexk/issues/137) infra：配置 Access OTP + 应用 JWT（`ready-for-human`）
  - [#138](https://github.com/K4F7/jufexk/issues/138) backend：JWT verifier + 用户表 + 账号生命周期（`ready-for-agent`，重）
  - [#139](https://github.com/K4F7/jufexk/issues/139) frontend：登录/会话/账号 UI（`ready-for-agent`）

## 硬性业务需求（轻量投稿门）

1. 只有持有并控制允许域校内邮箱的人才能通过认证。第一批域是 `jxufe.edu.cn`。邮箱域只判断资格，不证明控制权；控制权必须由发到该邮箱的一次性验证完成。
2. 这是**资格门**，不是团队 ZTNA。不得按「每个登录学生占一个付费/免费席位」计费。
3. 站点可以用自托管邮件发验证信；不引入第二套身份平台（better-auth / Auth.js / Lucia）。
4. Worker 必须验证「这次请求持有本站签发的短期凭据」，而不是只看客户端自称的邮箱后缀。
5. 通过认证是投稿（`POST /api/reviews`）以及认可写接口的门；课程、教师、任课关系、公开评价只读继续匿名。
6. 认可已经按 `users.id` 落库。轻量切片至少要有最小稳定映射（已验证邮箱的哈希 → `users.id`），不能把可变的认证方 `sub` 或明文邮箱当业务主键。
7. Vitest 继续使用现有 HMAC 测试头；管理员 cookie、IP hash、`submitter_hash` 不得冒充普通用户。
8. v1 不需要账号合并、多邮箱、删除/恢复 UI。

## 选项比较

| 选项 | 能力与成本 | 对硬性需求的影响 | 判断 |
|---|---|---|---|
| **自托管邮件验证 + 短期 JWT（推荐）** | Worker 精确匹配 `@jxufe.edu.cn`，经邮件服务器 HTTPS API（或本机 SMTP 中继）发一次性链接/验证码；D1 只存 token 哈希与过期时间；通过后签发短期 JWT/签名 cookie，替换测试 HMAC。 | 证明邮箱控制权；不占 Access 席位；公开只读可保持匿名。Worker **不能**直连 SMTP:25，必须走 HTTP 或中继。发件域需能进入校内收件箱（SPF/DKIM/DMARC）。 | **最小正确路径**；与 ADR-0016 冲突，须显式改 ADR 后再实现 |
| Access OTP + 应用 JWT | Access 向允许邮箱发 PIN；policy 用 `Emails ending in`；源站收 `Cf-Access-Jwt-Assertion`。功能上能证明控制权。 | 每次登录占 1 个 Zero Trust 席位；席位用尽后后来者被挡（[Seat management](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/)）。Free 约 50 用户（[SASE architecture](https://developers.cloudflare.com/reference-architecture/architectures/sase/)；[Access 定价](https://www.cloudflare.com/sase/products/access/)）。PAYG 约 $7/用户/月，不适合全校投稿。 | **否决（规模/计费模型错误）**；仅适合预览里几个测试邮箱 |
| better-auth | 自建用户表、cookie session、应用实现 `sendVerificationOTP` / `sendMagicLink`（[Introduction](https://www.better-auth.com/docs/introduction)；[Email OTP](https://www.better-auth.com/docs/plugins/email-otp)；[Magic link](https://www.better-auth.com/docs/plugins/magic-link)）。 | 与「只做投稿门」重复建设；默认长期 session 正是 ADR 否决的形态。有自托管邮件时不需要这套框架。 | **否决** |
| 只检查邮箱字符串后缀 | 请求者可伪造字段。 | 无法证明校内邮箱身份。 | **否决** |

## 明确建议

当前实现只适配校园 JWT（AuthBridge 形状的占位），不发邮件，不配 Access。进校方白名单之前，`POST /api/auth/callback` 保持关闭，Worker 不跳转、不请求 AuthBridge。

**conflicts with ADR-0016 because** ADR 正文要求 Access OTP。免费席位不适合全校投稿门，邮箱方案也已否决。实现验签前须修订 ADR，不要把 Access 或邮件重新当成现行方案。

---

## 为什么 Access 不是资格门

### Access 发 PIN，不是 Worker

[One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)：Cloudflare Access 向 approved email addresses 发 PIN。用户打开 Access 保护的应用 → 输入邮箱 → 若 policy 允许则收信（10 分钟、单次使用）→ 在 Access 页粘贴 PIN。被拒绝的用户收不到信，但页面一律显示 *「A code has been emailed to you」*。发件建议允许 `noreply@notify.cloudflare.com`。

#137 按原文是「在 Zero Trust 里打开 OTP IdP 并配 policy」，不是「给应用接 SMTP」。这一点初稿是对的；错在把它当成全校投稿的生产方案。

### 邮箱域 policy 本身没问题

官方 selector **Emails ending in**（[Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)）能限制 `@jxufe.edu.cn`。只配 `Login Methods = One-time PIN` 而不限制域，会被官方列为误配置（任意能走 OTP 的邮箱都能进）。Worker 对邮箱再做精确匹配（拒子域、Unicode 欺骗域）仍值得做，但这条能力可以由本站自己实现，不必买 Access。

### 席位才是硬墙

[Seat management](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/)：任一 Access 认证（登录应用或 App Launcher）把该身份计为 Active user，占 1 席；席位用尽后，额外用户登录被挡住。用户会一直占席，直到被移除或打开 1–12 个月的 seat expiration。

官方把 Access Free 写成「适合 50 人以下团队或企业 PoC」，并标 **50 user limit**（[Access 定价](https://www.cloudflare.com/sase/products/access/)）。SASE 架构同样写：许多能力可免费、无期限，**最多 50 个用户**（[SASE architecture](https://developers.cloudflare.com/reference-architecture/architectures/sase/)）。PAYG 为 **$7 / 用户 / 月**。

这是给「团队访问内部应用」的计费模型。全校 `@jxufe.edu.cn` 投稿会在第 51 个不同登录邮箱处被挡，或变成按学生人头付费。两者都不符合「确定访问者是否为本校学生、是否有权限投稿」。

### 若仍用 Access，官方最小验证（仅作对照）

[Validating JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)：源站必须验 `Cf-Access-Jwt-Assertion`；JWKS 在 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`。`ctx.access.getIdentity()`（[Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)）不能单独替代验签。AJAX 要 401 需加 `X-Requested-With: XMLHttpRequest`（[Session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)）。这些只在继续用 Access 时有意义。

---

## 自托管邮件：Worker 怎么发信

[TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)：*「By default, Workers cannot create outbound TCP connections on port 25 to send email to SMTP mail servers.」* 连 25 端口会得到 `Connections to port 25 are prohibited`。官方建议改走 Email Workers / Email Service，而不是在 Worker 里自己讲 SMTP。

因此「有自托管邮件服务器」不等于「Worker 直接 SMTP」。接法按轻到重：

| 接法 | 说明 |
|---|---|
| 邮件服务器已有 HTTPS API（Postal / Mailcow / Stalwart 等） | **首选。** Worker `fetch()` 投递，凭证放 Secrets Store。 |
| 邮件机上的 HTTPS→SMTP 中继 | 只有裸 SMTP 时。中继听 443，本机再交 25/587。 |
| Worker `connect()` 打 587/465 | 文档只明确禁 25，不保证 submission 端口稳定可用；要在 Worker 里实现 SMTP 客户端，不轻量。 |
| Cloudflare Email Service `send_email` | 这是 Cloudflare 代发，不是自托管；还要求域名走 Cloudflare DNS（[Send emails](https://developers.cloudflare.com/email-service/get-started/send-emails/)）。 |

校内收件网关常丢陌生发件人。发件域必须有 SPF/DKIM/DMARC，并先用真实 `@jxufe.edu.cn` 测投递。这比鉴权代码更容易卡住。

验证信内容保持不可枚举：无论邮箱是否合格，页面都回「若该邮箱符合条件，我们已发送验证信」。D1 只存 token 哈希、过期时间、规范化后的邮箱摘要；不存明文 OTP、不写完整邮箱到日志。

---

## 最轻推荐切片

1. **修订契约（先于写代码）**  
   修订 ADR-0016：认证方从 Access 改为「本站验证信 + 自托管邮件」；保留「精确域、不枚举、不把邮箱/`sub` 当业务主键、公开只读匿名、CSRF 仍要」。同步改 #137/#138/#139 范围，或关闭 #137（Access 配置）并另开「邮件投递 + 验证 API」工单。

2. **邮件投递**  
   确认自托管邮件的 HTTPS 投递面；没有则加中继。用测试校内邮箱核对进箱，而不是只看 SMTP 已接受。

3. **验证 API + 短期 JWT**  
   `POST /api/auth/email`：规范化邮箱、精确域匹配、写 token 哈希、异步/同步投递。`POST /api/auth/verify`：核销 token，签发短期 JWT 或签名 cookie（HttpOnly、Secure、SameSite=Lax，约 24 小时）。生产 `resolveOrdinaryUser` 改验这枚 JWT；测试仍走 HMAC 头。

4. **最小 `users.id`**  
   首次验证：用带版本密钥的邮箱 HMAC 查找或创建 `users` 行。认可已经按 `users.id` 落库。跳过这步 **conflicts with ADR-0016 because** 评价/认可必须引用稳定普通用户身份。

5. **卡住写接口**  
   `POST /api/reviews`（建议连 `POST /api/catalog-requests`）与现有认可走同一门。保留 Turnstile、同源、CSRF、IP 限流。公开只读不强制登录。

6. **前端最小**  
   `/login` 做成填邮箱 → 提示查收 → 粘贴码或点魔法链接。401 清 viewer state。不做账号删除 UI。

7. **明确不做**  
   Access 应用/席位、better-auth、Lucia、Auth.js、Worker 直连 SMTP:25、只检查邮箱后缀、账号合并/删除、用管理员 session 冒充普通用户。

### 与 ADR-0016 的关系（不静默覆盖）

| 选择 | 是否冲突 |
|---|---|
| 自托管邮件验证 + 短期 JWT | **conflicts with ADR-0016 because** Considered Options 已否决「站点自行发送验证码或魔法链接并签发 JWT」。须先改 ADR |
| 推迟合并 / 多邮箱 / 删除 UI | 不冲突；不是投稿门前置 |
| 最小 `users.id` + 邮箱摘要 | 不冲突；满足「不要用 `sub`/邮箱当业务主键」 |
| 只验 JWT、不映射 `users.id` | **conflicts with ADR-0016 because** 评价/认可必须引用稳定普通用户身份 |
| 认为 JWT 已免 CSRF | **conflicts with ADR-0016 because** 「JWT 已验证不等于请求不受 CSRF 影响」 |
| 继续用 Access 当全校投稿门 | 不与 ADR 字面冲突，但与免费席位和「资格门」目标冲突，否决 |
| 用 better-auth | 不需要；默认长期 session 也与 ADR 否决项重叠 |

---

## 工单映射

| 工单 | 现状 | 修订后投稿门要做 | 可后做 |
|---|---|---|---|
| #137 | `ready-for-human`，按 Access 写 | **应改范围或关闭**：不再配 Access OTP。改成「自托管邮件 HTTPS 投递 + 发件域进箱验证」，或另开 infra 工单 | — |
| #138 | `ready-for-agent`，整包很重 | 验证 API、短期 JWT、测试 HMAC 并存、最小用户映射、投稿/认可走 `resolveOrdinaryUser` | 合并、多邮箱、删除匿名化、独立 session API |
| #139 | `ready-for-agent` | `/login` 填邮箱/验证码或魔法链接、401 清状态 | 账号删除/恢复 UI |
| #95 | 已关闭 | 无实现工作；身份契约若改 Access-only，应新开 spec 或修订 ADR | — |

## 短期行动建议

1. 先改 ADR-0016 / 工单范围，再写代码。不要在 #137 里继续配 Access 当生产投稿门。
2. 确认自托管邮件的 HTTPS API（或中继），并用真实 `@jxufe.edu.cn` 测进箱。
3. 做瘦身后端：验证信 + 短期 JWT + 最小 `users.id` + 投稿/认可门；保留 HMAC 测试。
4. 前端只做登录表单与 401 恢复。删除账号 UI 不动。
5. 不要立项 better-auth，不要在 Worker 里直连 SMTP:25。
6. 任何跳过身份映射或仍按 Access 全文实现的 PR，必须写明与 ADR-0016 的冲突。

## 主要一手来源

- 仓库：`docs/adr/0016-school-email-access-identity.md`；`CONTEXT.md`；`src/ordinary-user-session.ts`；`src/index.ts`（`POST /api/reviews`）；`src/review-endorsements.ts`；`src/pages/LoginPage.tsx`；`migrations/0015_review_endorsements.sql`；Issues #95 / #137 / #138 / #139
- Cloudflare Access / 席位：[OTP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)、[Policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)、[Validating JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[Seat management](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/)、[SASE architecture](https://developers.cloudflare.com/reference-architecture/architectures/sase/)、[Access 定价](https://www.cloudflare.com/sase/products/access/)
- Workers 发信：[TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)、[Send emails](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- better-auth：[Introduction](https://www.better-auth.com/docs/introduction)、[Email OTP](https://www.better-auth.com/docs/plugins/email-otp)、[Magic link](https://www.better-auth.com/docs/plugins/magic-link)
