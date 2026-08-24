# 排课模拟：本科教务浏览器快照

[#540](https://github.com/K4F7/jufexk/issues/540) 的授权协议闸门没有取得可验证的教务会话，因此当前交付使用浏览器同源 JSON，不启用 Worker 教务代理。

## 使用流程

1. 登录选课志，打开 `/schedule`，点击「刷新教务数据」。
2. 把「导出教务快照」拖到书签栏。
3. 登录本科教务，分别进入个人选课结果（S20301）和需要的候选课程结果（S2020103）。每个结果页点击一次书签并下载 JSON。
4. 回到 `/schedule`，逐个导入 JSON。同一学期、培养层次、年级、专业的分页与类别会合并；不同组合分别保存在 IndexedDB。
5. 选择学期、培养层次、年级、专业，再从「计划内 / 公共选修」选择教师与班号。

刷新是手动动作。只打开 `/schedule` 不会访问江财教务；离线时仍可查看当前浏览器缓存。

## 文件契约与隐私

- `version` 固定为 `1`，`source` 固定为 `browser-export`。
- `captured` 标记本次文件权威包含 `enrolled | planned | public` 中的哪些类别，供分页与类别快照安全合并。
- 统一 `JwxtOffering` 包含课程号/名/学分、来源类别、班号、来源教师名、校区、周次、时间、地点、容量、状态与结构化多时段。
- 导入后只按课号和来源教师名查询本站公开目录，补课程/教师详情、评分与评价数；匹配失败仍可排课。
- JSON 上限 2 MB；任何位置出现 Cookie、`CASTGC`、`JSESSIONID`、学生学号、学生姓名或畸形开课班时整份拒绝。来源教师名是开课班字段，不是学生身份字段。

## 本机存储

- localStorage `jufexk-schedule-plan`：v2 小型计划，按学期分桶；v1 自动迁入 `legacy`。
- IndexedDB `jufexk-jwxt`：按 `term + educationLevel + grade + major` 保存多份候选/已选快照。
- 班次稳定键：`term + courseCode + section`；`included=false` 只表示模拟排除，不调用正式退课。

清除浏览器站点数据会删除这些内容。服务器不保存候选、已选课程或个人课表。
