## Parent

#254

## What to build

让冻结矩阵编排在开跑前通过现场布局和定位分类门禁：默认工作表包含外教；未绑定现场布局 SHA 则 locate / freeze 失败；MOOC 在 G46 仍是 `blocked_locator` 时拒绝冒烟行 8–14 之外的范围。窗口不是 2K、最小化、或构图是 `CopyFromScreen` / 已知脏哈希时，该格 `recapture_required` 并停在检查点。本票只加门禁，不执行全量拍摄，不覆盖 #180 / #229 / 公式栏全量包。

## Acceptance criteria

- [ ] 默认工作表包含外教
- [ ] 未绑定现场布局 SHA 时 locate / freeze 失败
- [ ] G46 未解时，含 MOOC 第 15 行及之后的范围被拒绝
- [ ] 脏构图或非 2K 窗口使该格 `recapture_required`，截断单列不把整包打成失败
- [ ] 受保护包哈希未变
- [ ] 未写腾讯表格 / 业务库；未跑全表冻结

## Blocked by

- #255
- #256
