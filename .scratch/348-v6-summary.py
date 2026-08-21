import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

v4 = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v4")
v6 = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v6")

def load(root):
    man = json.loads((root/"manifest.json").read_text(encoding="utf-8"))
    ex = [json.loads(l) for l in (root/"excluded.jsonl").read_text(encoding="utf-8").splitlines() if l]
    imp = [json.loads(l) for l in (root/"importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines() if l]
    ident = [json.loads(l) for l in (root/"catalog-identity-excluded.jsonl").read_text(encoding="utf-8").splitlines() if l]
    pending = [json.loads(l) for l in (root/"catalog-relation-pending.jsonl").read_text(encoding="utf-8").splitlines() if l]
    sha = hashlib.sha256((root/"manifest.json").read_bytes()).hexdigest()
    return man, ex, imp, ident, pending, sha

m4, e4, i4, id4, p4, h4 = load(v4)
m6, e6, i6, id6, p6, h6 = load(v6)
print("v4", m4["counts"], "manifest", h4)
print("v6", m6["counts"], "manifest", h6)
print("v4 missing", sum(1 for r in e4 if r["reason"]=="missing_teacher"))
print("v6 missing", sum(1 for r in e6 if r["reason"]=="missing_teacher"))
print("v6 reasons", Counter(r["reason"] for r in e6))

def status(rows_ex, rows_imp, rows_pend, ws, row):
    ex = [r for r in rows_ex if r.get("worksheet")==ws and r.get("source_row")==row]
    imp = [r for r in rows_imp if r.get("worksheet")==ws and r.get("source_row")==row]
    keys = []
    for item in rows_pend:
        for k in item.get("keys") or []:
            parts = k.split("|")
            if parts[0]==ws and int(parts[1])==row:
                keys.append((k, item.get("catalog_course_code"), item.get("catalog_teacher_label")))
    return {
        "ex": [(r["key"], r["reason"], r.get("legacy_teacher_name"), r.get("detail")) for r in ex],
        "imp": [(f"{r['worksheet']}|{r['source_row']}|{r['source_column']}", r["catalog_course_code"], r["catalog_teacher_label"], r.get("decision_basis")) for r in imp],
        "pend": keys,
    }

targets = [
    ("MOOC", 8), ("MOOC", 17), ("MOOC", 18),
    ("主要课程", 56), ("主要课程", 111), ("主要课程", 153), ("主要课程", 155),
    ("主要课程", 271), ("主要课程", 395), ("主要课程", 397), ("主要课程", 433),
    ("主要课程", 437), ("主要课程", 453), ("主要课程", 472),
    ("体育课", 21), ("体育课", 23),
    ("外教", 3), ("外教", 6),
    ("大英和视听说", 17), ("大英和视听说", 67),
    ("思政课", 50), ("思政课", 51), ("思政课", 52), ("思政课", 53), ("思政课", 54), ("思政课", 55),
]
print("\n=== v6 target rows ===")
for ws, row in targets:
    s = status(e6, i6, p6, ws, row)
    print(f"{ws}|{row} imp={s['imp']} pend={s['pend']} ex={s['ex']}")

print("\n=== new unmatched identities ===")
old = {(r["identity_kind"], r["legacy_source_label"]) for r in id4}
for r in id6:
    key = (r["identity_kind"], r["legacy_source_label"])
    if key not in old:
        print(r["identity_kind"], repr(r["legacy_source_label"]), r.get("reason"), "keys", r.get("keys"))
