## Parent

#254

## What to build

给定位加一个纯函数分类：输入目标地址、两次活动地址、公式栏是否非空、角色（课名 / 教师 / 评价）和工作表；输出只能是 `accepted`、`merge_inherit`、`stop_return_address_box` 或 `blocked_locator`。课名列落到已确认课程锚点记继承，不要打成 `halt_batch`。ArrowRight 后不是下一列必须停并回到地址框。MOOC 目标 G46 而活动地址不是 G46 时停在探针，不准猜该行其余格。禁止点网格。

## Acceptance criteria

- [ ] 课名目标 A7、活动 A6 分类为 `merge_inherit`，并同时留下 target 与 active
- [ ] ArrowRight 落到错误行列分类为 `stop_return_address_box`，不得继续连按
- [ ] MOOC G46 → G47 分类为 `blocked_locator`，不得展开成整行计划
- [ ] 两次活动地址不一致时不得 `accepted`
- [ ] 分类结果不含公式栏原文或评价正文
- [ ] 未写腾讯表格 / 业务库

## Blocked by

- None — can start immediately
