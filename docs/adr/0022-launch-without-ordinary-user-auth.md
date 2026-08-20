# 首发不启用普通用户认证；届时若需要，唯一候选是校学生邮箱验证

正式上线不接入校园 JWT（AuthBridge），[#169](https://github.com/K4F7/jufexk/issues/169) 的白名单开通搁置。投稿门维持现有匿名反滥用：蜜罐、Turnstile、同源 `Origin`、每 IP 哈希限流与 `submitter_hash` 去重（`src/index.ts` 的 `POST /api/reviews`）。只有当公开上线后出现有问题的投稿时，才重新评估是否上认证；届时的唯一候选方案是**校学生邮箱验证信**，其他认证路线全部不再考虑。

## 邮箱验证的约束（届时实现前提，不是现在的实现任务）

- 允许域只有 `stu.jxufe.edu.cn`，精确匹配，不含 `jxufe.edu.cn` 主域及其他子域；扩域需另行决定。
- 验证信经自托管邮件服务器（louis 主机）投递。Worker 不能直连 SMTP:25，必须走该邮件服务器的 HTTPS API 或中继（见 `docs/research/lightweight-ordinary-user-auth.md`）。
- 启动实现前先用真实 `stu.jxufe.edu.cn` 邮箱验证发件域能进校内收件箱（SPF/DKIM/DMARC），进箱失败则方案重议。
- ADR-0016 的身份契约照旧：邮箱哈希只作认证身份 `subject`，不当业务主键；`users.id` 稳定匿名；公开只读不要求登录；JWT/凭据已验证不等于免 CSRF。

## 与 ADR-0016 的关系

与 [ADR-0016](./0016-school-email-access-identity.md) 冲突——0016 把 AuthBridge 校园 JWT 定为生产认证方，并在 Considered Options 里以「校园 JWT 已由 AuthBridge 签发」为由否决站点自行发验证信。本决策搁置前者，前提失效后重新指定后者为唯一候选。0016 的验签实现、会话与账号生命周期契约保留原样：`CAMPUS_JWT_ENABLED` 不设，`POST /api/auth/callback` 维持 503，代码与占位密钥不删除。

## Consequences

- 生产环境没有任何普通用户会话签发路径，认可（`PUT/DELETE /api/reviews/:id/endorsement`）在生产不可用，直到认证上线；测试 HMAC 头继续只用于 Vitest。
- 将来若从搁置状态改上邮箱认证，认证身份的 `provider` 与 AuthBridge 不同，且双方没有可自动关联的信号；按 0016 的规则不猜测合并。趁生产零普通用户时切换没有迁移成本。

## Considered Options

- **AuthBridge 校园 JWT**：搁置而非否决——白名单开通依赖校方与第三方维护者，且首发没有强认证需求；已完成的实现按 0016 保留待命。
- **自建 CAS client 直连 `ssl.jxufe.edu.cn/cas`**：2026-08-19 实测 `GET /cas/login?service=https://xk.sein.moe/...` 返回「Unauthorized Service Access ... not found in service registry」，学校 CAS 强制 service registry，未注册回调在登录页即被拒；自建代码无法绕过服务端校验，否决。
- **Cloudflare Access OTP**：按席位计费，免费档约 50 人，已在 ADR-0016 否决。
- **让用户提交 CAS/教务口令由站点代验**：钓鱼形态，否决。
- **邀请码、人工材料审核、校园网 IP 判定**：均不能独立证明校内身份，最多作反滥用辅助信号，否决。
