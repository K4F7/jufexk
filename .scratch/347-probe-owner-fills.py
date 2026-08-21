import json
from collections import defaultdict
from pathlib import Path

catalog = Path(r"D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2\catalog-baseline.jsonl")
evals = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5\evaluations.jsonl")
v4_ex = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v4\excluded.jsonl")

courses = []
teachers = []
relations = []
for line in catalog.read_text(encoding="utf-8").splitlines():
    if not line:
        continue
    rec = json.loads(line)
    value = rec.get("value") or {}
    kind = rec.get("recordType")
    if kind == "course":
        courses.append(value)
    elif kind == "teacher":
        teachers.append(value)
    elif kind == "relation":
        relations.append(value)

def norm(s):
    return "".join(str(s).split()).casefold()

needles = ["樊凤龙", "李珺", "王云", "Christine", "carl", "Carl", "CARL"]
print("=== teachers ===")
for t in teachers:
    label = t.get("sourceTeacherLabel") or ""
    if any(norm(n) in norm(label) or norm(label) in norm(n) for n in needles) or label in needles:
        print(repr(label))

print("\n=== courses 常见急救 / 民歌 / 诗词 / 剪纸 / 高级口语 / 学术英语 ===")
keys = ("急救", "民歌", "诗词", "剪纸", "高级口语", "学术英语", "中国金融")
hits = []
for c in courses:
    name = c.get("currentName") or ""
    if any(k in name for k in keys):
        hits.append(c)
        print(c.get("courseCode"), repr(name))

print("\n=== relations for those courses ===")
codes = {c["courseCode"] for c in hits}
by_code = defaultdict(list)
for r in relations:
    if r.get("courseCode") in codes:
        by_code[r["courseCode"]].append(r.get("sourceTeacherLabel"))
for code in sorted(codes):
    names = sorted({n for n in by_code[code] if n})
    course_name = next(c["currentName"] for c in courses if c["courseCode"] == code)
    print(f"{code} {course_name!r} teachers={len(names)} {names[:20]}")

print("\n=== 常见急救知识 unique? ===")
first_aid = [c for c in courses if "急救" in (c.get("currentName") or "")]
for c in first_aid:
    rels = [r.get("sourceTeacherLabel") for r in relations if r.get("courseCode") == c["courseCode"]]
    print(c["courseCode"], c["currentName"], "n_rel", len(rels), "unique_teachers", sorted(set(rels)))

print("\n=== v5 evals for target rows ===")
want = {
    ("MOOC", 8), ("MOOC", 17), ("MOOC", 18),
    ("主要课程", 56), ("主要课程", 111), ("主要课程", 153), ("主要课程", 155),
    ("主要课程", 271), ("主要课程", 395), ("主要课程", 397), ("主要课程", 433),
    ("主要课程", 437), ("主要课程", 453), ("主要课程", 472),
    ("体育课", 21), ("体育课", 23),
    ("外教", 3), ("外教", 6),
    ("大英和视听说", 17), ("大英和视听说", 67),
    ("思政课", 50), ("思政课", 51), ("思政课", 52), ("思政课", 53), ("思政课", 54), ("思政课", 55),
}
for line in evals.read_text(encoding="utf-8").splitlines():
    row = json.loads(line)
    key = (row.get("worksheet"), row.get("row"))
    if key in want:
        print(f"{row['key']} course={row.get('course')!r} teacher={row.get('teacher')!r}")

print("\n=== v4 missing_teacher still? ===")
missing = 0
for line in v4_ex.read_text(encoding="utf-8").splitlines():
    row = json.loads(line)
    if row.get("reason") == "missing_teacher":
        missing += 1
print("v4 missing_teacher", missing)
