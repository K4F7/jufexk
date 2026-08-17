# 校内邮箱身份通过 Cloudflare Access JWT 接入普通用户

普通用户采用 Cloudflare Access 的 One-time PIN（OTP）登录：Access 先验证邮箱控制权并按允许的校内邮箱域放行，再向站点签发应用 JWT。Worker 必须独立验证 JWT，并把认证方身份映射到站内稳定、不可公开的普通用户身份；邮箱、Access `sub`、管理员会话、IP hash 和既有 `submitter_hash` 都不直接承担任课评价或认可的业务唯一性。

## 邮箱资格与登录

- 第一批允许的邮箱域是 `jxufe.edu.cn`。Access policy 使用 `Emails ending in: @jxufe.edu.cn`，并且只允许 One-time PIN 登录；学校将来确认其他邮箱域后，须作为独立精确域加入允许列表。
- Worker 对 JWT 中规范化后的邮箱域再次做精确匹配。规范化只包括去除首尾空白、将域转为小写，并要求恰好一个合法的本地部分和域；`sub.jxufe.edu.cn`、相似 Unicode 域和仅以字符串结尾碰巧匹配的域默认不合格。
- 邮箱域只判断资格，不证明邮箱控制权。只有 Access 完成 OTP 或未来经单独批准、能够提供同等已验证邮箱声明的学校身份源后，邮箱身份才成立。
- 站点不接收、发送或存储 OTP。登录失败页面使用不可枚举的统一反馈，不向请求者确认某个邮箱是否存在或是否在允许列表中。
- Access application 只覆盖登录入口、普通用户身份接口和需要登录的写接口；课程、教师、任课关系和公开评价的只读页面继续匿名可访问。

## JWT 验证边界

- 生产浏览器会话使用 Access 签发的应用 JWT。Worker 从 Cloudflare 转发的 `Cf-Access-Jwt-Assertion` 读取凭据；`CF_Authorization` cookie 由 Access 管理，应用代码不自行签发第二套 JWT，也不接受任意第三方或自签名 Bearer token。
- 每次认证必须通过一个共享 verifier 完成 RS256 签名验证，并从 `<team-domain>/cdn-cgi/access/certs` 按 `kid` 选择公钥；禁止只解码 payload、接受 `alg=none`、接受对称算法或把 JWT header 中的任意 URL 当作密钥来源。
- verifier 精确校验配置的 Access team domain `iss`、应用 AUD `aud`、`type=app`、`exp`、`nbf`、`iat`、非空 `sub` 和非空 `email`。缺少邮箱的 service token 不构成普通用户身份。
- 公钥可以有界缓存；遇到未知 `kid` 时只刷新一次 JWKS，仍无法验证则失败关闭。Access team domain 与 AUD 是部署配置，邮箱 hash 密钥来自 Cloudflare Secrets Store；任何一项缺失都不得降级放行。
- 原始 JWT、OTP、完整邮箱和 Access identity 响应不得写入 D1、应用日志、错误响应或分析事件。状态变更请求仍须通过同源与 CSRF 校验；JWT 已验证不等于请求不受 CSRF 影响。

## 普通用户与身份绑定

- `users.id` 是随机生成且永久稳定的站内标识。任课评价、认可、封禁和账号状态只引用该标识；公开 API 和页面永不返回它。
- 认证身份以 `(provider, issuer, subject)` 唯一，邮箱身份以带版本密钥的 `HMAC-SHA-256(canonical_email)` 唯一。D1 只保存邮箱摘要、精确邮箱域、验证时间和状态，不保存完整邮箱；摘要密钥支持当前与上一个版本双读、命中后迁移，以便轮换。
- Access `sub` 在同一 Zero Trust 账户中通常对应一个邮箱，但用户从 Access 移除后重新加入可能得到新 `sub`。因此登录先匹配认证身份，未命中时再匹配邮箱摘要；匹配已有邮箱身份时把新的 Access 主体绑定到原普通用户，而不是新建业务身份。
- 同一自然人的多个邮箱默认是不同普通用户，因为本站没有可靠的自然人主键。只有用户在现有登录状态下再次完成另一个允许邮箱的认证，或经受限且有审计记录的人工恢复流程，才允许把多个邮箱身份绑定到同一普通用户。
- 邮箱变更走“验证新邮箱、绑定到原普通用户、撤销旧邮箱身份”的顺序。不得按姓名、学号猜测、相似邮箱本地部分或人工口头说明自动合并。
- 合并两个已存在普通用户时选定一个存续 `users.id` 并在单个事务中迁移引用。重复认可折叠为一条；同一任课关系上的两条任课评价不得自动丢弃或拼接，必须由用户选择保留项或进入人工处理后才能完成合并。

## 会话、注销与封禁

- Access application/policy session 第一版设为 24 小时；会话到期后由 Access 重新检查邮箱策略。应用域 `CF_Authorization` cookie 必须启用 `HttpOnly`、`Secure` 和 `SameSite=Lax`。站点不持有 refresh token，不用 localStorage 保存认证凭据，也不把管理员 `admin_sessions` 复用于普通用户。
- 注销跳转到应用域的 `/cdn-cgi/access/logout`，清除当前应用 cookie；“退出所有 Access 应用”可以另外跳转 team domain 的同名路径。前端收到普通用户接口的 `401` 后清除本地 viewer state，并引导重新登录。
- Access JWT 认证通过后，Worker 仍查询普通用户状态。`banned`、`pending_deletion` 和 `deleted` 状态一律拒绝写入，因此封禁和删除不依赖等待 JWT 过期；严重事件可以同时使用 Access 的 per-user revoke。
- Access 签名密钥轮换由 JWKS `kid` 自动承接；邮箱摘要密钥按版本轮换。站点不得通过延长 token 生命周期或缓存验证结果越过 `exp`、封禁状态或身份撤销状态。

## 评价、认可与幂等身份

- 总体评分和补充说明属于同一条任课评价。第一版每个普通用户对每个任课关系最多有一条当前任课评价，数据库唯一键为 `(user_id, relation_id)`；再次提交是对同一评价的修订并重新进入适用的审核流程，不生成第二份评分。
- 认可的数据库唯一键为 `(user_id, review_id)`。建立和撤回都必须幂等，且继续遵守认可只适用于已批准、当前、含补充说明的任课评价这一领域边界。
- 状态变更请求携带由客户端生成的随机 idempotency key。服务端以 `(user_id, operation, idempotency_key)` 唯一保存请求摘要和结果；相同 key 与相同请求返回原结果，相同 key 与不同请求返回冲突。任课评价和认可的数据库唯一约束仍是并发下的最终不变量。
- `user_id`、邮箱摘要、认证身份、幂等记录和认可者列表只存在于内部边界。公开评价继续匿名，只公开已有契约允许的内容与聚合认可数。

## 既有匿名数据

- 历史评价永久保持 `user_id = NULL`，不能被后来注册的普通用户认领，不参与“每用户每任课关系一条”的唯一性，也继续不具备认可资格。
- 在普通用户身份上线前产生的匿名任课评价和 `submitter_hash` 同样不自动关联账号。`submitter_hash`、IP hash 和管理员 session 不能转换为普通用户身份；新旧数据可以在同一公开文字评价流中匿名共存。

## 滥用、保留与账号删除

- 反滥用同时使用普通用户状态、每用户限流和既有短期 IP hash 限流。管理员默认只看审核所需内容与普通用户状态，不查看邮箱摘要或认证主体；身份恢复与封禁审计授予更小的独立权限。
- 认证成功/失败的应用审计记录最多保留 90 天，且只记录普通用户标识、结果、时间和必要的风险字段；不记录 JWT 或完整邮箱。幂等响应记录保留至少 30 天，之后可以只依赖领域唯一约束。
- 用户发起账号删除后立即进入 `pending_deletion`、停止全部写入并删除认可，提供 30 天恢复期。恢复期结束后删除认证身份、邮箱摘要和未公开内容；已批准任课评价默认保留为不可认领的匿名内容并清除 `user_id`，用户在删除前可以单独请求删除这些内容。
- 普通删除不保留可重新识别邮箱的资料。因滥用被封禁的账号可以保留带独立密钥的邮箱封禁摘要和最小审计证据，期限等于明确的封禁期；永久封禁须有人工决定和理由，不得借“账号删除”规避封禁。

## 实施门槛

下游实现必须先以真实 Worker + D1 HTTP 测试覆盖：允许和非允许邮箱域、错误 `iss`/`aud`/签名/时效、未知 `kid` 刷新、service token 拒绝、Access `sub` 变化后复用用户、封禁即时生效、注销、邮箱密钥轮换、账号合并冲突、删除匿名化、CSRF，以及公开响应不泄露任何身份字段。Cloudflare Access 资源应先在预览 hostname 或受限测试邮箱上验证登录、拒绝、会话到期和回滚，再启用生产写接口。

官方实现依据：[Access application JWT 与身份 claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)、[JWT 验证与 JWKS](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) 以及 [邮箱域 policy 与 session 管理](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/)。

## Considered Options

- **站点自行发送验证码或魔法链接并签发 JWT**：需要新增邮件投递、验证码防滥用、签名密钥、refresh token 和撤销体系；Cloudflare Access 已提供 OTP、域策略和可验证应用 JWT，第一版否决自建。
- **只检查邮箱字符串后缀**：无法证明请求者控制该邮箱，且容易把解析错误当作资格，否决。
- **把 Access `sub` 或邮箱摘要直接作为业务主键**：`sub` 在移除重建后可能变化，邮箱也会变更或需要多邮箱合并，会破坏评价与认可的稳定引用，否决。
- **把 JWT 换成站内长期 session cookie**：会重复建设 Access 已提供的会话生命周期和撤销面；第一版直接使用短期 Access JWT，并以 D1 用户状态补足站内封禁与删除授权，否决。
