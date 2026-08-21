import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, r"D:\19016\Documents\Workload\jufexk\scripts\legacy_ocr")
from map_catalog_identities import catalog_indexes, match_identity, normalize_source_label, verified_catalog

v5 = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5")
catalog_root = Path(r"D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2")
prod = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs")

manifest = json.loads((v5 / "manifest.json").read_text(encoding="utf-8"))
evals = [json.loads(line) for line in (v5 / "evaluations.jsonl").read_text(encoding="utf-8").splitlines() if line]
print("v5 rows", len(evals), "declared", manifest["files"]["evaluations.jsonl"]["rows"])
print(
    "sha ok",
    hashlib.sha256((v5 / "evaluations.jsonl").read_bytes()).hexdigest()
    == manifest["files"]["evaluations.jsonl"]["sha256"],
)

imported_keys = set()


def ingest(path: Path, kind: str) -> None:
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        imported_keys.add(f"{row.get('worksheet')}|{row.get('source_row')}|{row.get('source_column')}")
        count += 1
    print("imported", kind, count)


ingest(prod / "frozen-historical-production-v2" / "importable-legacy-reviews.jsonl", "522")
ingest(prod / "frozen-historical-issue111-v1" / "importable-legacy-reviews.jsonl", "164")
ingest(prod / "issue111-isolated-usable-v1" / "reviews.jsonl", "120")
ingest(prod / "issue111-isolated-shorthand-v1" / "reviews.jsonl", "12")
ingest(prod / "issue111-pe-course-teacher-v1" / "reviews.jsonl", "64")
print("unique imported keys", len(imported_keys))

_cat_manifest, cat_sha, rows = verified_catalog(catalog_root)
print("catalog", _cat_manifest["counts"], "manifest_sha", cat_sha)
courses, teachers, relations, course_names, teacher_names = catalog_indexes(rows)

teacher_sports: dict[str, set[str]] = defaultdict(set)
for code, label in relations:
    if courses[code].get("category") == "sports":
        teacher_sports[label].add(code)

buckets: Counter[str] = Counter()
unmatched_courses: Counter[str] = Counter()
unmatched_teachers: Counter[str] = Counter()
methods: Counter[str] = Counter()

for row in evals:
    worksheet, source_row, column = row["worksheet"], row["row"], row["column"]
    if f"{worksheet}|{source_row}|{column}" in imported_keys:
        buckets["replay"] += 1
        continue
    course_name = row["course"] or ""
    teacher_name = row["teacher"] or ""
    course, course_method, _course_cands = match_identity(course_name, course_names, "currentName")
    teacher, teacher_method, _teacher_cands = match_identity(teacher_name, teacher_names, "sourceTeacherLabel")
    pair_course_candidates = course_names.get(normalize_source_label(course_name), [])
    exact_pair = [candidate for candidate in pair_course_candidates if candidate.get("currentName") == course_name]
    pair_course_candidates = exact_pair or pair_course_candidates
    if teacher and course is None:
        relation_matches = [
            candidate
            for candidate in pair_course_candidates
            if (candidate["courseCode"], teacher["sourceTeacherLabel"]) in relations
        ]
        if len(relation_matches) == 1:
            course, course_method = relation_matches[0], "pair_relation_unique"
    if not course or not teacher:
        if not course:
            unmatched_courses[course_name] += 1
            buckets["unmatched_course"] += 1
        if not teacher:
            unmatched_teachers[teacher_name] += 1
            buckets["unmatched_teacher"] += 1
        continue
    methods[course_method] += 1
    pair = (course["courseCode"], teacher["sourceTeacherLabel"])
    if pair in relations:
        buckets["importable"] += 1
    else:
        buckets["pending_relation"] += 1

print("buckets", dict(buckets))
print("course methods", dict(methods))
print("unmatched courses:")
for name, count in unmatched_courses.most_common():
    print(f"  {count:3d} {name!r} cands={len(course_names.get(normalize_source_label(name), []))}")
print("unmatched teachers:")
for name, count in unmatched_teachers.most_common():
    print(f"  {count:3d} {name!r} cands={len(teacher_names.get(normalize_source_label(name), []))}")
