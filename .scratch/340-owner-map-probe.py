import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, r"D:\19016\Documents\Workload\jufexk\scripts\legacy_ocr")
from map_catalog_identities import catalog_indexes, match_identity, normalize_source_label, verified_catalog

v5 = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5")
excluded_path = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v1\excluded.jsonl")
catalog_root = Path(r"D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2")
context_candidates = [
    Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\live-layout-context-20260819-v1"),
    Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\full-matrix-freeze-20260819-v1"),
]

evals = [json.loads(line) for line in (v5 / "evaluations.jsonl").read_text(encoding="utf-8").splitlines() if line]
by_key = {row["key"]: row for row in evals}
excluded = [json.loads(line) for line in excluded_path.read_text(encoding="utf-8").splitlines() if line]
_manifest, _sha, rows = verified_catalog(catalog_root)
courses, teachers, relations, course_names, teacher_names = catalog_indexes(rows)

OFFICIAL = {
    "毛概": "毛泽东思想和中国特色社会主义理论体系概论",
    "马原": "马克思主义基本原理",
    "近代史": "中国近现代史纲要",
    "思修": "思想道德与法治",
    "习概": "习近平新时代中国特色社会主义思想概论",
    "形势与政策": "形势与政策",
}

print("=== official alias uniqueness ===")
for short, official in OFFICIAL.items():
    exact = [c for c in courses.values() if c.get("currentName") == official]
    contains = [c for c in courses.values() if official in (c.get("currentName") or "")]
    print(f"{short} -> {official!r} exact={len(exact)} contains={len(contains)}")
    for c in exact[:8]:
        print(f"   {c['courseCode']} {c['currentName']}")

# English course families
EN_PREFIXES = ("大学英语", "英语视听说", "视听说", "学术英语视听说")
en_courses = []
for c in courses.values():
    name = c.get("currentName") or ""
    if any(name.startswith(p) or p in name for p in ("大学英语", "英语视听说")):
        en_courses.append(c)
print("\nenglish-ish courses", len(en_courses))

# teacher unique among english
teacher_en = defaultdict(set)
for code, label in relations:
    name = courses[code].get("currentName") or ""
    if name.startswith("大学英语") or name.startswith("英语视听说") or name.startswith("视听说"):
        teacher_en[label].add(code)

empty = [row for row in excluded if row["reason"] == "missing_teacher"]
print("\nempty teacher keys", len(empty))
print("empty by sheet", Counter(row["worksheet"] for row in empty))

# same-row teachers in v5
empty_recover = Counter()
for row in empty:
    ws, r, col = row["worksheet"], row["source_row"], row["source_column"]
    same = [e for e in evals if e["worksheet"] == ws and e["row"] == r and (e.get("teacher") or "").strip()]
    teachers_same = sorted({e["teacher"] for e in same})
    if len(teachers_same) == 1:
        empty_recover["unique_same_row"] += 1
    elif teachers_same:
        empty_recover["conflict_same_row"] += 1
        if empty_recover["conflict_same_row"] <= 8:
            print(" conflict", row["key"], teachers_same)
    else:
        empty_recover["no_same_row_teacher"] += 1
print("empty recover", dict(empty_recover))

# list empty keys with no same-row teacher
print("\nempty with no same-row teacher:")
for row in empty:
    ws, r = row["worksheet"], row["source_row"]
    same = [e for e in evals if e["worksheet"] == ws and e["row"] == r and (e.get("teacher") or "").strip()]
    if not same:
        print(" ", row["key"], "course=", by_key.get(row["key"], {}).get("course"))

# PE: teacher unique 100500* or family
print("\n=== PE unique among 100500* ===")
pe_by_teacher = defaultdict(set)
for code, label in relations:
    if str(code).startswith("100500"):
        pe_by_teacher[label].add((code, courses[code].get("currentName")))
unique_pe = {k: v for k, v in pe_by_teacher.items() if len(v) == 1}
print("pe teachers", len(pe_by_teacher), "unique", len(unique_pe))

# For excluded PE course names, can we bind?
pe_names = ["武术", "体育舞蹈", "足球69", "羽毛球", "健美操", "跆拳道", "轮滑", "散打上课", "乒乓球"]
print("\nPE excluded cells by teacher uniqueness:")
pe_excl = [row for row in excluded if row["worksheet"] == "体育课" and row["reason"] == "catalog_identity_unmatched"]
pe_teacher_bind = Counter()
for row in pe_excl:
    src = by_key[row["key"]]
    teacher, method, _ = match_identity(src.get("teacher") or "", teacher_names, "sourceTeacherLabel")
    if not teacher:
        pe_teacher_bind["teacher_unmatched"] += 1
        continue
    hits = pe_by_teacher.get(teacher["sourceTeacherLabel"], set())
    if len(hits) == 1:
        pe_teacher_bind["unique_pe_course"] += 1
    elif len(hits) == 0:
        pe_teacher_bind["teacher_no_pe"] += 1
    else:
        pe_teacher_bind["teacher_multi_pe"] += 1
        if pe_teacher_bind["teacher_multi_pe"] <= 10:
            print("  multi", src["teacher"], src["course"], hits)
print(dict(pe_teacher_bind))

print("\n=== 大英 excluded by unique english relation ===")
en_excl = [row for row in excluded if row["worksheet"] == "大英和视听说" and row["reason"] == "catalog_identity_unmatched"]
en_bind = Counter()
for row in en_excl:
    src = by_key[row["key"]]
    teacher, method, _ = match_identity(src.get("teacher") or "", teacher_names, "sourceTeacherLabel")
    if not teacher:
        en_bind["teacher_unmatched"] += 1
        continue
    hits = teacher_en.get(teacher["sourceTeacherLabel"], set())
    if len(hits) == 1:
        en_bind["unique_en"] += 1
        code = next(iter(hits))
        if en_bind["unique_en"] <= 8:
            print("  unique", src["teacher"], courses[code]["currentName"], code)
    elif len(hits) == 0:
        en_bind["teacher_no_en"] += 1
        if en_bind["teacher_no_en"] <= 8:
            print("  no-en", src["teacher"], src.get("course"))
    else:
        en_bind["teacher_multi_en"] += 1
        names = sorted(courses[c]["currentName"] for c in hits)
        if en_bind["teacher_multi_en"] <= 8:
            print("  multi", src["teacher"], names)
print(dict(en_bind))
