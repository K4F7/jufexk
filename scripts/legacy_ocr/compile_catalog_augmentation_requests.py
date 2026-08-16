from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from compile_historical_approved_package import verified_file
from compile_production_staging import read_jsonl, sha256, write_json, write_jsonl
from map_catalog_identities import verified_catalog


def stable(*parts: str) -> str:
    return "catalog-request-" + hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:32]


def build_request_rows(labels: set[str], relation_counts: Counter[tuple[str, str]]) -> list[dict[str, Any]]:
    by_teacher: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for (course_code, teacher_label), count in relation_counts.items():
        if teacher_label not in labels or not course_code or count < 1:
            raise ValueError("invalid approved teacher relation input")
        by_teacher[teacher_label].append((course_code, count))
    requests: list[dict[str, Any]] = []
    for label in sorted(labels):
        relations = sorted(by_teacher.get(label, []))
        if not relations:
            relations = [("", 0)]
        for course_code, review_rows in relations:
            requests.append({
                "schema_version": "legacy-catalog-request-submission-v1",
                "request_key": stable("teacher", label, course_code),
                "kind": "teacher",
                "course_code": course_code,
                "teacher_source_label": label,
                "decision": "owner_approved",
                "decision_basis": "historical_directory_teacher_preservation_policy",
                "covered_unresolved_review_rows": review_rows,
                "submission_status": "ready_for_catalog_request_queue",
            })
    return requests


def compile_requests(
    reconciliation_root: Path,
    historical_package_root: Path,
    staging_root: Path,
    catalog_root: Path,
    out: Path,
) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    reconciliation, reconciliation_sha, additions = verified_file(
        reconciliation_root,
        "manifest.json",
        "legacy-unresolved-authority-reconciliation-manifest-v1",
        "approved-teacher-additions.jsonl",
    )
    historical, historical_sha, unresolved = verified_file(
        historical_package_root,
        "manifest.json",
        "legacy-historical-approved-package-v1",
        "unresolved-legacy-reviews.jsonl",
    )
    staging, staging_sha, evaluations = verified_file(
        staging_root,
        "production-staging-manifest.json",
        "legacy-production-staging-v1",
        "api-ready-evaluations.jsonl",
    )
    catalog_manifest, catalog_sha, catalog_rows = verified_catalog(catalog_root)
    if (
        reconciliation.get("status") != "reconciled"
        or reconciliation.get("approved_catalog_manifest_sha256") != catalog_sha
        or reconciliation.get("source_staging_manifest_sha256") != staging_sha
        or historical.get("approved_catalog_manifest_sha256") != catalog_sha
        or (historical.get("sources") or {}).get("authority_reconciliation_manifest_sha256") != reconciliation_sha
    ):
        raise ValueError("catalog augmentation lineage mismatch")

    labels = {row["proposed_source_teacher_label"] for row in additions}
    if len(labels) != len(additions) or any(
        row.get("schema_version") != "legacy-authority-approved-teacher-addition-v1"
        or row.get("decision") != "owner_approved_catalog_addition"
        for row in additions
    ):
        raise ValueError("invalid approved teacher additions")
    authority_courses = {row["value"]["courseCode"] for row in catalog_rows if row["recordType"] == "course"}
    authority_teachers = {row["value"]["sourceTeacherLabel"] for row in catalog_rows if row["recordType"] == "teacher"}
    if labels & authority_teachers:
        raise ValueError("approved teacher addition already exists in authority catalog")

    evaluations_by_id = {row["evaluation_id"]: row for row in evaluations}
    relation_counts: Counter[tuple[str, str]] = Counter()
    deferred_counts: Counter[tuple[str, str]] = Counter()
    covered_rows = 0
    for row in unresolved:
        label = row.get("proposed_teacher_label")
        if label not in labels:
            continue
        covered_rows += 1
        code = row.get("catalog_course_code")
        if code:
            if code not in authority_courses:
                raise ValueError(f"relation references unknown authority course: {code}")
            relation_counts[(code, label)] += 1
        else:
            evaluation = evaluations_by_id[row["source_evaluation_id"]]
            deferred_counts[(evaluation["course_id"], label)] += 1
    if {label for _, label in relation_counts} | {label for _, label in deferred_counts} != labels:
        raise ValueError("approved teacher addition lacks historical target evidence")

    requests = build_request_rows(labels, relation_counts)
    teacher_rows = [{
        "schema_version": "legacy-catalog-augmentation-teacher-v1",
        "source_teacher_label": label,
        "display_name": label,
        "decision": "owner_approved",
    } for label in sorted(labels)]
    relation_rows = [{
        "schema_version": "legacy-catalog-augmentation-relation-v1",
        "course_code": code,
        "source_teacher_label": label,
        "covered_unresolved_review_rows": relation_counts[(code, label)],
        "decision": "owner_approved",
    } for code, label in sorted(relation_counts)]
    deferred_rows = [{
        "schema_version": "legacy-catalog-augmentation-deferred-relation-v1",
        "legacy_course_id": course_id,
        "source_teacher_label": label,
        "covered_unresolved_review_rows": deferred_counts[(course_id, label)],
        "status": "waiting_for_official_course_code",
    } for course_id, label in sorted(deferred_counts)]

    out.mkdir(parents=True)
    outputs = {
        "catalog-requests.jsonl": requests,
        "teacher-identities.jsonl": teacher_rows,
        "relations.jsonl": relation_rows,
        "deferred-relations.jsonl": deferred_rows,
    }
    files = {name: write_jsonl(out / name, rows) for name, rows in outputs.items()}
    counts = {
        "teacher_identities": len(teacher_rows),
        "relation_additions": len(relation_rows),
        "teacher_only_requests": sum(not row["course_code"] for row in requests),
        "catalog_requests": len(requests),
        "deferred_relation_pairs": len(deferred_rows),
        "covered_unresolved_review_rows": covered_rows,
        "immediately_resolvable_review_rows_after_publish": sum(relation_counts.values()),
        "deferred_review_rows": sum(deferred_counts.values()),
    }
    manifest = {
        "contract_version": "legacy-catalog-augmentation-request-package-v1",
        "status": "package_ready_for_catalog_request_queue",
        "production_write_performed": False,
        "approved_catalog_manifest_sha256": catalog_sha,
        "approved_catalog_content_sha256": catalog_manifest.get("contentSha256"),
        "source_reconciliation_manifest_sha256": reconciliation_sha,
        "source_historical_package_manifest_sha256": historical_sha,
        "source_staging_manifest_sha256": staging_sha,
        "counts": counts,
        "files": files,
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("reconciliation-root", "historical-package-root", "staging-root", "catalog-root", "out"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    manifest = compile_requests(
        Path(args.reconciliation_root),
        Path(args.historical_package_root),
        Path(args.staging_root),
        Path(args.catalog_root),
        Path(args.out),
    )
    print(json.dumps({"status": manifest["status"], "counts": manifest["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
