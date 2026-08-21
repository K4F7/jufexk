import json
import os
from collections import Counter
from pathlib import Path

src = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\human-queue-20260819-v2")
queue = json.loads((src / "human-queue.json").read_text(encoding="utf-8"))

REASON_LABEL = {
    "verification_failed": "核验失败",
    "unresolved": "unresolved",
    "missing_context": "missing_context",
    "mapping_unsupported": "映射不成立",
}
DECISION_LABEL = {
    "pass": "通过",
    "reject": "驳回",
    "skip": "跳过",
    "通过": "通过",
    "驳回": "驳回",
    "跳过": "跳过",
}


def relpath(path: Path, start: Path) -> str:
    return Path(os.path.relpath(path, start)).as_posix()


items = queue["items"]
by_sheet = Counter(item["worksheet"] for item in items)
sheet_lines = [f"- `{name}`：{count}" for name, count in sorted(by_sheet.items(), key=lambda pair: pair[0])]
empty = queue.get("empty_worksheets") or []
lines = [
    "# 冻结审核包未批准格人工核验包 v2",
    "",
    "> 每项图片是当时格图；正文权威是公式栏原值，不要另写一稿。图片只是审核界面，机器权威仍是 `human-queue.json`。",
    "",
    "思政课已收口后重编。v1 的 226 格决定沿用；本包新增思政课 112 格。",
    "",
    "## 填写规则",
    "",
    "只填写每项末尾的 `decision`、`note`，不要修改 `key` 与公式栏原文。",
    "",
    "- `通过`：公式栏原文可作为该格审核正文，课名/教师映射成立。",
    "- `驳回`：不能作为存储正文，或映射不成立。",
    "- `跳过`：本次不处理。",
    "",
    f"待审合计：**{len(items)}**。自动批准 {queue.get('auto_approved_cells', 0)} 格不在本包。",
    "",
    "## 分表",
    "",
    *sheet_lines,
    "",
]
if empty:
    lines.extend(["无待审：" + "、".join(f"`{name}`" for name in empty), ""])

for number, item in enumerate(items, 1):
    course = item.get("course") or "（冻结上下文无课名）"
    teacher = item.get("teacher") or "（冻结上下文无教师）"
    reason = REASON_LABEL.get(item["reason"], item["reason"])
    detail = f"；`{item['reason_detail']}`" if item.get("reason_detail") else ""
    cell = Path(item["cell_image"])
    decision = DECISION_LABEL.get(item.get("decision") or "", item.get("decision") or "")
    note = item.get("note") or ""
    lines.extend(
        [
            f"## {number:03d} · `{item['key']}`",
            "",
            f"- **key**: `{item['key']}`",
            f"- **worksheet**: {item['worksheet']}",
            f"- **row**: {item['row']}",
            f"- **column**: {item['column']}",
            f"- **course**: {course}",
            f"- **teacher**: {teacher}",
            f"- **reason**: `{reason}`{detail}",
            "- **formula_bar_value**:",
            "",
            "```",
            item["formula_bar_value"],
            "```",
            "",
            f"**当时截图** — `{item['worksheet']}` 第 {item['row']} 行 {item['column']} 列",
            "",
            f"![{item['key']} 当时截图](<{relpath(cell, src)}>)",
            "",
            "### 处理意见：",
            "",
            f"- **decision**: {decision}",
            f"- **note**: {note}",
            "",
            "---",
            "",
        ]
    )

(src / "manual-review.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")
print("wrote", src / "manual-review.md", "bytes", (src / "manual-review.md").stat().st_size)
