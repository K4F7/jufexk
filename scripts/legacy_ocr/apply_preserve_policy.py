from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from build_identity_review_markdown import verified_evidence_path
from compile_production_staging import read_json, read_jsonl, sha256, write_json, write_jsonl
from map_catalog_identities import normalize_source_label, verified_catalog


TEACHER_SEPARATORS = re.compile(r"[、,，;；/]")


def structural_exception(course_name: str, teacher_name: str) -> str | None:
    course = normalize_source_label(course_name)
    teacher = normalize_source_label(teacher_name)
    if len(course) <= 1 or course.isdigit():
        return "course_label_fragment_or_number"
    if course.count("（") != course.count("）") or course.count("(") != course.count(")"):
        return "course_label_unbalanced_parenthesis"
    if TEACHER_SEPARATORS.search(teacher):
        return "teacher_label_contains_multiple_people"
    if any(marker in teacher for marker in ("不是", "都很好", "老师英文名")):
        return "teacher_label_is_annotation_not_identity"
    return None


def provenance_rank(provenance: list[dict[str, Any]], identity: str) -> tuple[int, str, str]:
    latest = max((str(item.get("semester", "")) for item in provenance), default="")
    return len(provenance), latest, identity


def apply_preserve_policy(mapping_root: Path, staging_root: Path, catalog_root: Path, evidence_root: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    mapping_manifest_path = mapping_root / "manifest.json"
    mapping_manifest = read_json(mapping_manifest_path)
    catalog_manifest, catalog_manifest_sha, catalog_rows = verified_catalog(catalog_root)
    if catalog_manifest_sha != mapping_manifest.get("approved_catalog_manifest_sha256"):
        raise ValueError("catalog manifest does not match mapping package")

    courses: dict[str, dict[str, Any]] = {}
    course_codes_by_name: dict[str, set[str]] = defaultdict(set)
    teacher_labels_by_name: dict[str, set[str]] = defaultdict(set)
    relations: dict[tuple[str, str], dict[str, Any]] = {}
    course_provenance: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in catalog_rows:
        value = record["value"]
        if record["recordType"] == "course":
            courses[value["courseCode"]] = value
            names = {value["currentName"], *(item["rawName"] for item in value.get("nameVariants") or [])}
            for name in names:
                course_codes_by_name[normalize_source_label(name)].add(value["courseCode"])
        elif record["recordType"] == "teacher":
            teacher_labels_by_name[normalize_source_label(value["sourceTeacherLabel"])].add(value["sourceTeacherLabel"])
        else:
            pair = (value["courseCode"], value["sourceTeacherLabel"])
            relations[pair] = value
            course_provenance[pair[0]].extend(value.get("provenance") or [])

    required = read_jsonl(staging_root / "catalog-mapping-required.jsonl")
    evaluations = read_jsonl(staging_root / "api-ready-evaluations.jsonl")
    evaluation_counts = Counter((row["course_id"], row["teacher_id"]) for row in evaluations)
    resolved = {(row["legacy_course_id"], row["legacy_teacher_id"]) for row in read_jsonl(mapping_root / "resolved-mappings.jsonl")}
    additions = {
        (course_id, teacher_id)
        for row in read_jsonl(mapping_root / "catalog-addition-requests.jsonl")
        for course_id in row["legacy_course_ids"] for teacher_id in row["legacy_teacher_ids"]
    }
    relation_evidence = {
        (row["course_id"], row["teacher_id"]): row for row in read_jsonl(staging_root / "course-teachers.jsonl")
    }
    unresolved = [row for row in required if (row["legacy_course_id"], row["legacy_teacher_id"]) not in resolved | additions]

    decisions: list[dict[str, Any]] = []
    exceptions: list[dict[str, Any]] = []
    for row in unresolved:
        legacy_pair = (row["legacy_course_id"], row["legacy_teacher_id"])
        reason = structural_exception(row["legacy_course_name"], row["legacy_teacher_name"])
        if reason:
            exceptions.append({
                "schema_version": "legacy-preserve-policy-exception-v1", "legacy_course_id": legacy_pair[0],
                "legacy_course_name": row["legacy_course_name"], "legacy_teacher_id": legacy_pair[1],
                "legacy_teacher_name": row["legacy_teacher_name"], "reason": reason,
                "api_ready_evaluations": evaluation_counts[legacy_pair], "terminal_status": "owner_review_required",
            })
            continue
        course_codes = sorted(course_codes_by_name.get(normalize_source_label(row["legacy_course_name"]), set()))
        teacher_labels = sorted(teacher_labels_by_name.get(normalize_source_label(row["legacy_teacher_name"]), set()))
        matches = [(code, label) for code in course_codes for label in teacher_labels if (code, label) in relations]
        if matches:
            selected = max(matches, key=lambda pair: provenance_rank(relations[pair].get("provenance") or [], pair[0]))
            decision = "bind_existing_relation"
            requested = []
        else:
            selected_course = max(course_codes, key=lambda code: provenance_rank(course_provenance[code], code)) if course_codes else None
            selected_teacher = teacher_labels[0] if len(teacher_labels) == 1 else None
            selected = (selected_course, selected_teacher)
            decision = "preserve_via_catalog_addition_request"
            requested = []
            if selected_course is None:
                requested.append("course_identity")
            if selected_teacher is None:
                requested.append("teacher_identity")
            requested.append("relation")
        decisions.append({
            "schema_version": "legacy-preserve-policy-decision-v1", "legacy_course_id": legacy_pair[0],
            "legacy_course_name": row["legacy_course_name"], "legacy_teacher_id": legacy_pair[1],
            "legacy_teacher_name": row["legacy_teacher_name"], "decision": decision,
            "catalog_course_code": selected[0], "catalog_teacher_label": selected[1],
            "requested_additions": requested, "selection_policy": "course_name_and_teacher_preserve_v1",
            "api_ready_evaluations": evaluation_counts[legacy_pair],
        })

    decisions.sort(key=lambda row: (row["legacy_course_id"], row["legacy_teacher_id"]))
    exceptions.sort(key=lambda row: (row["legacy_course_id"], row["legacy_teacher_id"]))
    out.mkdir(parents=True)
    decision_file = write_jsonl(out / "policy-decisions.jsonl", decisions)
    exception_file = write_jsonl(out / "manual-exceptions.jsonl", exceptions)
    lines = [
        "# 默认保留政策：最小人工例外", "",
        "> 同名课程全部保留；历史资料中有效出现的教师全部保留。这里只审核无法机械解释的结构异常。", "",
        f"剩余人工例外：**{len(exceptions)}**。", "",
    ]
    for number, item in enumerate(exceptions, 1):
        pair = (item["legacy_course_id"], item["legacy_teacher_id"])
        evidence = relation_evidence[pair]["provenance"][0]
        source = verified_evidence_path(evidence_root, evidence["context_source_file"], evidence["context_source_sha256"])
        relative = Path(os.path.relpath(source, out)).as_posix()
        lines.extend([
            f"## {number:03d} · {pair[0]} + {pair[1]}", "",
            f"历史配对：{item['legacy_course_name']} + {item['legacy_teacher_name']}", "",
            f"异常原因：`{item['reason']}`；影响 {item['api_ready_evaluations']} 条评价。", "",
            f"![原始上下文截图](<{relative}>)", "",
            "### 处理意见：", "", "", "---", "",
        ])
    review_bytes = ("\n".join(lines) + "\n").encode("utf-8")
    (out / "manual-review.md").write_bytes(review_bytes)
    counts = {
        "input_unresolved_pairs": len(unresolved), "automatic_decisions": len(decisions),
        "bind_existing_relation": sum(row["decision"] == "bind_existing_relation" for row in decisions),
        "preserve_via_catalog_addition_request": sum(row["decision"] == "preserve_via_catalog_addition_request" for row in decisions),
        "manual_exceptions": len(exceptions),
        "automatic_evaluations": sum(row["api_ready_evaluations"] for row in decisions),
        "manual_exception_evaluations": sum(row["api_ready_evaluations"] for row in exceptions),
    }
    manifest = {
        "contract_version": "legacy-preserve-policy-manifest-v1", "status": "awaiting_structural_exceptions" if exceptions else "policy_complete",
        "source_mapping_manifest_sha256": sha256(mapping_manifest_path), "approved_catalog_manifest_sha256": catalog_manifest_sha,
        "counts": counts,
        "files": {
            "policy-decisions.jsonl": decision_file, "manual-exceptions.jsonl": exception_file,
            "manual-review.md": {"bytes": len(review_bytes), "sha256": hashlib.sha256(review_bytes).hexdigest()},
        },
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply the owner policy that preserves same-name courses and historical teachers")
    for name in ("mapping-root", "staging-root", "catalog-root", "evidence-root", "out"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    result = apply_preserve_policy(Path(args.mapping_root), Path(args.staging_root), Path(args.catalog_root), Path(args.evidence_root), Path(args.out))
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
