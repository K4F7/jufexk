import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, r"D:\19016\Documents\Workload\jufexk\scripts\legacy_ocr")
from map_catalog_identities import catalog_indexes, match_identity, verified_catalog

catalog_root = Path(r"D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2")
evals = [json.loads(l) for l in Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5\evaluations.jsonl").read_text(encoding="utf-8").splitlines() if l]
excluded = [json.loads(l) for l in Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v1\excluded.jsonl").read_text(encoding="utf-8").splitlines() if l]
_, _, rows = verified_catalog(catalog_root)
courses, teachers, relations, course_names, teacher_names = catalog_indexes(rows)
by_key = {r["key"]: r for r in evals}

UMBRELLA = {"体育1", "体育2", "体育3", "体育4", "体育Ⅰ（留）", "体育Ⅱ（留）", "体育1（留）", "体育2（留）"}
VISIBLE = {
    "足球69": "足球",
    "散打上课": "散打",
}

def family(name: str) -> str:
    value = name or ""
    value = value.replace("专项理论与实践", "")
    while value and value[-1] in "123456ⅠⅡⅢⅣⅤⅥ":
        value = value[:-1]
    return value

pe_rel = defaultdict(list)
for code, label in relations:
    name = courses[code].get("currentName") or ""
    if name in UMBRELLA:
        continue
    if str(code).startswith("100500") or family(name) in {"羽毛球", "武术", "体育舞蹈", "足球", "健美操", "跆拳道", "轮滑", "散打", "乒乓球", "篮球", "网球", "击剑", "排球"}:
        pe_rel[label].append((code, name, family(name)))

pe_excl = [r for r in excluded if r["worksheet"] == "体育课" and r["reason"] == "catalog_identity_unmatched"]
c = Counter()
for row in pe_excl:
    src = by_key[row["key"]]
    visible = VISIBLE.get(src["course"], src["course"])
    teacher, _, _ = match_identity(src.get("teacher") or "", teacher_names, "sourceTeacherLabel")
    if not teacher:
        c["no_teacher"] += 1
        continue
    hits = [item for item in pe_rel.get(teacher["sourceTeacherLabel"], []) if item[2] == visible or item[1] == visible]
    all_hits = pe_rel.get(teacher["sourceTeacherLabel"], [])
    unique_all = {(code, fam) for code, name, fam in all_hits}
    unique_fam = {code for code, name, fam in all_hits if fam == visible or name == visible}
    if len(unique_fam) == 1:
        c["unique_family"] += 1
    elif len({fam for _, _, fam in all_hits}) == 1 and len(all_hits) >= 1:
        c["one_specialty_multi_code"] += 1
        if c["one_specialty_multi_code"] <= 6:
            print("one specialty multi", src["teacher"], visible, all_hits)
    elif len(unique_fam) == 0:
        # unique among all non-umbrella?
        fams = {fam for _, _, fam in all_hits}
        if len(fams) == 1:
            c["unique_any_specialty"] += 1
            print("any specialty", src["teacher"], visible, "->", all_hits)
        else:
            c["no_family_match"] += 1
            if c["no_family_match"] <= 8:
                print("no family", src["teacher"], visible, all_hits)
    else:
        c["multi_family"] += 1
        if c["multi_family"] <= 8:
            print("multi family", src["teacher"], visible, hits or all_hits)
print(dict(c), "pe cells", len(pe_excl))
