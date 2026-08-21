import hashlib
import json
from pathlib import Path

package = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v1")
source = Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5")
manifest_text = (package / "manifest.json").read_bytes()
print("manifest_sha", hashlib.sha256(manifest_text).hexdigest())
rows = [json.loads(line) for line in (package / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines() if line]
src = [json.loads(line) for line in (source / "evaluations.jsonl").read_text(encoding="utf-8").splitlines() if line]
by_key = {row["key"]: row for row in src}
mismatch = 0
for row in rows:
    key = f"{row['worksheet']}|{row['source_row']}|{row['source_column']}"
    source_row = by_key[key]
    if hashlib.sha256(source_row["body"].encode()).hexdigest() != source_row["formula_bar_text_sha256"]:
        mismatch += 1
    if row["comment"] != source_row["body"]:
        mismatch += 1
print("importable", len(rows), "body_mismatch", mismatch)
excluded = [json.loads(line) for line in (package / "excluded.jsonl").read_text(encoding="utf-8").splitlines() if line]
print("excluded_has_comment", any("comment" in row for row in excluded))
print("excluded_reasons", sorted({row["reason"] for row in excluded}))
print("worksheets", sorted({row["worksheet"] for row in rows}))
