import json
from collections import Counter
from pathlib import Path

v5 = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v5")
ex = [json.loads(l) for l in (v5/"excluded.jsonl").read_text(encoding="utf-8").splitlines() if l]
imp = [json.loads(l) for l in (v5/"importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines() if l]
print("excluded reasons", Counter(r["reason"] for r in ex))
print("missing_teacher", sum(1 for r in ex if r["reason"]=="missing_teacher"))
print("v5 importable teachers sample", Counter(r["catalog_teacher_label"] for r in imp).most_common(8))
for key in ["MOOC|8|G","MOOC|18|G","主要课程|155|J","外教|3|G","外教|6|G","主要课程|153|F"]:
    e = next((r for r in ex if r.get("key")==key), None)
    i = next((r for r in imp if f"{r.get('worksheet')}|{r.get('source_row')}|{r.get('source_column')}"==key), None)
    print(key, "ex" if e else "", e.get("reason") if e else "", e.get("legacy_teacher_name") if e else "", "imp" if i else "", i.get("catalog_teacher_label") if i else "")
