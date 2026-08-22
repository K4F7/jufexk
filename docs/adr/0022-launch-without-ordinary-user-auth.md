# 生产普通用户主登录改为江财 CAS 代登；邮箱验证降为备选

_2026-08-22：[#389](https://github.com/K4F7/jufexk/issues/389) 把生产主登录改为 jufe_cas 协议代登江财 CAS。校学生邮箱验证保留为次要入口。AuthBridge 仍搁置。口令代验从「否决」改为有约束的采纳。_

_2026-08-21：[#324](https://github.com/K4F7/jufexk/issues/324) 曾把「等到出现有问题的投稿再实现」提前为实现校学生邮箱验证。该路径仍保留，但不再是唯一候选。_

正式上线不接入校园 JWT（AuthBridge），[#169](https://github.com/K4F7/jufexk/issues/169) 的白名单开通搁置。普通用户主登录走江财 CAS 代登（#389）；`stu.jxufe.edu.cn` 验证信仍可用。投稿写门是否强制登录见 #326。标准 CAS 跳转（未注册 service）与 AuthBridge 开通仍不作为现行路径。

## CAS 代登的约束

- 协议对照 [SeRazon/jufe_cas](https://github.com/SeRazon/jufe_cas)：Worker 代打 `https://ssl.jxufe.edu.cn/cas/login`，`service` 只用已注册的 `http://ehall.jxufe.edu.cn` 作为口令探针。
- 禁止跟随 302 去 ehall，禁止用 ST / `CASTGC` 拉教务或持久化 TGT。
- 口令、`CASTGC`、`JSESSIONID`、MFA `gid` 不得进日志、公开响应或长期表。MFA 两步中间态只存 AES-GCM 密文，TTL 约 5 分钟。
- 出站只允许 `ssl.jxufe.edu.cn` 以及 host 以 `.jxufe.edu.cn` 结尾的 attest。
- 成功后认证身份为 `provider=cas`，`issuer=ssl.jxufe.edu.cn`，`subject=HMAC(规范化学号)`。学号不当业务主键。不与 email / authbridge 自动合并。
- 图形验证码失败关闭。本版不做 OCR。
- 标准 CAS（`service=https://xk.sein.moe/...`）仍走不通：2026-08-19 实测未注册 service 会在登录页被拒。

## 邮箱验证的约束

- 允许域只有 `stu.jxufe.edu.cn`，精确匹配，不含 `jxufe.edu.cn` 主域及其他子域；扩域需另行决定。
- 验证信经可配置 HTTPS 投递端点发出（生产为 Resend `https://api.resend.com/emails`）。Worker 不能直连 SMTP:25。
- 真实 `stu.jxufe.edu.cn` 进箱与魔法链接登录验收见人工票 #327。
- ADR-0016 的身份契约照旧：邮箱哈希只作认证身份 `subject`，不当业务主键；`users.id` 稳定匿名；公开只读不要求登录；凭据已验证不等于免 CSRF。

## 与 ADR-0016 的关系

与 [ADR-0016](./0016-school-email-access-identity.md) 的「AuthBridge 为生产认证方」冲突——本决策继续搁置 AuthBridge，并把生产主登录改为 CAS 代登，邮箱验证降为备选。0016 的验签实现、会话与账号生命周期契约保留原样：`CAMPUS_JWT_ENABLED` 不设，`POST /api/auth/callback` 维持 503，代码与占位密钥不删除。

## Consequences

- 生产普通用户会话主要由 CAS 代登签发；邮箱验证与测试 HMAC 头仍可签发同一形状的 `jufexk_user_session`。认可在持有可写普通用户会话后可用。
- CAS、邮箱、AuthBridge 三种认证身份的 `provider` 不同，且没有可自动关联的信号；按 0016 的规则不猜测合并。

## Considered Options

- **jufe_cas 协议代登（采纳，有约束）**：本站收集学号/口令/MFA，Worker 代打学校 CAS。形态接近钓鱼，因此必须失败关闭图形验证码、禁止持久化 TGT、禁止跟 ehall ticket、密文短 TTL 中间态，并保留邮箱次要入口。
- **AuthBridge 校园 JWT**：搁置而非否决——白名单开通依赖校方与第三方维护者；已完成的实现按 0016 保留待命。
- **自建标准 CAS client（`service=` 本站回调）**：2026-08-19 实测 `GET /cas/login?service=https://xk.sein.moe/...` 返回「Unauthorized Service Access ... not found in service registry」，学校 CAS 强制 service registry，未注册回调在登录页即被拒；否决。
- **Cloudflare Access OTP**：按席位计费，免费档约 50 人，已在 ADR-0016 否决。
- **邀请码、人工材料审核、校园网 IP 判定**：均不能独立证明校内身份，最多作反滥用辅助信号，否决。
