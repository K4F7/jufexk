from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from compile_production_staging import read_jsonl, sha256, write_json, write_jsonl
from map_catalog_identities import normalize_source_label, verified_catalog


def rank(provenance: list[dict[str, Any]], identity: str) -> tuple[int, str, str]:
    return len(provenance), max((str(item.get("semester", "")) for item in provenance), default=""), identity


def compile_owner_decisions(exceptions_path: Path, decisions_path: Path, review_path: Path, catalog_root: Path, evaluations_path: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    exceptions = read_jsonl(exceptions_path)
    decisions = read_jsonl(decisions_path)
    expected = {(row["legacy_course_id"], row["legacy_teacher_id"]) for row in exceptions}
    actual = {(row["legacy_course_id"], row["legacy_teacher_id"]) for row in decisions}
    if len(expected) != len(exceptions) or len(actual) != len(decisions) or actual != expected:
        raise ValueError("owner decision set does not exactly match manual exceptions")
    if sorted(row.get("task") for row in decisions) != list(range(1, len(decisions) + 1)):
        raise ValueError("owner decision task numbers are incomplete")

    _catalog_manifest, catalog_manifest_sha, catalog_rows = verified_catalog(catalog_root)
    courses: dict[str, dict[str, Any]] = {}
    course_codes_by_name: dict[str, set[str]] = defaultdict(set)
    teacher_labels = set()
    relations: dict[tuple[str, str], dict[str, Any]] = {}
    course_provenance: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in catalog_rows:
        value = record["value"]
        if record["recordType"] == "course":
            code = value["courseCode"]
            courses[code] = value
            names = {value["currentName"], *(item["rawName"] for item in value.get("nameVariants") or [])}
            for name in names:
                course_codes_by_name[normalize_source_label(name)].add(code)
        elif record["recordType"] == "teacher":
            teacher_labels.add(value["sourceTeacherLabel"])
        else:
            pair = (value["courseCode"], value["sourceTeacherLabel"])
            relations[pair] = value
            course_provenance[pair[0]].extend(value.get("provenance") or [])
    evaluation_counts = Counter((row["course_id"], row["teacher_id"]) for row in read_jsonl(evaluations_path))

    compiled = []
    for decision in sorted(decisions, key=lambda row: row["task"]):
        pair = (decision["legacy_course_id"], decision["legacy_teacher_id"])
        action = decision.get("action")
        if action == "reject":
            compiled.append({
                "schema_version": "legacy-owner-manual-decision-v1", "task": decision["task"],
                "legacy_course_id": pair[0], "legacy_teacher_id": pair[1], "decision": "reject",
                "owner_note": decision["owner_note"], "api_ready_evaluations": evaluation_counts[pair],
            })
            continue
        if action not in {"correct_and_preserve", "evidence_inferred_and_preserve", "split_and_preserve"}:
            raise ValueError(f"unsupported owner action: {action}")
        query = normalize_source_label(decision["course_query"])
        candidate_codes = sorted({
            code for name, codes in course_codes_by_name.items()
            if query == name or query in name
            for code in codes
        })
        teacher_decisions = []
        for teacher in decision.get("teacher_labels") or []:
            exact_teacher = teacher if teacher in teacher_labels else None
            matches = [(code, teacher) for code in candidate_codes if exact_teacher and (code, teacher) in relations]
            if matches:
                selected = max(matches, key=lambda item: rank(relations[item].get("provenance") or [], item[0]))
                teacher_decisions.append({"teacher_label": teacher, "decision": "bind_existing_relation", "catalog_course_code": selected[0], "catalog_teacher_label": selected[1], "requested_additions": []})
            else:
                selected_course = max(candidate_codes, key=lambda code: rank(course_provenance[code], code)) if candidate_codes else None
                requested = []
                if selected_course is None:
                    requested.append("course_identity")
                if exact_teacher is None:
                    requested.append("teacher_identity")
                requested.append("relation")
                teacher_decisions.append({"teacher_label": teacher, "decision": "preserve_via_catalog_addition_request", "catalog_course_code": selected_course, "catalog_teacher_label": exact_teacher, "requested_additions": requested})
        if not teacher_decisions:
            raise ValueError(f"preserve decision has no teacher identities: task {decision['task']}")
        compiled.append({
            "schema_version": "legacy-owner-manual-decision-v1", "task": decision["task"],
            "legacy_course_id": pair[0], "legacy_teacher_id": pair[1],
            "decision": "split_and_preserve" if action == "split_and_preserve" else "preserve",
            "course_query": decision["course_query"], "teacher_decisions": teacher_decisions,
            "evaluation_assignment": "fan_out_with_shared_duplicate_group" if action == "split_and_preserve" else "single_target",
            "owner_note": decision["owner_note"], "api_ready_evaluations": evaluation_counts[pair],
        })

    out.mkdir(parents=True)
    artifact = write_jsonl(out / "compiled-decisions.jsonl", compiled)
    counts = {
        "tasks": len(compiled), "preserved": sum(row["decision"] == "preserve" for row in compiled),
        "split_and_preserve": sum(row["decision"] == "split_and_preserve" for row in compiled),
        "rejected": sum(row["decision"] == "reject" for row in compiled),
        "api_ready_evaluations": sum(row["api_ready_evaluations"] for row in compiled),
        "rejected_evaluations": sum(row["api_ready_evaluations"] for row in compiled if row["decision"] == "reject"),
        "fan_out_evaluations": sum(row["api_ready_evaluations"] for row in compiled if row["decision"] == "split_and_preserve"),
    }
    manifest = {
        "contract_version": "legacy-owner-manual-decisions-manifest-v1", "status": "compiled",
        "source_exceptions_sha256": sha256(exceptions_path), "source_owner_decisions_sha256": sha256(decisions_path),
        "source_owner_review_sha256": sha256(review_path), "approved_catalog_manifest_sha256": catalog_manifest_sha,
        "counts": counts, "files": {"compiled-decisions.jsonl": artifact},
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile owner-authored natural-language exception decisions")
    for name in ("exceptions", "decisions", "review", "catalog-root", "evaluations", "out"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    result = compile_owner_decisions(Path(args.exceptions), Path(args.decisions), Path(args.review), Path(args.catalog_root), Path(args.evaluations), Path(args.out))
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
