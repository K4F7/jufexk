import json
from pathlib import Path

def keys(path):
    rows = [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l]
    return {row["key"] if "key" in row else f"{row['worksheet']}|{row['source_row']}|{row['source_column']}": row for row in rows}

v2 = keys(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v2\importable-legacy-reviews.jsonl")
v3 = keys(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v3\importable-legacy-reviews.jsonl")
e2 = keys(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v2\excluded.jsonl")
added = sorted(set(v3) - set(v2))
removed = sorted(set(v2) - set(v3))
print("added", len(added), "removed", len(removed))
print("sample added:")
for key in added[:20]:
    row = v3[key]
    prev = e2.get(key, {})
    print(f"  {key} course={row.get('catalog_course_code')} teacher={row.get('catalog_teacher_label')} basis={row.get('decision_basis')} was={prev.get('reason')} {prev.get('detail')} legacy_teacher={prev.get('legacy_teacher_name')!r}")
print("by worksheet")
from collections import Counter
print(Counter(k.split("|")[0] for k in added))
print("by basis")
print(Counter(v3[k].get("decision_basis") for k in added))
