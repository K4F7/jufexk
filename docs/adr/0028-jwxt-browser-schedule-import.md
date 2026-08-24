# 排课模拟从本科教务导入时，Cookie 只留在学生浏览器

_2026-08-24：[#488](https://github.com/K4F7/jufexk/issues/488) 走通智慧江财「本科教务」→ KINGOSOFT 上课时间 → `/schedule`。与 [ADR-0022](./0022-launch-without-ordinary-user-auth.md) 并存：站内 CAS 代登仍禁止 Worker 跟随 ehall ticket 或持久化 TGT。_

学生在自己的浏览器打开官方通道2（`https://jwxt.jxufe.edu.cn/jxcjcaslogin`）或 ehall「本科教务」。教务 `CASTGC` / `JSESSIONID` 只存在于教务站点。选课志只接受书签或粘贴回传的课程名、教师名、周次与上课时间，写入本机排课计划，不把开课班写入公开目录，也不在 Worker 上代持或落库教务 Cookie。

## Consequences

- 导入依赖学生已经登录教务；本站会话不能代替教务会话。
- 回跳只用 `/schedule#jwxt-import=` 结构化行；载荷里出现 Cookie / 口令形字符串则丢弃。
- 能对上公开任课关系的补目录 id；对不上的只留本机条目。

## Considered Options

- **浏览器内导入（采纳）**：书签在 `jwxt.jxufe.edu.cn` 同源读表，Cookie 不离开学生浏览器。
- **Worker 代持 CASTGC 跟进 ehall / jwxt**：与 ADR-0022 冲突，否决。
- **登录成功后把教务 Cookie 存进 D1 / KV**：否决。
