from __future__ import annotations

import argparse
import hashlib
import json
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from compile_production_staging import verified_manifest
from map_catalog_identities import catalog_indexes, verified_catalog


CONTRACT = "legacy-review-issue98-followup-v1"
CATALOG_CONTENT_SHA256 = "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588"
UNRESOLVED_SHA256 = "c7f9eaefc5a493ec11853cbf7522fb5d10923c9b92df1de7f75ace7b02343f6c"
FORMULA_PACKAGE_SHA256 = "5d06fd91bdcac95a0dc7163156766c7f6eb7c17388a20ba6f9c21d8370d7dca6"
STAGING_MANIFEST_SHA256 = "f05c5b94de78e6b4b5aad156f958306b9d3701284dd57fa9f7c7be1d2202b5f8"
EXPECTED_COUNTS = {"catalog_unresolved": 430, "formula_needs_review": 23}
PLACEHOLDER_COMMENTS = {"/", "g"}


class CompileError(ValueError):
    pass


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            raise CompileError(f"blank line in {path.name}:{number}")
        value = json.loads(line)
        if not isinstance(value, dict):
            raise CompileError(f"non-object in {path.name}:{number}")
        rows.append(value)
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    data = "".join(f"{canonical(row)}\n" for row in rows).encode()
    path.write_bytes(data)
    return {"rows": len(rows), "sha256": hashlib.sha256(data).hexdigest()}


def unique_file(root: Path, pattern: str) -> Path:
    matches = sorted(root.glob(pattern))
    if len(matches) != 1:
        raise CompileError(f"expected one {pattern}, found {len(matches)}")
    return matches[0]


def normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).split())


def unique_index(rows: list[dict[str, Any]], field: str, label: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = row.get(field)
        if not isinstance(key, str) or not key or key in result:
            raise CompileError(f"invalid or duplicate {label}: {key}")
        result[key] = row
    return result


def formula_decision_index(path: Path, expected_keys: set[str]) -> dict[str, dict[str, Any]]:
    decisions = unique_index(read_jsonl(path), "source_key", "formula decision source_key")
    if set(decisions) != expected_keys:
        raise CompileError("formula decisions do not exactly cover the 23 source keys")
    for decision in decisions.values():
        if decision.get("schema_version") != "legacy-issue98-formula-source-decision-v1":
            raise CompileError("invalid formula decision schema")
        if decision.get("action") not in {"source_verified", "exclude_non_review"}:
            raise CompileError("invalid formula decision action")
        if not isinstance(decision.get("reviewer_note"), str) or not decision["reviewer_note"].strip():
            raise CompileError("formula decision lacks reviewer note")
    return decisions


def add_consistent_request(target: dict[str, dict[str, Any]], key: str, value: dict[str, Any]) -> None:
    existing = target.get(key)
    if existing is not None and existing != value:
        raise CompileError(f"conflicting identity request: {key}")
    target[key] = value


def validate_source_fanout(rows: list[dict[str, Any]], expected_extra_rows: int) -> None:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        source_id = row.get("source_evaluation_id")
        if not isinstance(source_id, str) or not source_id:
            raise CompileError("unresolved row lacks source_evaluation_id")
        groups[source_id].append(row)
    if len(rows) - len(groups) != expected_extra_rows:
        raise CompileError("unexpected unresolved source fan-out count")
    for source_id, group in groups.items():
        if len(group) == 1:
            continue
        duplicate_groups = {row.get("duplicate_group") for row in group}
        shared_source = {
            (row.get("comment"), row.get("worksheet"), row.get("source_row"), row.get("source_column"))
            for row in group
        }
        proposed_labels = {row.get("proposed_teacher_label") for row in group}
        if (
            len(duplicate_groups) != 1
            or not next(iter(duplicate_groups))
            or len(shared_source) != 1
            or len(proposed_labels) != len(group)
            or any(not isinstance(label, str) or not label for label in proposed_labels)
        ):
            raise CompileError(f"invalid unresolved source fan-out: {source_id}")


def catalog_name_indexes(courses: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = defaultdict(list)
    for code, course in courses.items():
        names = {course.get("currentName")}
        names.update(
            item.get("rawName") for item in course.get("nameVariants", []) if isinstance(item, dict)
        )
        for name in names:
            if isinstance(name, str) and name:
                result[normalized(name)].append(code)
    return result


def compile_followup(
    unresolved_file: Path,
    staging_root: Path,
    formula_root: Path,
    catalog_root: Path,
    formula_decisions_file: Path,
    out: Path,
) -> dict[str, Any]:
    if out.exists():
        raise CompileError(f"refusing existing output: {out}")
    if sha256(unresolved_file) != UNRESOLVED_SHA256:
        raise CompileError("430-row unresolved input hash mismatch")
    package_manifest = formula_root / "package-manifest.json"
    if sha256(package_manifest) != FORMULA_PACKAGE_SHA256:
        raise CompileError("formula-bar package hash mismatch")

    catalog_manifest, catalog_manifest_sha, catalog_rows = verified_catalog(catalog_root)
    if catalog_manifest.get("contentSha256") != CATALOG_CONTENT_SHA256:
        raise CompileError("catalog v2 content hash mismatch")
    courses, teachers, relations, _course_names, _teacher_names = catalog_indexes(catalog_rows)
    course_names = catalog_name_indexes(courses)

    unresolved = read_jsonl(unresolved_file)
    if len(unresolved) != EXPECTED_COUNTS["catalog_unresolved"]:
        raise CompileError("catalog unresolved row count mismatch")
    unique_index(unresolved, "review_id", "unresolved review_id")
    validate_source_fanout(unresolved, expected_extra_rows=8)
    staging_manifest, staging_manifest_sha = verified_manifest(
        staging_root, "production-staging-manifest.json", "legacy-production-staging-v1"
    )
    if staging_manifest_sha != STAGING_MANIFEST_SHA256 or staging_manifest.get("status") != "awaiting_catalog_mapping":
        raise CompileError("production staging lineage mismatch")
    evaluations = unique_index(
        read_jsonl(staging_root / "api-ready-evaluations.jsonl"), "evaluation_id", "staging evaluation_id"
    )

    approved: list[dict[str, Any]] = []
    identity_unresolved: list[dict[str, Any]] = []
    source_unresolved: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    course_requests: dict[str, dict[str, Any]] = {}
    teacher_requests: dict[str, dict[str, Any]] = {}

    def resolve(row: dict[str, Any], course_name: str | None, teacher_name: str | None) -> tuple[str | None, str | None, list[str]]:
        code = None
        reasons: list[str] = []
        if course_name:
            candidates = course_names.get(normalized(course_name), [])
            if len(candidates) == 1:
                code = candidates[0]
            else:
                reasons.append("course_identity")
        else:
            reasons.append("course_identity")
        label = teacher_name
        if not isinstance(label, str) or label not in teachers:
            reasons.append("teacher_identity")
            label = None
        if code and label and (code, label) not in relations:
            reasons.append("relation_identity")
        prior_code = row.get("catalog_course_code")
        if isinstance(prior_code, str) and prior_code and code and prior_code != code:
            reasons.append("course_identity_conflict")
        prior_teacher = row.get("catalog_teacher_label")
        if isinstance(prior_teacher, str) and prior_teacher and label and prior_teacher != label:
            reasons.append("teacher_identity_conflict")
        proposed_label = row.get("proposed_teacher_label")
        if (
            isinstance(proposed_label, str)
            and proposed_label
            and isinstance(teacher_name, str)
            and normalized(proposed_label) != normalized(teacher_name)
        ):
            reasons.append("teacher_identity_conflict")
        return code, label, sorted(set(reasons))

    for row in unresolved:
        evaluation = evaluations.get(row.get("source_evaluation_id"))
        if not evaluation:
            raise CompileError(f"missing staging evaluation: {row.get('source_evaluation_id')}")
        comment = evaluation.get("comment")
        if (
            evaluation.get("approval_status") != "ai_verified"
            or evaluation.get("manual_review_reasons")
            or comment != row.get("comment")
            or not isinstance(evaluation.get("source"), dict)
            or not evaluation["source"].get("capture_manifest_sha256")
            or not evaluation["source"].get("review_source_sha256")
            or evaluation.get("worksheet") != row.get("worksheet")
            or evaluation.get("source_row") != row.get("source_row")
            or evaluation.get("source_column") != row.get("source_column")
        ):
            raise CompileError(f"unclosed staging source evidence: {row.get('source_evaluation_id')}")
        code, label, reasons = resolve(row, evaluation.get("course_name"), evaluation.get("teacher_name"))
        if not row.get("catalog_course_code"):
            legacy_course_id = evaluation.get("course_id")
            if not isinstance(legacy_course_id, str) or not legacy_course_id:
                raise CompileError("missing legacy course identity request")
            add_consistent_request(course_requests, legacy_course_id, {
                "schema_version": "legacy-issue98-identity-request-terminal-v1",
                "identity_kind": "course",
                "legacy_identity_id": legacy_course_id,
                "source_label": evaluation.get("course_name"),
                "catalog_identity": code,
                "terminal_status": "bound_existing_v2_identity" if code else "catalog_identity_unresolved",
            })
        proposed = row.get("proposed_teacher_label")
        if isinstance(proposed, str) and proposed:
            existing = teacher_requests.get(proposed)
            legacy_teacher_id = evaluation.get("teacher_id")
            if existing is None:
                teacher_requests[proposed] = {
                    "schema_version": "legacy-issue98-identity-request-terminal-v1",
                    "identity_kind": "teacher",
                    "legacy_identity_ids": [legacy_teacher_id],
                    "source_label": proposed,
                    "catalog_identity": label,
                    "terminal_status": "bound_existing_v2_identity" if label else "catalog_identity_unresolved",
                }
            else:
                if existing["catalog_identity"] != label:
                    raise CompileError(f"conflicting teacher identity request: {proposed}")
                existing["legacy_identity_ids"] = sorted({*existing["legacy_identity_ids"], legacy_teacher_id})
        result = {
            **row,
            "schema_version": "legacy-issue98-catalog-unresolved-v1",
            "catalog_course_code": code,
            "catalog_teacher_label": label,
            "unresolved_reasons": reasons,
            "source_partition": "catalog-v1-unresolved-430",
        }
        if not isinstance(comment, str) or not comment.strip():
            result["reason"] = "blank_or_incomplete_review_body"
            source_unresolved.append(result)
            continue
        if reasons:
            identity_unresolved.append(result)
        else:
            result["schema_version"] = "legacy-issue98-approval-candidate-v1"
            approved.append(result)

    formula_manifest = json.loads(package_manifest.read_text(encoding="utf-8"))
    overlay_file = unique_file(formula_root, "formula_bar_overlay.*.jsonl")
    evidence_file = unique_file(formula_root, "formula_bar_evidence.*.jsonl")
    historical_file = unique_file(formula_root, "historical_evaluations.*.jsonl")
    for path in (overlay_file, evidence_file, historical_file):
        metadata = formula_manifest.get("files", {}).get(path.name)
        if not isinstance(metadata, dict) or metadata.get("sha256") != sha256(path):
            raise CompileError(f"formula artifact hash mismatch: {path.name}")
    created_rows = [row for row in read_jsonl(overlay_file) if row.get("action") == "created_needs_review"]
    if len(created_rows) != EXPECTED_COUNTS["formula_needs_review"]:
        raise CompileError("formula needs_review key count mismatch")
    created_keys = set(unique_index(created_rows, "key", "created formula key"))
    evidence = unique_index(
        [row for row in read_jsonl(evidence_file) if row.get("key") in created_keys], "key", "formula evidence key"
    )
    historical_rows = read_jsonl(historical_file)
    for row in historical_rows:
        row["source_key"] = f"{row.get('worksheet')}|{row.get('source_row')}|{row.get('source_column')}"
    historical = unique_index(historical_rows, "source_key", "historical source key")
    decisions = formula_decision_index(formula_decisions_file, created_keys)
    for key in sorted(created_keys):
        origin = evidence.get(key)
        evaluation = historical.get(key)
        if not origin or not evaluation:
            raise CompileError(f"incomplete formula source chain: {key}")
        coordinate_key = f"{origin.get('worksheet')}|{origin.get('row')}|{origin.get('column')}"
        if coordinate_key != key or evaluation.get("source_key") != key:
            raise CompileError(f"formula source coordinate mismatch: {key}")
        cell_image = (origin.get("evidence") or {}).get("cell_image", {})
        for field, value in {
            "formula_bar_text_sha256": origin.get("formula_bar_text_sha256"),
            "record_sha256": origin.get("record_sha256"),
            "cell_image_path": cell_image.get("path"),
            "cell_image_sha256": cell_image.get("sha256"),
        }.items():
            if not isinstance(value, str) or not value:
                raise CompileError(f"formula source lacks {field}: {key}")
        comment = origin.get("formula_bar_value")
        decision = decisions[key]
        base = {
            "schema_version": "legacy-issue98-formula-review-v1",
            "source_partition": "formula-bar-created-needs-review-23",
            "source_key": key,
            "worksheet": origin.get("worksheet"),
            "source_row": origin.get("row"),
            "source_column": origin.get("column"),
            "comment": comment,
            "formula_bar_text_sha256": origin.get("formula_bar_text_sha256"),
            "formula_record_sha256": origin.get("record_sha256"),
            "cell_image_path": cell_image["path"],
            "cell_image_sha256": cell_image["sha256"],
            "course_name": evaluation.get("course_name"),
            "teacher_name": evaluation.get("teacher_name"),
            "reviewer_note": decision["reviewer_note"],
        }
        if not isinstance(comment, str) or not comment.strip():
            source_unresolved.append({**base, "reason": "blank_formula_value"})
            continue
        if decision["action"] == "exclude_non_review":
            if comment.strip().lower() not in PLACEHOLDER_COMMENTS:
                raise CompileError(f"non-placeholder excluded by formula decision: {key}")
            excluded.append({**base, "reason": "human_confirmed_non_review_placeholder"})
            continue
        code, label, reasons = resolve({}, evaluation.get("course_name"), evaluation.get("teacher_name"))
        base.update({"catalog_course_code": code, "catalog_teacher_label": label})
        if reasons:
            identity_unresolved.append({**base, "unresolved_reasons": reasons})
        else:
            approved.append({**base, "schema_version": "legacy-issue98-approval-candidate-v1", "decision_basis": "formula_bar_source_review_and_v2_relation"})

    total = len(approved) + len(identity_unresolved) + len(source_unresolved) + len(excluded)
    if total != 453:
        raise CompileError(f"terminal partition mismatch: {total}")
    if len(course_requests) != 36 or len(teacher_requests) != 61:
        raise CompileError(
            f"identity request count mismatch: courses={len(course_requests)}, teachers={len(teacher_requests)}"
        )
    request_rows = sorted(
        [*course_requests.values(), *teacher_requests.values()],
        key=lambda row: (row["identity_kind"], str(row.get("legacy_identity_id", row.get("legacy_identity_ids"))), row["source_label"]),
    )
    for request in request_rows:
        if request["identity_kind"] == "teacher" and request["catalog_identity"]:
            related = sorted(code for code, label in relations if label == request["catalog_identity"])
            request["verified_relation_course_codes"] = related
            request["relation_terminal_status"] = "v2_relations_enumerated"
        elif request["identity_kind"] == "course" and request["catalog_identity"]:
            related = sorted(label for code, label in relations if code == request["catalog_identity"])
            request["verified_relation_teacher_labels"] = related
            request["relation_terminal_status"] = "v2_relations_enumerated"
        else:
            request["relation_terminal_status"] = "not_checkable_without_v2_identity"
    for rows in (approved, identity_unresolved, source_unresolved, excluded):
        rows.sort(key=lambda row: (str(row.get("source_partition")), str(row.get("worksheet")), int(row.get("source_row") or 0), str(row.get("source_column")), str(row.get("review_id", ""))))

    out.mkdir(parents=True)
    files = {
        "approval-candidates.jsonl": write_jsonl(out / "approval-candidates.jsonl", approved),
        "catalog-identity-unresolved.jsonl": write_jsonl(out / "catalog-identity-unresolved.jsonl", identity_unresolved),
        "source-evidence-unresolved.jsonl": write_jsonl(out / "source-evidence-unresolved.jsonl", source_unresolved),
        "excluded.jsonl": write_jsonl(out / "excluded.jsonl", excluded),
        "identity-request-terminal.jsonl": write_jsonl(out / "identity-request-terminal.jsonl", request_rows),
    }
    partition_counts = Counter(row["source_partition"] for rows in (approved, identity_unresolved, source_unresolved, excluded) for row in rows)
    manifest = {
        "contract_version": CONTRACT,
        "status": "closed",
        "counts": {
            "input_total": 453,
            "catalog_v1_unresolved_input": 430,
            "formula_needs_review_input": 23,
            "approval_candidates": len(approved),
            "catalog_identity_unresolved": len(identity_unresolved),
            "source_evidence_unresolved": len(source_unresolved),
            "excluded": len(excluded),
            "course_identity_requests": len(course_requests),
            "course_identity_requests_bound_v2": sum(row["catalog_identity"] is not None for row in course_requests.values()),
            "teacher_identity_requests": len(teacher_requests),
            "teacher_identity_requests_bound_v2": sum(row["catalog_identity"] is not None for row in teacher_requests.values()),
            "source_partitions": dict(sorted(partition_counts.items())),
        },
        "lineage": {
            "catalog_v2_manifest_sha256": catalog_manifest_sha,
            "catalog_v2_content_sha256": CATALOG_CONTENT_SHA256,
            "catalog_v1_unresolved_sha256": UNRESOLVED_SHA256,
            "formula_bar_package_manifest_sha256": FORMULA_PACKAGE_SHA256,
            "formula_bar_decisions_sha256": sha256(formula_decisions_file),
            "production_staging_manifest_sha256": staging_manifest_sha,
        },
        "closure": {
            "all_453_records_terminal": True,
            "catalog_identity_creation_performed": False,
            "production_write_performed": False,
            "production_credentials_included": False,
            "existing_approved_package_modified": False,
        },
        "files": files,
    }
    content_hash = hashlib.sha256(canonical(manifest).encode()).hexdigest()
    manifest["content_sha256"] = content_hash
    (out / "manifest.json").write_text(canonical(manifest) + "\n", encoding="utf-8", newline="\n")
    report = (
        "# Issue #98 closure acceptance\n\n"
        f"- Input records: 453 (430 catalog-v1 unresolved + 23 formula-bar discoveries)\n"
        f"- Approval candidates: {len(approved)}\n"
        f"- Catalog identity unresolved: {len(identity_unresolved)}\n"
        f"- Source/evidence unresolved: {len(source_unresolved)}\n"
        f"- Explicitly excluded: {len(excluded)}\n"
        f"- Course identity requests: {len(course_requests)} (bound to v2: {sum(row['catalog_identity'] is not None for row in course_requests.values())})\n"
        f"- Teacher identity requests: {len(teacher_requests)} (bound to v2: {sum(row['catalog_identity'] is not None for row in teacher_requests.values())})\n"
        f"- Catalog v2 content SHA-256: `{CATALOG_CONTENT_SHA256}`\n"
        f"- Output content SHA-256: `{content_hash}`\n\n"
        "No production API or D1 write was performed. This package is independent from the current MVP approved package.\n"
    )
    (out / "ACCEPTANCE.md").write_text(report, encoding="utf-8", newline="\n")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile the isolated issue #98 follow-up package")
    parser.add_argument("--unresolved-file", required=True)
    parser.add_argument("--staging-root", required=True)
    parser.add_argument("--formula-root", required=True)
    parser.add_argument("--catalog-root", required=True)
    parser.add_argument("--formula-decisions", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    manifest = compile_followup(*(Path(value) for value in (args.unresolved_file, args.staging_root, args.formula_root, args.catalog_root, args.formula_decisions, args.out)))
    print(canonical({"status": manifest["status"], "counts": manifest["counts"], "content_sha256": manifest["content_sha256"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
