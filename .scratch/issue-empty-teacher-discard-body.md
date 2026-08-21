## Parent

- 前置：#352 已把当前生产候选 **v7** 的 357 条写入生产
- 现场：公开历史评价 **1239**，目录 3740 / 1951 / 11572，marker 未变
- 腾讯表已封存，不能物理删格

## 目标

把 v7 `excluded.jsonl` 里仍为 `missing_teacher` 的 **57** 格标为所有者丢弃，编新候选包 **v9**（v8 已占用）。丢弃后不再以空教师待办排队。

## 已定决策

- 丢弃范围就是这 57 个 key（点名排除行 + 未点名仍空的 MOOC 17 / 体育 21–23 / 437 / 形势与政策等）。清单：`jufexk-production-inputs/v7-owner-discard-empty-teachers.json`
- 已补教师但目录未绑上的（樊凤龙 / Christine / carl）不是空教师，不丢弃
- 把 v7 的 357 条记入 `IMPORTED_PACKAGES`，避免再当可导入
- 保护 v1–v8，不覆盖
- 不二次 `--apply`，不写生产 D1，不写 #200
- 腾讯表封存，本票只改冻结分类，不改表

## 验收

- [ ] v9 的 `missing_teacher` 为 0，这 57 格 reason 为 `owner_discarded`
- [ ] 樊凤龙 / Christine / carl 仍为 `catalog_identity_unmatched`
- [ ] importable 不再包含已导入的 357 条
- [ ] 生产公开历史评价仍为 1239，目录不变
