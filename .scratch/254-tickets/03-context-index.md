## Parent

#254

## What to build

用已冻现场布局的列字母，给冒烟行编出逐行上下文索引：每个原始行恰有一项课名和教师引用。#229 五表冒烟行必须能产出索引。#180 体育课、大英和视听说写出**新**索引副本（教师列分别为 B、E），不要改已冻冒烟 manifest。盖不住的行保持 `missing_context`，不得猜教师名。索引本身不写入公式栏原文。

## Acceptance criteria

- [ ] #229 外教 / 数学课 / MOOC / 主要课程 / 美育冒烟行各有逐行上下文索引
- [ ] #180 体育课、大英的新索引使用现场教师列 B、E，而不是旧的 C、G
- [ ] `smoke-capture-manifest-v1` 与 `other-smoke-capture-manifest-v1` 哈希未变
- [ ] 盖不住的行是 `missing_context`，没有编造的可见教师
- [ ] 索引契约不含公式栏原文或评价正文
- [ ] 未写腾讯表格 / 业务库

## Blocked by

- #255
