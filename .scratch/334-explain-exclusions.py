import json
from collections import Counter
from pathlib import Path

root = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v1")
excluded = [json.loads(line) for line in (root / "excluded.jsonl").read_text(encoding="utf-8").splitlines() if line]
ids = [json.loads(line) for line in (root / "catalog-identity-excluded.jsonl").read_text(encoding="utf-8").splitlines() if line]
pending = [json.loads(line) for line in (root / "catalog-relation-pending.jsonl").read_text(encoding="utf-8").splitlines() if line]
lineage = [json.loads(line) for line in (root / "lineage.jsonl").read_text(encoding="utf-8").splitlines() if line]
importable = [json.loads(line) for line in (root / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines() if line]

print("excluded reasons", Counter(row["reason"] for row in excluded))
print("excluded details", Counter(row.get("detail", "") for row in excluded).most_common())
print("excluded worksheets", Counter(row["worksheet"] for row in excluded))
print("lineage partitions", Counter(row["partition"] for row in lineage))
print("importable worksheets", Counter(row["worksheet"] for row in importable))
print("importable basis", Counter(row["decision_basis"] for row in importable))

print("\ncourse labels by cell count:")
for row in ids:
    if row["identity_kind"] != "course":
        continue
    print(f"  {len(row['keys']):3d}  {row['legacy_source_label']!r}  {row['reason']}")

print("\nteacher labels by cell count:")
for row in ids:
    if row["identity_kind"] != "teacher":
        continue
    print(f"  {len(row['keys']):3d}  {row['legacy_source_label']!r}  {row['reason']}")

print("\npending pairs:")
for row in pending:
    print(f"  {len(row['keys']):3d}  {row['catalog_course_code']} x {row['catalog_teacher_label']}")

missing_teacher = [row for row in excluded if row["reason"] == "missing_teacher"]
print("\nmissing_teacher", len(missing_teacher), Counter(row["worksheet"] for row in missing_teacher))
already = [row for row in excluded if row["reason"] == "already_imported"]
print("already_imported", len(already), [row["key"] for row in already])
