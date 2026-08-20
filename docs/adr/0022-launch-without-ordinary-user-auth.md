# 首发不启用校园 JWT；普通用户登录改为校学生邮箱验证

_2026-08-21：[#324](https://github.com/K4F7/jufexk/issues/324) 把「等到出现有问题的投稿再实现」提前为现在实现。唯一候选仍是校学生邮箱验证；生产投递面为 Resend HTTPS API，不是 louis SMTP。AuthBridge 仍搁置。_

正式上线不接入校园 JWT（AuthBridge），[#169](https://github.com/K4F7/jufexk/issues/169) 的白名单开通搁置。普通用户登录走 `stu.jxufe.edu.cn` 验证信（#325）。投稿写门是否强制登录见 #326。其他认证路线全部不再考虑。

## 邮箱验证的约束

- 允许域只有 `stu.jxufe.edu.cn`，精确匹配，不含 `jxufe.edu.cn` 主域及其他子域；扩域需另行决定。
- 验证信经可配置 HTTPS 投递端点发出（生产为 Resend `https://api.resend.com/emails`）。Worker 不能直连 SMTP:25。
- 真实 `stu.jxufe.edu.cn` 进箱与魔法链接登录验收见人工票 #327；进箱失败则生产路径重议，不改代码去碰校园 JWT。
- ADR-0016 的身份契约照旧：邮箱哈希只作认证身份 `subject`，不当业务主键；`users.id` 稳定匿名；公开只读不要求登录；凭据已验证不等于免 CSRF。

## 与 ADR-0016 的关系

与 [ADR-0016](./0016-school-email-access-identity.md) 冲突——0016 把 AuthBridge 校园 JWT 定为生产认证方，并在 Considered Options 里以「校园 JWT 已由 AuthBridge 签发」为由否决站点自行发验证信。本决策搁置前者，前提失效后重新指定后者为唯一候选。0016 的验签实现、会话与账号生命周期契约保留原样：`CAMPUS_JWT_ENABLED` 不设，`POST /api/auth/callback` 维持 503，代码与占位密钥不删除。

## Consequences

- 生产普通用户会话由校学生邮箱验证签发；认可在持有可写普通用户会话后可用。测试 HMAC 头继续只用于 Vitest。
- 邮箱认证身份的 `provider` 与 AuthBridge 不同，且双方没有可自动关联的信号；按 0016 的规则不猜测合并。生产零普通用户时切换没有迁移成本。

## Considered Options

- **AuthBridge 校园 JWT**：搁置而非否决——白名单开通依赖校方与第三方维护者，且首发没有强认证需求；已完成的实现按 0016 保留待命。
- **自建 CAS client 直连 `ssl.jxufe.edu.cn/cas`**：2026-08-19 实测 `GET /cas/login?service=https://xk.sein.moe/...` 返回「Unauthorized Service Access ... not found in service registry」，学校 CAS 强制 service registry，未注册回调在登录页即被拒；自建代码无法绕过服务端校验，否决。
- **Cloudflare Access OTP**：按席位计费，免费档约 50 人，已在 ADR-0016 否决。
- **让用户提交 CAS/教务口令由站点代验**：钓鱼形态，否决。
- **邀请码、人工材料审核、校园网 IP 判定**：均不能独立证明校内身份，最多作反滥用辅助信号，否决。
