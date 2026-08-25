# 排课模拟改为教务驱动选课，协议闸门失败时只走浏览器 JSON

_2026-08-25：[#540](https://github.com/K4F7/jufexk/issues/540) 取代 #486/#488 中「不按培养方案、不由 Worker 查询教务」的旧范围。本决策取代 [ADR-0028](./0028-jwxt-browser-schedule-import.md) 的书签回传上课时间，以及 [ADR-0022](./0022-launch-without-ordinary-user-auth.md) 里「排课从本科教务取上课时间见 ADR-0028」的冲突表述。_

_2026-08-25：[#545](https://github.com/K4F7/jufexk/issues/545) 用授权浏览器确认智慧江财“本科教务”应用 `appId=5853686007071845` 是权威入口，并确认当前已选结果页菜单码为 `S2020302`。eHall adapter 的单次 CAS 登录与 JWXT 入口跳转已通过脱敏实机验证，完整 JWXT 查询代理闸门仍未通过。_

排课模拟按学期、年级、专业浏览计划内课程与公共选修，选择教师和开课班；教务已选作为基础课表。本地计划 v2 按学期分桶，`origin=enrolled|planned|public|legacy`，稳定键 `term+courseCode+section`。

## 协议闸门

启用 Worker 代理（`/api/jwxt/session|bootstrap|candidates`）的前提是：授权账号走通 `CASTGC → service ticket → JSESSIONID → 学期字典、个人选课结果、候选课程`，并保存脱敏 GBK fixtures。eHall 的登录适配会话只支持用户显式启动本科教务，不等同于该查询闸门。

本机与共享构建环境没有可用的授权教务口令，仓库里也没有已经证明该全链路的脱敏 fixtures。闸门失败。因此本版本：

- **采纳浏览器同源 JSON 导入/导出**，DTO 与未来代理响应同一形状（`JwxtSnapshot` v1 / `JwxtOffering`）。
- **不提交**半可用 JWXT 查询 Worker 代理、凭据表或公开开课班镜像；本站只为显式启动 eHall 保存短期加密会话，详见 ADR-0032。
- 页面加载不访问教务；手动刷新只导入本机快照；候选与快照放 IndexedDB，小型计划放 localStorage。
- 导出 JSON 失败关闭 Cookie / 学生学号 / 学生姓名；来源教师名属于开课班字段。快照按学期、培养层次、年级、专业组合分库存储，同组合的分页与类别按 `captured` 合并。
- 本站只提供固定的智慧江财本科教务应用入口。校园 CAS 登录成功时，Worker 在固定 eHall adapter 链路内消费一次性 service ticket 并立即密封 eHall 启动会话；页面加载不使用该会话，只有用户显式启动时才访问上游。本站不向页面脚本、JSON API 或日志暴露 ticket/Cookie，启动时只允许一次导航到严格校验的 JWXT callback，由学校消费一次性 ticket；本站也不公开其他学生或全校开课班数据。

闸门以后若用授权账号验证成功，再另开 issue 加代理，不得在未验证链路上半开接口。

## Consequences

- 学生可在教务页用书签或手工导出快照，再回到 `/schedule` 导入；点击“刷新教务数据”会打开固定本科教务入口。本站会话不能直接代替 JWXT 查询会话。
- 已选课程以当前 `S2020302` 结果页为准；解析器兼容双层表头、方括号课程号、`上课班级` 和合并的时间/地点文本。该页缺少学期、年级或专业下拉项时允许空筛选维度，不伪造学校代码。
- 旧 v1 手填节次 / 全站搜索 / `#jwxt-import=` 回跳不再是主路径；v1 计划自动迁成 `legacy`。
- 周次相交冲突在加入前阻止；同课换班原子替换；刷新更新已选班次但保留本地排除。

## Considered Options

- **浏览器 JSON 导入/导出（采纳，闸门失败）**：同一 DTO，无服务器代持。
- **Worker 代持 CASTGC 查询选课表**：闸门未通过，否决。
- **继续书签只回传上课时间（ADR-0028）**：无法按培养方案浏览候选开课班，否决。
