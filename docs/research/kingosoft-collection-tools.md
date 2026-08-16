# KINGOSOFT/青果课程与教师采集工具调研

调研范围：GitHub 一手仓库/README/源码页面及作者公开的 GitHub 入口；目标站点为 `jwxt.jxufe.edu.cn`，已知查询接口为 `POST /taglib/DataTable.jsp?tableId=5327042`（GBK HTML、分页参数 `currPageCount`）。未使用或保存任何登录凭证。

## 候选项目

### west2-online/jwch — 可借鉴（非 KINGOSOFT 兼容实现）

- 来源：[仓库 README](https://github.com/west2-online/jwch)；[Apache-2.0 LICENSE](https://github.com/west2-online/jwch/blob/main/LICENSE)；[course.go](https://github.com/west2-online/jwch/blob/main/course.go)、[jwch.go](https://github.com/west2-online/jwch/blob/main/jwch.go)。
- 用途/技术栈：README 明确称为“Academic Affairs Office of Fuzhou University”的 Golang interface encapsulation；支持模拟用户办理教务操作（仓库 README “This is an interface encapsulation class … implemented by Golang”）。当前进度列出 User login、按学期获取选课、获取成绩、用户信息、Session check、自动验证码识别等（README 的 “Current progress”）。仓库语言页显示 Go 98.3%，Shell 1.2%，Makefile 0.5%。
- 活跃度：GitHub 页面显示 111 commits、9 stars、6 forks；最新 release `v0.2.37`（2025-10-16）。
- 会话/安全：README 要求用 `USERNAME_23`、`PASSWORD_23` secret 运行本地 action 测试，说明实现是账号密码登录并维护会话；不应把示例 secret 用于本项目。仓库包含 `cookies.txt` 文件名（README 文件树），应在复用前审查其内容和历史。
- 与目标端点兼容性：未发现 KINGOSOFT、`DataTable.jsp`、`wsxk.kcbcx` 或 `jwxt.jxufe.edu.cn` 字样；其福州大学接口和目标江西财经大学 KINGOSOFT 页面实现不同，不能直接调用目标端点。可复用模块仅限 Go HTTP 客户端/登录态管理、课程模型、HTML/XPath 解析组织方式；目标响应需另写 GBK 解码和表格解析。
- 风险：站点协议、验证码、字段和会话流程强耦合；跨校复用未经验证。Apache-2.0 允许借鉴，但需保留许可证声明。

### wzj1122/jxufe-auto-evaluate — 可借鉴（同校同系统，非采集器）

- 来源：[作者 GitHub 仓库入口](https://github.com/wzj1122/jxufe-auto-evaluate)（由作者在 [GreasyFork 发布页](https://greasyfork.org/zh-CN/scripts/583720-%E6%B1%9F%E8%A5%BF%E8%B4%A2%E5%A4%A7%E5%AD%A6%E8%87%AA%E5%8A%A8%E8%AF%84%E6%95%99)明确链接）。
- 用途：江西财经大学 KINGOSOFT 教务系统 Tampermonkey 自动评教；脚本说明列出自动导航评教页面、批量选择/填写、暂存、刷新和检测会话过期后等待重新登录。匹配入口为 `https://jwxt.jxufe.edu.cn/frame/homes.action*`。
- 技术/会话：浏览器用户脚本（GreasyFork 页面）；所有操作在浏览器本地完成，不收集用户数据；依赖人工登录后的浏览器会话，并能检测会话过期。该会话模式与本项目“人工登录会话”一致，可参考页面导航和过期检测。
- 活跃度/许可证：GreasyFork 显示 v1.1.0，创建 2026-06-21、更新 2026-06-27（截至调研日期）；发布页未显示明确开源许可证，仓库许可证状态未能从 GitHub 页面缓存核验，复用前必须检查仓库 LICENSE/脚本头部。
- 与目标端点兼容性：脚本针对评教流程，不读取课程/教师列表；未检出 `DataTable.jsp`、`tableId=5327042` 或 `currPageCount` 证据，不能直接作为采集器。可复用的是同校 KINGOSOFT 页面入口、浏览器会话复用、登录失效检测思路。
- 风险：自动评教会产生真实教务写操作；本项目只应提取公开查询结果，严禁复用其提交/暂存逻辑。脚本免责声明要求用户自负后果。

## 未发现的直接实现

在 GitHub 公开搜索中未找到同时满足“青果/KINGOSOFT + 课程/教师抓取 + `DataTable.jsp`/`wsxk.kcbcx`”的可直接运行仓库。搜索到的正方、强智等教务系统脚本属于不同厂商端点，不应作为 KINGOSOFT 兼容性证据。青果官方产品资料仅说明平台采用 Java EE、覆盖教学安排/选课等模块，未公开采集 API；参见[青果产品页（厂商信息及技术概述）](http://www.kingosoft.com/)。

## 结论与建议

1. 直接可用：无。目标采集器应基于已登录浏览器/HTTP 会话自行实现 `DataTable.jsp` POST、GBK 解码、分页和 HTML 表格解析。
2. 可借鉴：`west2-online/jwch` 的 Go 会话与课程模型（Apache-2.0）；`wzj1122/jxufe-auto-evaluate` 的同校 KINGOSOFT 页面导航、人工会话及过期检测（许可证待核验）。
3. 适用边界：两项目都没有证明能调用 `tableId=5327042`；上线前必须用无凭证的本地 HTML fixture 测试解析，生产仅接收用户主动提供的会话，不记录 Cookie/账号密码。
