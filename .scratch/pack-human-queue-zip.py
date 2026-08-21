import csv
import html
import io
import json
import zipfile
from pathlib import Path

src = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\human-queue-20260819-v1")
out_zip = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\human-queue-20260819-v1.zip")
queue = json.loads((src / "human-queue.json").read_text(encoding="utf-8"))


def rel_image(path: str) -> str:
    p = Path(path)
    return f"images/{p.parent.name}/{p.name}"


items = []
copied: dict[str, str] = {}
missing: list[str] = []
for item in queue["items"]:
    next_item = dict(item)
    for field in ("cell_image", "conflict_image"):
        raw = item.get(field)
        if not raw:
            continue
        dest = rel_image(raw)
        p = Path(raw)
        if not p.is_file():
            missing.append(str(p))
        else:
            copied[str(p)] = dest
        next_item[field] = dest
    next_item.pop("source_package", None)
    items.append(next_item)

if missing:
    raise SystemExit("missing images:\n" + "\n".join(missing[:20]))

portable = dict(queue)
portable["items"] = items
portable["portable"] = True

readme = (
    "人工核验包（可离线打开）\n"
    "\n"
    "1. 解压后打开 human-queue.html 看图和公式栏原文。\n"
    "2. 在 human-queue.csv 的「决定」列填：通过 / 驳回 / 跳过，可写备注。\n"
    "3. 不要改写「公式栏原文」。\n"
    "4. 审完把填好的 human-queue.csv 交回，用于 compile-approved。\n"
    f"5. 共 {len(items)} 条。思政课未收入（仍有待核验格）。\n"
)

buf = io.StringIO()
buf.write("\ufeff")
writer = csv.writer(buf)
writer.writerow(["键", "工作表", "行", "列", "截图", "冲突图", "公式栏原文", "课名", "教师", "未批准原因", "决定", "备注"])
for item in items:
    writer.writerow([
        item["key"],
        item["worksheet"],
        item["row"],
        item["column"],
        item["cell_image"],
        item.get("conflict_image") or "",
        item["formula_bar_value"],
        item.get("course") or "",
        item.get("teacher") or "",
        item["reason"],
        "",
        "",
    ])

rows = []
for item in items:
    img = html.escape(item["cell_image"])
    conflict = item.get("conflict_image")
    conflict_cell = (
        f'<a href="{html.escape(conflict)}"><img src="{html.escape(conflict)}" width="240"></a>'
        if conflict
        else ""
    )
    rows.append(
        "<tr>"
        f"<td>{html.escape(item['key'])}</td>"
        f"<td>{html.escape(item['worksheet'])}</td>"
        f"<td>{item['row']}</td>"
        f"<td>{html.escape(item['column'])}</td>"
        f'<td><a href="{img}"><img src="{img}" width="240" alt="cell"></a></td>'
        f"<td>{conflict_cell}</td>"
        f"<td><pre>{html.escape(item['formula_bar_value'])}</pre></td>"
        f"<td>{html.escape(item.get('course') or '')}</td>"
        f"<td>{html.escape(item.get('teacher') or '')}</td>"
        f"<td>{html.escape(item['reason'])}</td>"
        "<td></td><td></td>"
        "</tr>"
    )

page = (
    "<!doctype html><meta charset=\"utf-8\"><title>人工核验队列</title>"
    "<p>解压后用浏览器打开本页。决定请写在 human-queue.csv：通过 / 驳回 / 跳过。不要改公式栏原文。</p>"
    "<table border=\"1\" cellpadding=\"6\" cellspacing=\"0\">"
    "<thead><tr><th>键</th><th>工作表</th><th>行</th><th>列</th><th>截图</th><th>冲突图</th>"
    "<th>公式栏原文</th><th>课名</th><th>教师</th><th>未批准原因</th><th>决定</th><th>备注</th></tr></thead>"
    "<tbody>" + "\n".join(rows) + "</tbody></table>\n"
)

out_zip.unlink(missing_ok=True)
with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("README.txt", readme)
    zf.writestr("human-queue.json", json.dumps(portable, ensure_ascii=False, indent=2) + "\n")
    zf.writestr("human-queue.csv", buf.getvalue())
    zf.writestr("human-queue.html", page)
    for src_path, dest in copied.items():
        zf.write(src_path, dest)

print(json.dumps({
    "zip": str(out_zip),
    "bytes": out_zip.stat().st_size,
    "items": len(items),
    "images": len(copied),
}, ensure_ascii=False))
