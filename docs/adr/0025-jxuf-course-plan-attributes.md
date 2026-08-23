# 课程详情方案字段用江财课表原词，不用评价规则猜测

课程详情六格里的选课类别、教学类型、课程层次来自江财查询课表「课程类别」路径与全校课表的学分/承担单位，写入 `courses.enrollment_category` / `teaching_type` / `course_level`。没有原文就留空，详情页显示 —。

评价模板仍只用 `courses.category`（普通课程 / 体育课）。禁止再按 `scheme_key` 或 `mooc` 标签猜出「专业课 / 讲授 / 本科 / 通识 / 思政 / 慕课」。禁止套用科大词汇（通修、专业核心、专业基础、专业选修）。

基线发布后只回填已有课号，不创建课程或教师；旧式 CSV `/api/admin/import` 仍永久禁用。官方入口是 `POST /api/admin/import/course-plan-attributes`。

## Considered Options

- **继续按评价规则键派生**：实现便宜，但和江财课表原词冲突，否决。
- **把科大通修/专业核心当作课程层次**：参考站用词，不是江财课表，否决。
- **重放目录基线以补这三列**：会改身份写入路径，否决。
