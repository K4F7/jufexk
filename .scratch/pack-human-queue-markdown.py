import hashlib
import json
import os
import zipfile
from collections import Counter
from pathlib import Path

src = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\human-queue-20260819-v1")
out_zip = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\human-queue-20260819-v1.zip")
queue = json.loads((src / "human-queue.json").read_text(encoding="utf-8"))

REASON_LABEL = {
    "verification_failed": "核验失败",
    "unresolved": "unresolved",
    "missing_context": "missing_context",
    "mapping_unsupported": "映射不成立",
}


def relpath(path: Path, start: Path) -> str:
    return Path(os.path.relpath(path, start)).as_posix()


def md_image(alt: str, path: str) -> str:
    return f"![{alt}](<{path}>)"


def build_markdown(items: list[dict], image_href) -> str:
    by_sheet = Counter(item["worksheet"] for item in items)
    sheet_lines = [f"- `{name}`：{count}" for name, count in sorted(by_sheet.items(), key=lambda pair: pair[0])]
    excluded = queue.get("excluded_open_worksheets") or []
    empty = queue.get("empty_worksheets") or []
    lines = [
        "# 冻结审核包未批准格人工核验包 v1",
        "",
        "> 每项图片是当时格图；正文权威是公式栏原值，不要另写一稿。图片只是审核界面，机器权威仍是 `human-queue.json`。",
        "",
        "## 填写规则",
        "",
        "只填写每项末尾的 `decision`、`note`，不要修改 `key` 与公式栏原文。",
        "",
        "- `通过`：公式栏原文可作为该格审核正文，课名/教师映射成立。",
        "- `驳回`：不能作为存储正文，或映射不成立。",
        "- `跳过`：本次不处理。",
        "- 尚未决定的项保持 `decision` 为空。",
        "",
        f"待审合计：**{len(items)}**。自动批准 {queue.get('auto_approved_cells', 0)} 格不在本包。",
        "",
        "## 分表",
        "",
        *sheet_lines,
        "",
    ]
    if excluded:
        lines.extend(["未混入未收口表：" + "；".join(f"`{item['worksheet']}`（{item['reason']}）" for item in excluded), ""])
    if empty:
        lines.extend(["无待审：" + "、".join(f"`{name}`" for name in empty), ""])
    for number, item in enumerate(items, 1):
        course = item.get("course") or "（冻结上下文无课名）"
        teacher = item.get("teacher") or "（冻结上下文无教师）"
        reason = REASON_LABEL.get(item["reason"], item["reason"])
        detail = f"；`{item['reason_detail']}`" if item.get("reason_detail") else ""
        cell = Path(item["cell_image"])
        lines.extend([
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
            md_image(f"{item['key']} 当时截图", image_href(cell)),
            "",
        ])
        conflict = item.get("conflict_image")
        if conflict:
            lines.extend([
                "**冲突图**",
                "",
                md_image(f"{item['key']} 冲突图", image_href(Path(conflict))),
                "",
            ])
        lines.extend([
            "### 处理意见：",
            "",
            "- **decision**: ",
            "- **note**: ",
            "",
            "---",
            "",
        ])
    return "\n".join(lines)


items = queue["items"]
missing = [item["cell_image"] for item in items if not Path(item["cell_image"]).is_file()]
if missing:
    raise SystemExit("missing images:\n" + "\n".join(missing[:20]))

local_md = build_markdown(items, lambda path: relpath(path, src))
(src / "manual-review.md").write_text(local_md, encoding="utf-8", newline="\n")

copied: dict[str, str] = {}
for item in items:
    for field in ("cell_image", "conflict_image"):
        raw = item.get(field)
        if not raw:
            continue
        p = Path(raw)
        copied[str(p)] = f"images/{p.parent.name}/{p.name}"

zip_md = build_markdown(items, lambda path: f"images/{path.parent.name}/{path.name}")
readme = (
    "人工核验包（Markdown）\n"
    "\n"
    "1. 解压后打开 manual-review.md（VS Code / Typora / Obsidian 均可）。\n"
    "2. 只填每项末尾的 decision、note：通过 / 驳回 / 跳过。\n"
    "3. 不要改 key，不要改写公式栏原文。\n"
    f"4. 共 {len(items)} 条。思政课未收入。\n"
    "5. 机器清单仍是 human-queue.json。\n"
)
manifest = {
    "contract_version": "legacy-human-queue-markdown-v1",
    "status": "awaiting_human_decisions",
    "counts": {
        "tasks": len(items),
        "auto_approved_cells": queue.get("auto_approved_cells", 0),
        "image_links": len(copied),
        "unique_source_images": len(copied),
    },
    "artifact": {
        "path": "manual-review.md",
        "bytes": len(zip_md.encode("utf-8")),
        "sha256": hashlib.sha256(zip_md.encode("utf-8")).hexdigest(),
    },
}

out_zip.unlink(missing_ok=True)
with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("README.txt", readme)
    zf.writestr("manual-review.md", zip_md)
    zf.writestr("human-queue.json", json.dumps(queue, ensure_ascii=False, indent=2) + "\n")
    zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    for src_path, dest in copied.items():
        zf.write(src_path, dest)

print(json.dumps({
    "markdown": str(src / "manual-review.md"),
    "zip": str(out_zip),
    "bytes": out_zip.stat().st_size,
    "items": len(items),
    "images": len(copied),
}, ensure_ascii=False))
