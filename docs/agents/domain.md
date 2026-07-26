# 领域文档

各工程 skill 在探索代码库时，应如何消费本仓库的领域文档。

## 探索之前先读这些

- 根目录的 **`CONTEXT.md`**，或
- 根目录的 **`CONTEXT-MAP.md`**（如果存在）——它指向每个上下文各自的 `CONTEXT.md`，读取与主题相关的那几份。
- **`docs/adr/`** —— 阅读与你即将动手的区域相关的 ADR。多上下文仓库还要检查 `src/<context>/docs/adr/` 下的上下文级决策。

如果这些文件不存在，**静默继续**。不要提示它们缺失，也不要一上来就建议创建。`/domain-modeling` skill（可经 `/grill-with-docs` 与 `/improve-codebase-architecture` 到达）会在术语或决策真正被确定下来时按需创建。

## 文件结构

本仓库是**单上下文**（多数仓库都是）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-legacy-review-tiered-moderation.md
│   ├── 0002-catalog-addition-requests.md
│   └── 0003-append-only-catalog-import.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文级决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用词汇表里的术语

当你的输出提到某个领域概念时（issue 标题、重构提案、假设、测试名），使用 `CONTEXT.md` 中定义的术语。不要漂移到词汇表用 `_Avoid_` 明确排除的同义词——例如写「开课班」而不是「教学班」，写「学生投稿」而不是「评论」。

如果你需要的概念还不在词汇表里，这本身是个信号：要么你在发明项目并不使用的语言（重新考虑），要么确实存在缺口（记下来交给 `/domain-modeling`）。

## 与 ADR 冲突时显式标注

如果你的输出与既有 ADR 相矛盾，明确指出，不要悄悄覆盖：

> _与 ADR-0001（历史评价分级审核）冲突——但值得重开讨论，因为……_
