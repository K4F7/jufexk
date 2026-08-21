import json
from pathlib import Path

root = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v2")
excluded = [json.loads(l) for l in (root/"excluded.jsonl").read_text(encoding="utf-8").splitlines() if l]
missing = [r for r in excluded if r["reason"]=="missing_teacher"]
print("missing_teacher", len(missing))
rows = {}
for r in missing:
    key = (r["worksheet"], r["source_row"])
    rows.setdefault(key, []).append(r["key"])
print("unique rows", len(rows))
for (ws, row), keys in sorted(rows.items(), key=lambda x: (x[0][0], x[0][1])):
    print(f"{ws}|{row} cells={len(keys)} keys={keys}")
