## Parent

- 领域词：`CONTEXT.md`（课程锚点、逐行上下文索引、截图质量验收、冻结清单、冻结矩阵编排、评价起始单元格、横向溢出、单元格审核任务、图文核验、审核包）
- 规格：ADR 0001、ADR 0019、ADR 0020
- 全量定位矩阵：#43（`formula-bar-matrix-plan-v1`，14985 格）
- 缺口清单：#197
- 三表冒烟：#180（只读）
- 五表冒烟：#227 契约 + #229 现场（只读）
- 全量剩余 capture：#198 / #199
- 冻结编排：#220 `legacy-matrix-freeze`
- 审核包：#200 `legacy-review-package`

本票是冒烟之后、全量与审核包之前的收口。**未关本票不得开 #198 / #199 全量，也不得对未收口的表跑 #200。**

## Problem Statement

八张工作表的冒烟已经拍完并冻了两份 capture manifest，但现场证明：工单里的课名/教师列字母、硬编码布局、合并格处理和审核裁图都不可靠。如果现在就按旧布局跑全量矩阵或审核包，会把错误教师列、错位行和整窗 OCR 写进下游。

已经发生过：体育课现场教师是 B，索引仍写 C，审核包却按这套上下文批准了 47 格；大英现场教师是 E，索引写 G 且 `teacher_unconfirmed`；MOOC 地址框填 G46 两次都跳到 G47。操作者需要先把冒烟暴露的问题收成一份可执行、可测试的门禁，再允许全量和 workflow。

## Solution

冻一份八表「现场布局」契约：课名列、教师列只来自公式栏现场确认，禁止再猜字母。定位器把「合并继承 / 活动地址错位停手 / MOOC G46 禁猜」做成确定性分类。冻结矩阵编排和审核包在开跑前必须通过这份布局；体育课已跑过的审核包隔离，不当前面样板。#180 / #229 已冻包保持只读。

## User Stories

1. As an 现场操作者, I want 八张表的课名列和教师列写成一份冻结现场布局, so that 全量和审核不再各猜一套字母
2. As an 现场操作者, I want 布局只接受公式栏双读确认过的列字母, so that 工单正文不能覆盖现场
3. As an 现场操作者, I want 体育课教师列冻成 B 而不是 C, so that 课程介绍列不再被当成老师
4. As an 现场操作者, I want 大英教师列冻成 E 而不是 G, so that 空的 G 列不再进入逐行上下文索引
5. As an 现场操作者, I want 外教教师列冻成 E（F 仅为老师英文名）, so that 英文名列不会盖住中文老师
6. As an 现场操作者, I want 数学课课名 B、教师 C 写进布局, so that 全量剩余那 1 格有同行上下文
7. As an 现场操作者, I want MOOC 课名 B、教师 F 写进布局, so that 没有「课程」表头时也不猜列
8. As an 现场操作者, I want 主要课程课名 A、教师 E 写进布局, so that 表头空的行仍能按列取上下文
9. As an 现场操作者, I want 美育课名 A、教师 D 写进布局, so that E 列课程介绍不会被当成老师
10. As an 现场操作者, I want 思政课保持课名 A、教师 F, so that 与现场一致的表不必重猜
11. As an 证据管理员, I want 现场布局契约不能写入公式栏原文或评价正文, so that 清单可以分享且不泄漏正文
12. As an 证据管理员, I want 现场布局带 SHA-256, so that 全量和审核包能绑定同一份列字母
13. As an 证据管理员, I want #180 / #229 / 公式栏全量包被标为受保护输出, so that 收口过程不能覆盖已冻哈希
14. As a 定位器, I want 目标地址与活动地址不同时先判断合并继承, so that 课名合并落到锚点不会被打成 halt_batch
15. As a 定位器, I want 记录 target 与 active 两套地址, so that 课程锚点继承可审计
16. As a 定位器, I want ArrowRight 后活动地址不是下一列就立刻停并回到地址框, so that 数学课 A7→B5 这类错行不会连按扩散
17. As a 定位器, I want 换表、换行、未中之后第一格必须走地址框, so that 不会在错误焦点上盲移
18. As a 定位器, I want 禁止点网格成为契约常量, so that F23/F25 已修好的错位不会复发
19. As a 定位器, I want MOOC 定位 G46 若活动地址不是 G46 就停在该探针, so that 不会猜第 46 行或该表剩余 24 格
20. As a 定位器, I want G46 未修好时冻结矩阵编排拒绝 MOOC 冒烟行之外的范围, so that #198 不能假装完成 MOOC
21. As a 捕获程序, I want 非空公式栏先按 scrollHeight 拉高再拍 formula 图, so that 长评不会只剩格子画面
22. As a 捕获程序, I want 拉高后仍被切短时只标 formula_truncated_dom_authoritative, so that DOM 双读仍是正文权威
23. As a 捕获程序, I want 窗口抓取只允许 PrintWindow, so that 桌面叠层不能再进冻结图
24. As a 捕获程序, I want 窗口不是 2560×1440 或处于最小化时该格停止, so that 不会再留下 2576×1416 或隐藏窗截图
25. As a 捕获程序, I want 空评价格不截评价图, so that 美育这类空表不会产生上千张废图
26. As a 捕获程序, I want 已进生产和已打包未导入的键一律 reuse, so that 收口和全量都不会重写 record_sha256
27. As an 索引编译器, I want 用现场布局列字母加公式栏双读生成逐行上下文索引, so that 每行恰有课名和教师
28. As an 索引编译器, I want #229 五表冒烟行补出 context-index, so that 外教/数学/主要课程冒烟可以进审核包
29. As an 索引编译器, I want 按现场列重编 #180 体育和大英的索引副本, so that 下游不再读错误的 C/G
30. As an 索引编译器, I want 重编索引写成新文件而不是改 #180 manifest, so that 冒烟冻结哈希不变
31. As an 索引编译器, I want 盖不住的行保持 missing_context, so that 模型不能补教师名
32. As an 审核包编排者, I want 没有通过现场布局门禁的范围被拒绝编清单, so that 不会再跑出教师列错误的批准
33. As an 审核包编排者, I want OCR 只吃评价格裁图, so that 标题栏、「只能查看」和邻格不会进分析 B
34. As an 审核包编排者, I want 体育课 6–14 已完成的审核包标为隔离样板, so that 那 47 格批准不扩散成全量范本
35. As an 审核包编排者, I want 只路由 never_packaged 的评价起始单元格, so that 已进生产和已打包未导入不会再审一遍
36. As an 审核包编排者, I want 美育冒烟范围内没有 never_packaged 时直接记「无评价可审」, so that 不会为空格开 agent
37. As a 冻结矩阵编排者, I want 默认工作表包含外教, so that 全量不会漏掉那 10 个从未进包格
38. As a 冻结矩阵编排者, I want 开跑前校验现场布局 SHA, so that 列字母漂移会让整次冻结失败
39. As a 冻结矩阵编排者, I want 人未声明只能查看已就绪时 pause, so that 编排不会自己登录
40. As a 缺口清单维护者, I want 收口不改 #197 的 14985 分类规则, so that never_packaged 计数仍然闭合
41. As a 测试作者, I want 用现场布局契约做唯一对外缝, so that 不必为每个 CLI 各写一套列字母夹具
42. As a 测试作者, I want 体育 C、大英 G 的旧布局夹具被断言拒绝, so that 回归不会把错误字母放回去
43. As a 测试作者, I want G46→G47 被断言为 blocked 而不是猜行, so that 定位器不能静默改地址
44. As a 测试作者, I want 课名目标 A7、活动 A6 被断言为合并继承, so that halt_batch 不会误伤锚点
45. As a 测试作者, I want ArrowRight 到错误行列被断言必须回地址框, so that 连按被禁止
46. As a 测试作者, I want CopyFromScreen 与已知脏构图哈希被拒绝, so that #218 的叠层不能通过 QA
47. As a 测试作者, I want 审核清单在缺少同行上下文时不路由, so that missing_context 不会进 A/B
48. As an agent, I want 本票关闭后才能认领 #198 / #199 / #200 的全量范围, so that 顺序不会被抄近路
49. As a 维护者, I want 收口产物留在 gitignored 证据根下, so that 正文和截图不进 Git
50. As a 维护者, I want 网站导入和批准数据包仍保持后续独立授权, so that 本票不能写业务库

## Implementation Decisions

- **唯一新缝：现场布局冻结。** 新增一份八表契约（例如 `legacy-live-layout-v1`），字段只含工作表名、课名列、教师列、备注角色列（如外教英文名、课程介绍）、冒烟行范围、以及 MOOC G46 定位状态。禁止出现公式栏原文、可见格子正文、评论。带 SHA-256。这是全量冻结与审核包共同读取的唯一列字母来源。
- **现场已确认的字母写入契约，不再作为注释：** 体育 A/B；大英 B/E；思政 A/F；外教 A/E（F=老师英文名）；数学 B/C；MOOC B/F；主要课程 A/E；美育 A/D。旧硬编码（体育教师 C、大英教师 G）必须被拒绝。
- **索引编译只读现场布局。** 用布局列字母 + 已有公式栏证据（或现场双读记录的哈希/地址，不含正文进清单）生成逐行上下文索引。#229 五表冒烟行必须能产出索引。#180 体育/大英出**新**索引文件；不改 `smoke-capture-manifest-v1` 哈希，不改 `other-smoke-capture-manifest-v1` 哈希。
- **定位分类是纯函数。** 输入：目标地址、两次活动地址、公式栏是否非空、角色（课名/教师/评价）、工作表。输出仅限：`accepted`、`merge_inherit`（课名列落到已确认锚点）、`stop_return_address_box`（ArrowRight 或定位未中）、`blocked_locator`（MOOC G46 仍不是 G46）。不得把合并继承打成 `halt_batch`。不得点网格。
- **冻结矩阵编排改默认范围。** 默认工作表加入外教。开 locate / freeze 前必须绑定现场布局 SHA。MOOC 在 G46 仍为 `blocked_locator` 时，拒绝冒烟行 8–14 之外的范围。输出目录继续禁止覆盖 #180、#229、公式栏全量/重建包。
- **窗口与构图门禁并进冻结 QA。** 允许的抓取方法仍是 PrintWindow（或已有的页面截图方法，若窗口可见且 2560×1440）。最小化、尺寸不对、已知脏构图哈希 → 该格 `recapture_required`，整范围停在检查点。截断单列不把整包打成失败。
- **审核包入口加布局门。** 编清单时：无现场布局或教师列未确认 → 拒绝该表；无逐行上下文 → 该行不路由；OCR 图像必须是评价格裁图而不是窗体 chrome。只路由缺口清单里的 `never_packaged`。`in_production` 与 `packaged_not_imported` 不进本审核包。
- **已跑过的体育审核包隔离。** 现有体育 6–14 审核目录标为错误布局下的隔离结果。本票不重跑、不把它的批准数当作全量通过条件。重审体育冒烟行属于本票关闭之后的 #200，且必须绑定新索引。
- **证据不进 Git，不写腾讯表格，不写业务库。** 现场布局 JSON、新索引、门禁 QA 放在既有 gitignored 证据根下。

定位分类形状（决策，不是实现）：

```
target + active×2 + role + nonempty
  → accepted
  | merge_inherit { target, active, course_anchor }
  | stop_return_address_box { target, active }
  | blocked_locator { target, active }   // MOOC G46 only until fixed
```

现场布局最小形状：

```
{ worksheet, course_column, teacher_column, extra_columns?,
  smoke_rows, g46_status? }
// extra_columns 只能是角色标签，例如 english_name / course_intro
// 禁止任何公式栏字符串
```

## Testing Decisions

- 只测对外行为：给定布局/定位输入，断言契约哈希、拒绝旧字母、分类结果、门禁通过或拒绝。不测 Chrome 选择器、不测真实腾讯网页。
- **唯一优先缝：** 现场布局编译/校验 + 定位分类。冻结矩阵与审核包的测试只断言「没绑定布局就失败 / 绑定错误字母就失败 / 绑定正确布局才放行」，不要复制一套列字母表。
- 沿用现有 vitest 风格：冒烟矩阵子集闭合、禁止猜列、禁止正文进清单、冻结路径不得覆盖受保护包、审核包在缺上下文时不路由、构图 QA 拒绝脏哈希。
- 必测夹具：
  - 八表现场字母被接受；体育 C、大英 G 被拒绝
  - A7→A6 课名为 `merge_inherit`；ArrowRight 到 B5 为 `stop_return_address_box`
  - G46→G47 为 `blocked_locator`，且冻结范围含 MOOC 第 46 行时失败
  - 布局 JSON 含公式栏原文或 `"comment"` 时抛错
  - 无布局 SHA 时冻结 QA / 审核清单失败
  - 评价格裁图与整窗 chrome 图可区分；后者不得当作 OCR 输入通过
- 不在本票加浏览器端到端。现场字母已经由 #180 / #229 field-notes 确认，测试用冻结字面量即可。

## Out of Scope

- 不重冻 #180、#229、#43 公式栏全量包，不改其 manifest / `record_sha256`
- 不执行 #198 / #199 全量拍摄，不跑 `legacy-matrix-freeze` 全表
- 不跑 `legacy-review-package` 全量或新的思政/大英/五表审核
- 不重审、不撤销体育 6–14 那 47 格批准（只隔离）
- 不实现视觉找格，不点网格，不把截图当正文
- 不修 G46 的腾讯表格本身（只规定定位失败时的停法；若另票修好定位，再把 `g46_status` 改为 accepted）
- 不写腾讯表格、不写生产 D1、不编译批准数据包、不导入网站
- 不关 #197 / #198 / #199 / #200 / #229

## Further Notes

冒烟已证实可沿用、收口时不要改回去的协议：地址框定位、公式栏 DOM 双读为正文权威、非空先拉高、空格不截评价图、reuse 不重写源 JSON。

建议关闭本票的验收：

- [ ] 现场布局契约覆盖八表，SHA-256 稳定，不含正文
- [ ] 旧体育 C / 大英 G 硬编码路径被测试拒绝
- [ ] #229 五表冒烟行有逐行上下文索引；#180 体育/大英有新索引副本
- [ ] 定位分类覆盖合并继承、ArrowRight 错位、G46 停手
- [ ] 冻结矩阵编排默认含外教，且未绑定布局或 G46 未解时拒绝越界 MOOC
- [ ] 审核包无布局/无上下文则不路由；OCR 拒绝窗体 chrome
- [ ] 受保护包哈希未变；未写腾讯表格 / 业务库

本票关闭后的顺序仍是：按表全量（#198 然后 #199）→ 该表 Capture QA accepted → 再对该表 `never_packaged` 开 #200。
