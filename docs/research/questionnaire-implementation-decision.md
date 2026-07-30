# 学生投稿问卷：继续自建还是迁移问卷星

研究日期：2026-07-26。结论基于仓库现状与一手资料；外部服务条款可能变更，正式上线前应复核。

## 项目现状

- jufexk 是 Hono + Cloudflare Workers + D1 + Vite 的单体应用（`README.md`；`package.json` 仅有 `hono` 运行依赖）。问卷 UI 已按四段分页实现：对象、总体评价、课堂与考核、确认提交；课程、任课教师、总体推荐度是仅有必填项（`src/main.ts:48`）。
- 提交流程直接写入本项目 D1：`POST /api/reviews` 校验课程—教师或开课班关系、overall、可选维度，并以批处理插入 `reviews`；返回“投稿已进入审核队列”（`src/index.ts:263-350`）。
- 反滥用和匿名机制已经存在：蜜罐、Cloudflare Turnstile Siteverify、每 IP 哈希每小时 5 次限流、按课程/教师/学期/IP 哈希去重（`src/index.ts:214-232,263-347`）。
- 找不到目录对象时不是自由建目录，而是 `POST /api/catalog-requests` 进入管理员审核队列；随附评价暂存，批准后再建立评价（`docs/adr/0002-catalog-addition-requests.md`；`src/index.ts:352-406`）。前端还会把当前问卷内容带入申请（`src/main.ts:67-84,49`）。

## 硬性业务需求

1. 评价必须绑定真实课程、任课教师（可选开课班），并经管理员审核后公开；目录补充申请和评价必须能在同一条工作流中暂存、审核、关联。
2. overall 必填，其他维度、学期、文字均可选；字段需落入现有 `reviews` 模型并参与现有评分/审核查询。
3. 匿名但可反滥用：Turnstile、蜜罐、IP 哈希限流和重复投稿控制不能丢失。
4. 站点的视觉与导航是工具页一体化体验，不能跳到带第三方品牌的独立问卷；移动端分页、进度、错误反馈需保持。
5. 数据应留在项目控制的 D1/Cloudflare 访问边界内，便于现有管理员审核、审计事件和备份策略。

## 选项比较

| 选项 | 能力与成本 | 对硬性需求的影响 | 判断 |
|---|---|---|---|
| 继续自建（推荐） | 已完成 UI、API、D1 schema、审核后台和反滥用；新增字段/校验是普通代码与迁移工作。维护成本由项目承担，但边际成本低。 | 原生满足对象绑定、暂存申请、审核队列、匿名与审计；数据不需跨系统同步。 | 最小风险、最少返工 |
| 迁移问卷星 | 可快速搭建通用题目、跳题、多级下拉、嵌入和 Excel 导出。要与 jufexk 自动同步，则需使用其数据推送/跳转等接口；[API 总览](https://www.wjx.cn/help/help.aspx?h=1&helpid=333)标明接口仅对旗舰版提供，[外部多级下拉数据](https://www.wjx.cn/help/help.aspx?helpid=868)也不是免费版能力。公开文档未给出接口 SLA、失败重试和价格。 | 即使嵌入站内，仍需额外实现目录实时同步、开课班—教师约束、补录申请、审核回写、幂等和失败补偿。平台会处理答卷及 IP、提交时间等元数据；[隐私政策](https://www.wjx.cn/wjx/license.aspx?type=1)说明发布者仍是数据控制者并负有告知义务。 | 不建议作为主链路；最多做脱敏的临时调研 |
| 自托管开源问卷（备选） | [LimeSurvey](https://github.com/LimeSurvey/LimeSurvey) 官方仓库标注 GPL v2（可选更高版本），功能成熟但 PHP/数据库运维栈与本项目 Workers/D1 不同；[Formbricks](https://github.com/formbricks/formbricks) 核心为 AGPLv3，仓库同时含 Enterprise 目录，且不提供白标，集成/再分发边界需审查。 | 两者都仍需自建同步服务、对象绑定和审核回写；引入第二套账号、部署、升级和数据备份面。 | 只有在未来需要通用问卷平台时评估，不值得为当前单一问卷迁移 |

## 明确建议

继续自建，不迁移问卷星。当前问卷不是“通用问卷收集”，而是目录实体约束、匿名反滥用、待审队列和目录补录事务的产品核心；迁移后最难复刻的正是这些业务规则，而不是题目渲染。问卷星可作为一次性问卷或运营人员临时调研工具，但不要承载正式评价数据、目录补录或公开审核链路。

## 可参考 GitHub 仓库及适用方式

- [surveyjs/survey-library](https://github.com/surveyjs/survey-library)：MIT。首选参考或直接引入的前端问卷渲染库；支持 TypeScript、JSON 定义、多页、条件逻辑、校验和把结果提交到任意后端，能继续使用现有 Hono/D1 API。注意免费的 Form Library 与付费的 Survey Creator、Dashboard、PDF Generator 是不同产品，见[官方许可说明](https://surveyjs.io/faq/licensing)。本项目当前四段问卷很小，暂时没有必须引入它的收益；题目显著增多或需要配置化时再评估。
- [formio/formio.js](https://github.com/formio/formio.js)：MIT。框架无关的 JavaScript 表单渲染器，支持 JSON schema、wizard、多页和条件逻辑；可只用渲染器并仍提交到 Hono/D1。功能和 schema 较重，更适合作为复杂表单实现参考。
- [eclipsesource/jsonforms](https://github.com/eclipsesource/jsonforms)：MIT。适合参考 JSON Schema 校验、条件显示和自定义 renderer；它不是开箱即用的问卷向导，分页仍要自行实现。
- [formkit/formkit](https://github.com/formkit/formkit)：MIT。多步表单和校验体验值得参考，但主要面向 Vue/React；现有原生 TypeScript 前端不值得为它引入框架。
- [LimeSurvey/LimeSurvey](https://github.com/LimeSurvey/LimeSurvey)：GPL-2.0-or-later。可参考分页、题型和导出实现；不建议直接接入生产，因为其 PHP/数据库运行时与 Workers+D1 不匹配，且 GPL 义务需由部署者承担。
- [formbricks/formbricks](https://github.com/formbricks/formbricks)：核心 AGPLv3；仓库说明 Enterprise 功能另有许可且不提供白标。可参考问卷编辑器和分析交互，不应复制 Enterprise 代码，也不应把它当作本项目的无缝嵌入组件。

## 短期行动建议

1. 保持现有 API 作为唯一正式写入口；为问卷增加端到端测试，覆盖对象绑定失败、Turnstile 失败、限流、重复键和目录申请随附评价。
2. 在 D1 迁移中明确约束/索引与数据保留策略；继续只存 IP 哈希，审查日志和管理员审核事件是否足够追责而不暴露身份。
3. 做一次真实移动端可用性测试（四段分页、返回、刷新、网络失败重试），确认 Turnstile 加载失败时错误可理解。
4. 若业务方坚持试用问卷星，限定为脱敏、无正式评分的 1–2 周可用性实验；不得把外部导出的数据自动写入 `reviews`，必须经过人工映射、去重、审核后再导入。
5. 仅当未来出现多种非评价调查、复杂分支逻辑或非开发人员频繁建问卷的明确需求时，再立项评估自托管 LimeSurvey/Formbricks，并先做许可证、隐私、备份和 Workers 集成 PoC。
