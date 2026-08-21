import hashlib
import json
from collections import Counter
from pathlib import Path

root = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v2")
print("manifest", hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest())
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
print("importable sha", manifest["files"]["importable-legacy-reviews.jsonl"]["sha256"])
print(manifest["counts"])
excluded = [json.loads(l) for l in (root / "excluded.jsonl").read_text(encoding="utf-8").splitlines() if l]
print("excluded reasons", Counter(r["reason"] for r in excluded))
print("excluded sheets", Counter(r["worksheet"] for r in excluded))
ids = [json.loads(l) for l in (root / "catalog-identity-excluded.jsonl").read_text(encoding="utf-8").splitlines() if l]
print("\nremaining course labels:")
for row in ids:
    if row["identity_kind"] == "course":
        print(f"  {len(row['keys']):3d} {row['legacy_source_label']!r} {row['reason']}")
print("\nremaining teacher labels:")
for row in ids:
    if row["identity_kind"] == "teacher":
        print(f"  {len(row['keys']):3d} {row['legacy_source_label']!r}")
pending = [json.loads(l) for l in (root / "catalog-relation-pending.jsonl").read_text(encoding="utf-8").splitlines() if l]
print("\npending")
for row in pending:
    print(f"  {len(row['keys']):3d} {row['catalog_course_code']} {row['catalog_teacher_label']}")
imp = [json.loads(l) for l in (root / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines() if l]
print("importable sheets", Counter(r["worksheet"] for r in imp))
print("importable basis", Counter(r["decision_basis"] for r in imp))
