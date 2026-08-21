import json
from pathlib import Path

freeze = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\full-matrix-freeze-20260819-v1\evidence")
full = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\formula-bar-full-20260729-v1\evidence")
excluded = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v1\excluded.jsonl")
context = json.loads(Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\full-matrix-ocr-20260819-v1\context-index.json").read_text(encoding="utf-8"))

TEACHER_COL = {
    "主要课程": "E",
    "数学课": "C",
    "美育": "D",
    "大英和视听说": "E",
    "思政课": "F",
    "外教": "E",
    "MOOC": "F",
    "体育课": "B",
}

ctx = {(row["worksheet"], row["row"]): row for row in context["context_index"]}
empty_rows = []
for line in excluded.read_text(encoding="utf-8").splitlines():
    row = json.loads(line)
    if row["reason"] != "missing_teacher":
        continue
    empty_rows.append((row["worksheet"], row["source_row"], row["key"]))

seen = set()
for worksheet, source_row, key in empty_rows:
    pair = (worksheet, source_row)
    if pair in seen:
        continue
    seen.add(pair)
    col = TEACHER_COL[worksheet]
    names = []
    for root, label in ((freeze, "freeze"), (full, "full")):
        path = root / worksheet / f"{col}{source_row}.json"
        if path.is_file():
            rec = json.loads(path.read_text(encoding="utf-8"))
            value = rec.get("formula_bar_value") or rec.get("formula_bar") or rec.get("text")
            names.append(f"{label}={value!r} status={rec.get('terminal_status')}")
        else:
            names.append(f"{label}=MISSING")
    c = ctx.get(pair, {})
    print(f"{worksheet}|{source_row} ctx_teacher={c.get('teacher')!r} ctx_course={c.get('course')!r} {' | '.join(names)}")
print("unique empty rows", len(seen), "cells", len(empty_rows))
