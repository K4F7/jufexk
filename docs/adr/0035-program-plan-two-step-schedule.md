# 排课模拟按培养方案课号去重，再选开课班

_2026-08-26：[#637](https://github.com/K4F7/jufexk/issues/637) 采集培养方案理论课程；[#640](https://github.com/K4F7/jufexk/issues/640) 落地两步选课。本决策收窄 [ADR-0029](./0029-jwxt-driven-schedule-import.md) 里「专业所属学院的公开目录任课关系当作计划内课」的做法。_

江财课号就是「课」；同课号下的老师/开课班才是「班」。`/schedule` 先把培养方案课加入选课列表（未选，不占课表），再点右栏某个班上表（备选）；「保存课表」才变成已选。刷新只恢复已选。

## 数据

- **课列表**：培养方案「理论课程」派生，键为 `年级 + 专业代码 + 课号 + 建议学期`。选择课程弹层按课号去重，一行一课。不把培养方案路径写入 `courses.enrollment_category`。
- **班列表**：现有 `GET /api/schedule-offerings`（`jwxt_sync_offerings` 优先，目录 `offerings` 回退）。
- **采集包**：独立 schema `program-plan-capture/v1`（`manifest.json` + `queries.jsonl` + `snapshots/`），不混进目录基线批准包。全量爬取由人工会话完成。
- **公共选修**：本轮仍用体育/公选桶，按课号去重；不重做通识检索。

## 本地计划 v3

`status = 0 未选 | 1 备选 | 2 已选`。未选不写入 occupy。点班走现有周次相交；同课号换班先释放再检查。`savePlan` 只在「保存课表」时把备选写成已选并写入 localStorage。未保存用清除；已选用退课（二次确认）。v1/v2 迁成已选。

## Consequences

- `#637` 派生 JSONL 未导入时，计划内弹层为空，公共选修与已选课表仍可用。
- `/schedule` 仍只做电脑端（ADR-0030）。不等待 JWXT Worker 协议闸门变 `supported`。

## Considered Options

- **培养方案课号 + 两步状态（采纳）**：对齐官方选课通知与同济选课模拟的课/班分层。
- **继续用学院公开目录当计划内**：会把任课关系行当成课，否决。
- **照搬同济去掉课号末两位**：江财课号本身就是课，否决。
