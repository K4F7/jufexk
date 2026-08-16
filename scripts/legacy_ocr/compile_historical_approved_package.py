from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from compile_production_staging import read_json, read_jsonl, sha256, write_json, write_jsonl
from map_catalog_identities import verified_catalog


def stable(prefix: str, *parts: str) -> str:
    return f"{prefix}-" + hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:32]


def verified_file(root: Path, manifest_name: str, contract: str, file_name: str) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    manifest_path = root / manifest_name
    manifest = read_json(manifest_path)
    declaration = (manifest.get("files") or {}).get(file_name)
    path = root / file_name
    if manifest.get("contract_version") != contract or not isinstance(declaration, dict):
        raise ValueError(f"invalid manifest: {manifest_path}")
    if not path.is_file() or sha256(path) != declaration.get("sha256"):
        raise ValueError(f"artifact integrity mismatch: {path}")
    rows = read_jsonl(path)
    if len(rows) != declaration.get("rows"):
        raise ValueError(f"artifact row mismatch: {path}")
    return manifest, sha256(manifest_path), rows


def apply_teacher_reconciliation(
    targets: dict[tuple[str, str], list[dict[str, Any]]],
    rejected_pairs: dict[tuple[str, str], str],
    bindings_by_teacher_id: dict[str, dict[str, Any]],
    rejections_by_teacher_id: dict[str, dict[str, Any]],
) -> None:
    for pair in sorted(set(targets)):
        teacher_id = pair[1]
        rejection = rejections_by_teacher_id.get(teacher_id)
        if rejection:
            rejected_pairs[pair] = rejection["owner_note"]
            del targets[pair]
            continue
        binding = bindings_by_teacher_id.get(teacher_id)
        if not binding:
            continue
        for target in targets[pair]:
            current = target.get("teacher_label")
            if current and current != binding["catalog_teacher_label"]:
                raise ValueError(f"authority teacher binding conflicts with terminal target: {pair}")
            target["teacher_label"] = binding["catalog_teacher_label"]
            target["basis"] = f"{target['basis']}+authority_teacher_alias"


def compile_package(staging_root: Path, mapping_root: Path, additions_root: Path, policy_root: Path, manual_root: Path, course_root: Path, catalog_root: Path, out: Path, reconciliation_root: Path | None = None) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    staging, staging_sha, evaluations = verified_file(staging_root, "production-staging-manifest.json", "legacy-production-staging-v1", "api-ready-evaluations.jsonl")
    mapping, mapping_sha, resolved = verified_file(mapping_root, "manifest.json", "legacy-catalog-identity-mapping-manifest-v1", "resolved-mappings.jsonl")
    _, _, relation_requests = verified_file(mapping_root, "manifest.json", "legacy-catalog-identity-mapping-manifest-v1", "catalog-addition-requests.jsonl")
    additions, additions_sha, addition_decisions = verified_file(additions_root, "manifest.json", "legacy-catalog-addition-decisions-manifest-v1", "decisions.jsonl")
    policy, policy_sha, policy_rows = verified_file(policy_root, "manifest.json", "legacy-preserve-policy-manifest-v1", "policy-decisions.jsonl")
    manual, manual_sha, manual_rows = verified_file(manual_root, "manifest.json", "legacy-owner-manual-decisions-manifest-v1", "compiled-decisions.jsonl")
    course_manifest, course_sha, course_rows = verified_file(course_root / "compiled-v1", "manifest.json", "legacy-missing-catalog-course-decisions-manifest-v1", "compiled-decisions.jsonl")
    auto_courses = read_jsonl(course_root / "auto-resolved-courses.jsonl")
    if sha256(course_root / "auto-resolved-courses.jsonl") != course_manifest["source_automatic_decisions_sha256"]:
        raise ValueError("automatic course reconciliation mismatch")
    if mapping.get("source_staging_manifest_sha256") != staging_sha or additions.get("source_mapping_manifest_sha256") != mapping_sha or policy.get("source_mapping_manifest_sha256") != mapping_sha:
        raise ValueError("decision lineage mismatch")
    catalog_manifest, catalog_sha, catalog_rows = verified_catalog(catalog_root)
    for item in (mapping, additions, policy, manual):
        if item.get("approved_catalog_manifest_sha256") != catalog_sha:
            raise ValueError("approved catalog lineage mismatch")

    reconciliation_sha = None
    reconciliation_courses: list[dict[str, Any]] = []
    reconciliation_teachers: list[dict[str, Any]] = []
    reconciliation_rejections: list[dict[str, Any]] = []
    if reconciliation_root is not None:
        reconciliation, reconciliation_sha, reconciliation_courses = verified_file(
            reconciliation_root, "manifest.json", "legacy-unresolved-authority-reconciliation-manifest-v1", "auto-course-bindings.jsonl"
        )
        _, _, reconciliation_teachers = verified_file(
            reconciliation_root, "manifest.json", "legacy-unresolved-authority-reconciliation-manifest-v1", "auto-teacher-bindings.jsonl"
        )
        _, _, reconciliation_rejections = verified_file(
            reconciliation_root, "manifest.json", "legacy-unresolved-authority-reconciliation-manifest-v1", "rejected-teacher-identities.jsonl"
        )
        _, _, reconciliation_additions = verified_file(
            reconciliation_root, "manifest.json", "legacy-unresolved-authority-reconciliation-manifest-v1", "approved-teacher-additions.jsonl"
        )
        _, _, reconciliation_residual_courses = verified_file(
            reconciliation_root, "manifest.json", "legacy-unresolved-authority-reconciliation-manifest-v1", "residual-course-identities.jsonl"
        )
        if (
            reconciliation.get("status") != "reconciled"
            or reconciliation.get("approved_catalog_manifest_sha256") != catalog_sha
            or reconciliation.get("source_course_decisions_manifest_sha256") != course_sha
            or reconciliation.get("source_staging_manifest_sha256") != staging_sha
        ):
            raise ValueError("authority reconciliation lineage mismatch")
        teacher_partition = len(reconciliation_teachers) + len(reconciliation_additions) + len(reconciliation_rejections)
        if teacher_partition != (reconciliation.get("counts") or {}).get("teacher_identity_inputs"):
            raise ValueError("authority teacher reconciliation partition mismatch")
        if len(reconciliation_courses) + len(reconciliation_residual_courses) != (reconciliation.get("counts") or {}).get("course_identity_inputs"):
            raise ValueError("authority course reconciliation partition mismatch")

    courses, teachers, relations = {}, {}, {}
    for record in catalog_rows:
        value = record["value"]
        if record["recordType"] == "course": courses[value["courseCode"]] = value
        elif record["recordType"] == "teacher": teachers[value["sourceTeacherLabel"]] = value
        else: relations[(value["courseCode"], value["sourceTeacherLabel"])] = value
    course_overrides = {row["legacy_identity_id"]: row["catalog_course_code"] for row in auto_courses}
    course_overrides.update({row["legacy_course_id"]: row["catalog_course_code"] for row in course_rows if row["decision"] == "bind_existing_course"})
    pending_course_ids = {row["legacy_course_id"] for row in course_rows if row["decision"] == "preserve_pending_course_code"}
    for row in reconciliation_courses:
        legacy_id, code = row["legacy_course_id"], row["catalog_course_code"]
        if legacy_id not in pending_course_ids or code not in courses or legacy_id in course_overrides:
            raise ValueError(f"invalid authority course binding: {legacy_id}")
        course_overrides[legacy_id] = code

    approved_relation_targets = {(row["catalog_course_code"], row["catalog_teacher_label"]) for row in addition_decisions if row["decision"] == "approve"}
    requested_relation_targets = {(row["catalog_course_code"], row["catalog_teacher_label"]): row for row in relation_requests}
    targets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    rejected_pairs: dict[tuple[str, str], str] = {}
    for row in resolved:
        pair = (row["legacy_course_id"], row["legacy_teacher_id"])
        targets[pair] = [{"course_code": row["catalog_course_code"], "teacher_label": row["catalog_teacher_label"], "basis": "existing_catalog_relation"}]
    for row in relation_requests:
        pair = (row["legacy_course_ids"][0], row["legacy_teacher_ids"][0])
        target = (row["catalog_course_code"], row["catalog_teacher_label"])
        if target not in approved_relation_targets:
            raise ValueError("unapproved mapping relation request")
        targets[pair] = [{"course_code": target[0], "teacher_label": target[1], "basis": "owner_approved_relation_addition"}]
    for row in policy_rows:
        pair = (row["legacy_course_id"], row["legacy_teacher_id"])
        targets[pair] = [{
            "course_code": row.get("catalog_course_code") or course_overrides.get(pair[0]),
            "teacher_label": row.get("catalog_teacher_label"), "proposed_teacher_label": row["legacy_teacher_name"],
            "basis": row["decision"], "requested_additions": row.get("requested_additions") or [],
        }]
    for row in manual_rows:
        pair = (row["legacy_course_id"], row["legacy_teacher_id"])
        if row["decision"] == "reject":
            rejected_pairs[pair] = row["owner_note"]
            continue
        targets[pair] = [{
            "course_code": item.get("catalog_course_code") or course_overrides.get(pair[0]),
            "teacher_label": item.get("catalog_teacher_label"), "proposed_teacher_label": item["teacher_label"],
            "basis": item["decision"], "requested_additions": item.get("requested_additions") or [],
        } for item in row["teacher_decisions"]]

    bindings_by_teacher_id: dict[str, dict[str, Any]] = {}
    for row in reconciliation_teachers:
        if row["catalog_teacher_label"] not in teachers:
            raise ValueError("authority teacher binding target is absent")
        for teacher_id in row["legacy_teacher_ids"]:
            if teacher_id in bindings_by_teacher_id:
                raise ValueError(f"duplicate authority teacher binding: {teacher_id}")
            bindings_by_teacher_id[teacher_id] = row
    rejections_by_teacher_id: dict[str, dict[str, Any]] = {}
    for row in reconciliation_rejections:
        for teacher_id in row["legacy_teacher_ids"]:
            if teacher_id in bindings_by_teacher_id or teacher_id in rejections_by_teacher_id:
                raise ValueError(f"conflicting authority teacher terminal decision: {teacher_id}")
            rejections_by_teacher_id[teacher_id] = row
    apply_teacher_reconciliation(targets, rejected_pairs, bindings_by_teacher_id, rejections_by_teacher_id)

    required_pairs = {(row["legacy_course_id"], row["legacy_teacher_id"]) for row in read_jsonl(staging_root / "catalog-mapping-required.jsonl")}
    if set(targets) | set(rejected_pairs) != required_pairs or set(targets) & set(rejected_pairs):
        raise ValueError("terminal decision partition mismatch")

    approved_reviews, unresolved_reviews, excluded_reviews, evidence = [], [], [], []
    referenced_courses, referenced_teachers, referenced_relations = set(), set(), set()
    addition_requests: dict[tuple[str, str, str], dict[str, Any]] = {}
    for evaluation in evaluations:
        pair = (evaluation["course_id"], evaluation["teacher_id"])
        evidence.append({"schema_version": "legacy-approved-evidence-v1", "evaluation_id": evaluation["evaluation_id"], "source": evaluation["source"]})
        if pair in rejected_pairs:
            excluded_reviews.append({"schema_version": "legacy-approved-exclusion-v1", "evaluation": evaluation, "reason": "owner_rejected_identity", "owner_note": rejected_pairs[pair]})
            continue
        pair_targets = targets[pair]
        duplicate_group = stable("duplicate", evaluation["evaluation_id"]) if len(pair_targets) > 1 else None
        for target in pair_targets:
            code, teacher = target.get("course_code"), target.get("teacher_label")
            missing = []
            if not code: missing.append("course_identity")
            if not teacher: missing.append("teacher_identity")
            base = {
                "schema_version": "legacy-approved-review-v1", "source_evaluation_id": evaluation["evaluation_id"],
                "review_id": stable("legacy-review", evaluation["evaluation_id"], code or "", teacher or target.get("proposed_teacher_label", "")),
                "catalog_course_code": code, "catalog_teacher_label": teacher,
                "proposed_teacher_label": None if teacher else target.get("proposed_teacher_label"),
                "category": "sports" if code and courses[code].get("category") == "sports" else "general",
                "comment": evaluation["comment"], "duplicate_group": duplicate_group,
                "worksheet": evaluation["worksheet"], "source_row": evaluation["source_row"], "source_column": evaluation["source_column"],
                "decision_basis": target["basis"],
            }
            if missing:
                unresolved_reviews.append({**base, "schema_version": "legacy-approved-unresolved-review-v1", "unresolved_reasons": missing})
                if not code:
                    key = ("course_identity", pair[0], "")
                    addition_requests[key] = {"schema_version": "legacy-approved-catalog-addition-request-v1", "request_kind": "course_identity", "legacy_course_id": pair[0], "status": "preserve_pending_course_code"}
                if not teacher:
                    key = ("teacher_identity", "", target.get("proposed_teacher_label", ""))
                    addition_requests[key] = {"schema_version": "legacy-approved-catalog-addition-request-v1", "request_kind": "teacher_identity", "proposed_source_teacher_label": target.get("proposed_teacher_label"), "status": "owner_approved_pending_catalog_publish"}
                continue
            approved_reviews.append(base)
            referenced_courses.add(code); referenced_teachers.add(teacher); referenced_relations.add((code, teacher))
            if (code, teacher) not in relations:
                key = ("relation", code, teacher)
                addition_requests[key] = {"schema_version": "legacy-approved-catalog-addition-request-v1", "request_kind": "relation", "catalog_course_code": code, "catalog_teacher_label": teacher, "status": "owner_approved_pending_catalog_publish"}

    out.mkdir(parents=True)
    files = {}
    outputs = {
        "catalog-courses.jsonl": [courses[key] for key in sorted(referenced_courses)],
        "catalog-teachers.jsonl": [teachers[key] for key in sorted(referenced_teachers)],
        "catalog-relations.jsonl": [{**(relations.get(key) or {"courseCode": key[0], "sourceTeacherLabel": key[1]}), "packageRelationStatus": "existing" if key in relations else "owner_approved_addition"} for key in sorted(referenced_relations)],
        "approved-legacy-reviews.jsonl": approved_reviews, "unresolved-legacy-reviews.jsonl": unresolved_reviews,
        "excluded-legacy-reviews.jsonl": excluded_reviews, "catalog-addition-requests.jsonl": [addition_requests[key] for key in sorted(addition_requests)],
        "evidence.jsonl": evidence,
    }
    for name, rows in outputs.items(): files[name] = write_jsonl(out / name, rows)
    counts = {
        "source_api_ready": len(evaluations), "approved_import_rows": len(approved_reviews), "unresolved_rows": len(unresolved_reviews),
        "excluded_source_rows": len(excluded_reviews), "fan_out_extra_rows": len(approved_reviews) + len(unresolved_reviews) + len(excluded_reviews) - len(evaluations),
        "catalog_courses": len(outputs["catalog-courses.jsonl"]), "catalog_teachers": len(outputs["catalog-teachers.jsonl"]),
        "catalog_relations": len(outputs["catalog-relations.jsonl"]), "catalog_addition_requests": len(outputs["catalog-addition-requests.jsonl"]), "evidence_rows": len(evidence),
    }
    report = {"status": "approved_with_unresolved_catalog_identities" if unresolved_reviews else "approved", "counts": counts}
    write_json(out / "import-report.json", report); files["import-report.json"] = {"bytes": (out / "import-report.json").stat().st_size, "sha256": sha256(out / "import-report.json")}
    manifest = {
        "contract_version": "legacy-historical-approved-package-v1", "status": report["status"],
        "approved_catalog_manifest_sha256": catalog_sha,
        "sources": {"staging_manifest_sha256": staging_sha, "mapping_manifest_sha256": mapping_sha, "addition_decisions_manifest_sha256": additions_sha, "preserve_policy_manifest_sha256": policy_sha, "manual_decisions_manifest_sha256": manual_sha, "course_decisions_manifest_sha256": course_sha, "authority_reconciliation_manifest_sha256": reconciliation_sha},
        "counts": counts, "closure": {"all_api_ready_source_rows_terminal": len(evaluations) == len(excluded_reviews) + len({row["source_evaluation_id"] for row in approved_reviews + unresolved_reviews}), "production_write_performed": False}, "files": files,
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("staging-root", "mapping-root", "additions-root", "policy-root", "manual-root", "course-root", "catalog-root", "out"): parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--reconciliation-root")
    args = parser.parse_args()
    result = compile_package(
        *(Path(getattr(args, name.replace('-', '_'))) for name in ("staging-root", "mapping-root", "additions-root", "policy-root", "manual-root", "course-root", "catalog-root", "out")),
        reconciliation_root=Path(args.reconciliation_root) if args.reconciliation_root else None,
    )
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__": raise SystemExit(main())
