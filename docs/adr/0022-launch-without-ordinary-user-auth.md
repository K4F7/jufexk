# 生产普通用户主登录只用江财 CAS 代登

_2026-08-24：#483 从 Worker 配置淘汰 AuthBridge / 校园 JWT / 邮件投递变量（`AUTHBRIDGE_BASE_URL`、`CAMPUS_APP_ID`、`CAMPUS_JWT_AUD`、`CAMPUS_JWT_SECRET`、`CAMPUS_JWT_AES_KEY`、`MAIL_*`）。登录页只保留 CAS 代登；邮箱验证代码仍可用测试夹具，生产不再绑定投递端点。_

_2026-08-22：[#389](https://github.com/K4F7/jufexk/issues/389) 把生产校园登录定为 [SeRazon/jufe_cas](https://github.com/SeRazon/jufe_cas) 协议代登。标准 CAS 跳转与 AuthBridge 校园 JWT 全部废弃，不再作为可开通路径。校学生邮箱验证仍是非 CAS 次要入口。_

_2026-08-21：[#324](https://github.com/K4F7/jufexk/issues/324) 曾把「等到出现有问题的投稿再实现」提前为实现校学生邮箱验证。该路径仍保留，但不再是校园统一身份方案。_

普通用户校园登录只走江财 CAS 代登（#389）。`stu.jxufe.edu.cn` 验证信仍可用。投稿写门是否强制登录见 #326。

## CAS 代登的约束

- 协议对照 [SeRazon/jufe_cas](https://github.com/SeRazon/jufe_cas)：Worker 代打 `https://ssl.jxufe.edu.cn/cas/login`，`service` 只用已注册的 `http://ehall.jxufe.edu.cn` 作为口令探针。
- 禁止跟随 302 去 ehall，禁止用 ST / `CASTGC` 拉教务或持久化 TGT。MFA 核销后同域 `reAuthCheck` 302 视为口令探针成功，不跟进。未完成 MFA 时 `reAuthCheck` 不得签发本站会话。
- 口令、`CASTGC`、`JSESSIONID`、MFA `gid` 不得进日志、公开响应或长期表。MFA 两步中间态只存 AES-GCM 密文，TTL 约 5 分钟。
- 出站只允许 `ssl.jxufe.edu.cn` 以及 host 以 `.jxufe.edu.cn` 结尾的 attest。
- 成功后认证身份为 `provider=cas`，`issuer=ssl.jxufe.edu.cn`，`subject=HMAC(规范化学号)`。学号不当业务主键。不与 email / 已废弃的 authbridge 自动合并。
- 图形验证码失败关闭。本版不做 OCR。
- 学校 CAS 对失败口令可能回 200 登录页而不是 401；客户端把「仍停在登录页」当作口令失败。
- MFA 核销后先用已有 `execution` / `mfaState` POST；成功则不再 `detect`、不再下载 169KB 登录页。成功会话直接用登录接口返回值，不再额外打 `/api/user/session`。Worker 使用 Smart Placement，出站贴近学校 CAS。

## 邮箱验证的约束

- 允许域只有 `stu.jxufe.edu.cn`，精确匹配，不含 `jxufe.edu.cn` 主域及其他子域；扩域需另行决定。
- 验证信经可配置 HTTPS 投递端点发出（生产为 Resend `https://api.resend.com/emails`）。Worker 不能直连 SMTP:25。
- 真实 `stu.jxufe.edu.cn` 进箱与魔法链接登录验收见人工票 #327。
- ADR-0016 的身份契约照旧：邮箱哈希只作认证身份 `subject`，不当业务主键；`users.id` 稳定匿名；公开只读不要求登录；凭据已验证不等于免 CSRF。

## 与 ADR-0016 的关系

与 [ADR-0016](./0016-school-email-access-identity.md) 原先「AuthBridge 为生产认证方」冲突——本决策废弃 AuthBridge 与标准 CAS，校园统一身份只认 jufe_cas 代登。0016 的会话与账号生命周期契约仍有效。`CAMPUS_JWT_ENABLED` 不再能打开 callback：`POST /api/auth/callback` 与 `GET /api/auth/campus` 固定关闭。

## Consequences

- 生产普通用户校园会话由 CAS 代登签发；邮箱验证与测试 HMAC 头仍可签发同一形状的 `jufexk_user_session`。认可在持有可写普通用户会话后可用。
- CAS 与邮箱认证身份的 `provider` 不同，且没有可自动关联的信号；按 0016 的规则不猜测合并。

## Considered Options

- **jufe_cas 协议代登（采纳，唯一校园 CAS 方案）**：本站收集学号/口令/MFA，Worker 代打学校 CAS。形态接近钓鱼，因此必须失败关闭图形验证码、禁止持久化 TGT、禁止跟 ehall ticket、密文短 TTL 中间态，并保留邮箱次要入口。
- **AuthBridge 校园 JWT**：废弃。不再用 `CAMPUS_JWT_ENABLED` 开通；callback 固定 503。
- **自建标准 CAS client（`service=` 本站回调）**：废弃。2026-08-19 / 2026-08-22 实测 `GET /cas/login?service=https://xk.sein.moe/...` 返回「Unauthorized Service Access ... not found in service registry」。
- **Cloudflare Access OTP**：按席位计费，免费档约 50 人，已在 ADR-0016 否决。
- **邀请码、人工材料审核、校园网 IP 判定**：均不能独立证明校内身份，最多作反滥用辅助信号，否决。
