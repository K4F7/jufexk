from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from compile_production_staging import read_jsonl, sha256, write_json, write_jsonl


SECTION = re.compile(r"^## \d+ · (course-[0-9a-f]+)$", re.M)
NOTE = re.compile(r"^### 处理意见：(.*)$", re.M)


def interpreted_note(note: str, source_name: str) -> tuple[str, str]:
    value = note.strip()
    if not value or value in {"对", "没问题"} or "课名没错字" in value or "历史课名导入正确" in value:
        return source_name, "owner_confirmed_source_name"
    match = re.search(r"行是(.+)$", value)
    if match:
        return match.group(1).strip(), "owner_corrected_name"
    if value == "历史名不全，需要补充":
        return source_name, "owner_preserved_incomplete_name"
    return value, "owner_corrected_or_confirmed_name"


def compile_decisions(review: Path, courses_path: Path, automatic_path: Path, overrides_path: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    text = review.read_text(encoding="utf-8")
    starts = list(SECTION.finditer(text))
    courses = {row["course_id"]: row for row in read_jsonl(courses_path)}
    automatic = {row["legacy_identity_id"]: row for row in read_jsonl(automatic_path)}
    overrides = {row["legacy_identity_id"]: row for row in read_jsonl(overrides_path)}
    if set(automatic) & set(overrides):
        raise ValueError("duplicate automatic course decision")
    compiled = []
    for index, match in enumerate(starts):
        legacy_id = match.group(1)
        block = text[match.end(): starts[index + 1].start() if index + 1 < len(starts) else len(text)]
        note_match = NOTE.search(block)
        if not note_match or legacy_id not in courses:
            raise ValueError(f"invalid review section: {legacy_id}")
        query, basis = interpreted_note(note_match.group(1), courses[legacy_id]["name"])
        resolved = overrides.get(legacy_id)
        compiled.append({
            "schema_version": "legacy-missing-catalog-course-decision-v1", "task": index + 1,
            "legacy_course_id": legacy_id, "decision": "bind_existing_course" if resolved else "preserve_pending_course_code",
            "catalog_course_code": resolved["catalog_course_code"] if resolved else None,
            "approved_course_query": query, "interpretation_basis": basis, "owner_note": note_match.group(1).strip(),
        })
    if len(compiled) != 39:
        raise ValueError("review task count mismatch")
    out.mkdir(parents=True)
    artifact = write_jsonl(out / "compiled-decisions.jsonl", compiled)
    counts = {
        "review_tasks": len(compiled), "newly_bound_existing_course": sum(row["decision"] == "bind_existing_course" for row in compiled),
        "preserve_pending_course_code": sum(row["decision"] == "preserve_pending_course_code" for row in compiled),
        "previously_auto_resolved_courses": len(automatic), "total_bound_existing_course": len(automatic) + len(overrides),
    }
    manifest = {
        "contract_version": "legacy-missing-catalog-course-decisions-manifest-v1", "status": "compiled",
        "source_owner_review_sha256": sha256(review), "source_courses_sha256": sha256(courses_path),
        "source_automatic_decisions_sha256": sha256(automatic_path), "source_evidence_overrides_sha256": sha256(overrides_path),
        "counts": counts, "files": {"compiled-decisions.jsonl": artifact},
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("review", "courses", "automatic", "overrides", "out"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    result = compile_decisions(Path(args.review), Path(args.courses), Path(args.automatic), Path(args.overrides), Path(args.out))
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
