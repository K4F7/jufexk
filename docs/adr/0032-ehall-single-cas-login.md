# eHall adapter is prepared before the single CAS login

本决策明确 ADR-0029 的时序：本站登录前先访问固定 eHall 入口取得一次性 adapter service，再把该动态 service 作为同一次 CAS 登录的目标；校园 CAS 成功后立即密封最长 7 天的 eHall 启动会话，但只在用户显式启动本科教务时使用。密码路径只在当前请求和 MFA 页面内存中使用，MFA 和扫码的加密短期 challenge 只保留继续验证所需的 adapter/CAS 状态，成功后兑换 eHall 会话。这样避免依赖第二次 service ticket（密码/MFA 常只有一次性 CAS 会话），同时不向本站页面脚本、JSON API、日志或长期存储暴露上游 Cookie、ticket 或凭据；启动本科教务时，Worker 只用一次 302 导航把浏览器送到严格校验的 JWXT callback，让学校消费一次性 ticket。“记住本机”由 CAS 请求固定默认开启，界面不提供开关。
