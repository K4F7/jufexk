import json
from collections import Counter, defaultdict
from pathlib import Path

v5 = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5\evaluations.jsonl")
excl = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v2\excluded.jsonl")
ids = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v2\catalog-identity-excluded.jsonl")
ctx = json.loads(Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\full-matrix-ocr-20260819-v1\context-index.json").read_text(encoding="utf-8"))
evals = [json.loads(l) for l in v5.read_text(encoding="utf-8").splitlines() if l]
excluded = [json.loads(l) for l in excl.read_text(encoding="utf-8").splitlines() if l]
identities = [json.loads(l) for l in ids.read_text(encoding="utf-8").splitlines() if l]
ctx_by = {(r["worksheet"], r["row"]): r for r in ctx["context_index"]}

TEACHER_COL = {
    "主要课程": "E", "数学课": "C", "美育": "D", "大英和视听说": "E",
    "思政课": "F", "外教": "E", "MOOC": "F", "体育课": "B",
}

empty = [r for r in excluded if r["reason"] == "missing_teacher"]
rows = {}
for r in empty:
    key = (r["worksheet"], r["source_row"])
    rows.setdefault(key, {"keys": [], "course": None, "col": TEACHER_COL[r["worksheet"]]})
    rows[key]["keys"].append(r["key"])
    src = next(e for e in evals if e["key"] == r["key"])
    rows[key]["course"] = src.get("course")

print("EMPTY_ROWS", len(rows), "CELLS", len(empty))
for (ws, row), info in sorted(rows.items(), key=lambda x: (x[0][0], x[0][1])):
    c = ctx_by.get((ws, row), {})
    print(f"| {ws} | {row} | {info['col']}{row} | {info['course']} | {len(info['keys'])} |")

print("\nENGLISH unmatched teachers")
en = next(x for x in identities if x["legacy_source_label"] == "大英和视听说")
by_teacher = Counter()
for key in en["keys"]:
    src = next(e for e in evals if e["key"] == key)
    by_teacher[src.get("teacher") or ""] += 1
for name, n in by_teacher.most_common():
    print(f"| {name} | {n} |")
