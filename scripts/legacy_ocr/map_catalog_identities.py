from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

from compile_production_staging import json_bytes, read_json, read_jsonl, sha256, verified_manifest, write_json, write_jsonl


APPROVED_MANIFEST_VERSION = "catalog-baseline-approved-manifest/v1"
APPROVED_RECORD_VERSION = "catalog-baseline-approved-record/v1"
COURSE_VERSION = "catalog-baseline-course/v1"
TEACHER_VERSION = "catalog-baseline-teacher/v1"
RELATION_VERSION = "catalog-baseline-relation/v2"
APPROVED_CATALOG_CATEGORIES = {"general", "required", "elective", "sports"}
SPACE_PATTERN = re.compile(r"[\s\u200B-\u200D\u2060\uFEFF]+", re.UNICODE)


def normalize_source_label(value: str) -> str:
    return SPACE_PATTERN.sub(" ", unicodedata.normalize("NFC", value)).strip()


def verified_catalog(root: Path) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    manifest_path = root / "manifest.json"
    manifest = read_json(manifest_path)
    artifact = manifest.get("artifact")
    if manifest.get("schemaVersion") != APPROVED_MANIFEST_VERSION or manifest.get("status") != "package_ready" or not isinstance(artifact, dict):
        raise ValueError("invalid approved catalog manifest")
    artifact_path = root / str(artifact.get("path", ""))
    if (
        artifact.get("path") != "catalog-baseline.jsonl"
        or not artifact_path.is_file()
        or artifact_path.stat().st_size != artifact.get("bytes")
        or sha256(artifact_path) != artifact.get("sha256")
    ):
        raise ValueError("catalog artifact integrity mismatch")
    rows = read_jsonl(artifact_path)
    if len(rows) != artifact.get("records") or len(rows) != (manifest.get("counts") or {}).get("totalRecords"):
        raise ValueError("catalog artifact record count mismatch")
    return manifest, sha256(manifest_path), rows


def catalog_indexes(rows: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], set[tuple[str, str]], dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    courses: dict[str, dict[str, Any]] = {}
    teachers: dict[str, dict[str, Any]] = {}
    relations: set[tuple[str, str]] = set()
    course_names: dict[str, list[dict[str, Any]]] = defaultdict(list)
    teacher_names: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in rows:
        if record.get("schemaVersion") != APPROVED_RECORD_VERSION or record.get("recordType") not in {"course", "teacher", "relation"}:
            raise ValueError("invalid approved catalog record")
        kind, value = record["recordType"], record.get("value")
        if not isinstance(value, dict):
            raise ValueError("invalid approved catalog record value")
        if kind == "course":
            code = value.get("courseCode")
            if value.get("schemaVersion") != COURSE_VERSION or not isinstance(code, str) or not code or code in courses or value.get("category") not in APPROVED_CATALOG_CATEGORIES:
                raise ValueError("invalid or duplicate approved course")
            courses[code] = value
            names = {value.get("currentName"), *(item.get("rawName") for item in value.get("nameVariants", []) if isinstance(item, dict))}
            for name in names:
                if isinstance(name, str) and name:
                    course_names[normalize_source_label(name)].append(value)
        elif kind == "teacher":
            label = value.get("sourceTeacherLabel")
            if value.get("schemaVersion") != TEACHER_VERSION or not isinstance(label, str) or not label or label in teachers:
                raise ValueError("invalid or duplicate approved teacher")
            teachers[label] = value
            teacher_names[normalize_source_label(label)].append(value)
        else:
            pair = (value.get("courseCode"), value.get("sourceTeacherLabel"))
            if value.get("schemaVersion") != RELATION_VERSION or not all(isinstance(item, str) and item for item in pair) or pair in relations:
                raise ValueError("invalid or duplicate approved relation")
            relations.add(pair)
    if any(code not in courses or label not in teachers for code, label in relations):
        raise ValueError("approved relation references missing identity")
    for index in (course_names, teacher_names):
        for key, candidates in index.items():
            unique = {json.dumps(item, ensure_ascii=False, sort_keys=True): item for item in candidates}
            index[key] = sorted(unique.values(), key=lambda item: item.get("courseCode", item.get("sourceTeacherLabel", "")))
    return courses, teachers, relations, course_names, teacher_names


def match_identity(raw: str, index: dict[str, list[dict[str, Any]]], source_field: str) -> tuple[dict[str, Any] | None, str, list[str]]:
    candidates = index.get(normalize_source_label(raw), [])
    exact = [candidate for candidate in candidates if candidate.get(source_field) == raw]
    selected = exact if exact else candidates
    if len(selected) == 1:
        return selected[0], "exact_source_identity" if exact else "stable_normalized_alias", []
    candidate_ids = [str(item.get("courseCode", item.get("sourceTeacherLabel", ""))) for item in selected]
    return None, "ambiguous" if selected else "unmatched", candidate_ids


def map_catalog_identities(staging_root: Path, catalog_root: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    staging_manifest, staging_manifest_sha = verified_manifest(staging_root, "production-staging-manifest.json", "legacy-production-staging-v1")
    if staging_manifest.get("status") != "awaiting_catalog_mapping":
        raise ValueError("staging package is not awaiting catalog mapping")
    catalog_manifest, catalog_manifest_sha, catalog_rows = verified_catalog(catalog_root)
    courses, teachers, relations, course_names, teacher_names = catalog_indexes(catalog_rows)
    required = read_jsonl(staging_root / "catalog-mapping-required.jsonl")
    required_pairs: set[tuple[str, str]] = set()
    requirements_by_course: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in required:
        pair = (row.get("legacy_course_id"), row.get("legacy_teacher_id"))
        if not all(isinstance(item, str) and item for item in pair) or pair in required_pairs:
            raise ValueError(f"invalid or duplicate required identity mapping: {pair}")
        course_name, teacher_name = row.get("legacy_course_name"), row.get("legacy_teacher_name")
        if not isinstance(course_name, str) or not course_name or not isinstance(teacher_name, str) or not teacher_name:
            raise ValueError(f"required mapping lacks source labels: {pair}")
        required_pairs.add(pair)
        requirements_by_course[pair[0]].append(row)

    graph_course_matches: dict[str, dict[str, Any]] = {}
    for legacy_course_id, course_rows in requirements_by_course.items():
        source_names = {row["legacy_course_name"] for row in course_rows}
        if len(source_names) != 1:
            raise ValueError(f"conflicting source labels for legacy course: {legacy_course_id}")
        source_name = next(iter(source_names))
        candidates = course_names.get(normalize_source_label(source_name), [])
        exact = [candidate for candidate in candidates if candidate.get("currentName") == source_name]
        candidates = exact if exact else candidates
        if len(candidates) < 2:
            continue
        teacher_labels = set()
        for row in course_rows:
            teacher, _method, _candidates = match_identity(row["legacy_teacher_name"], teacher_names, "sourceTeacherLabel")
            if teacher:
                teacher_labels.add(teacher["sourceTeacherLabel"])
        compatible = [
            course for course in candidates
            if any((course["courseCode"], teacher_label) in relations for teacher_label in teacher_labels)
        ]
        if len(compatible) == 1:
            graph_course_matches[legacy_course_id] = compatible[0]

    resolved: list[dict[str, Any]] = []
    alias_exceptions_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    addition_requests_by_key: dict[tuple[str, str], dict[str, Any]] = {}

    for row in required:
        pair = (row.get("legacy_course_id"), row.get("legacy_teacher_id"))
        course_name, teacher_name = row.get("legacy_course_name"), row.get("legacy_teacher_name")
        course, course_method, course_candidates = match_identity(course_name, course_names, "currentName")
        teacher, teacher_method, teacher_candidates = match_identity(teacher_name, teacher_names, "sourceTeacherLabel")
        pair_course_candidates = course_names.get(normalize_source_label(course_name), [])
        exact_pair_courses = [candidate for candidate in pair_course_candidates if candidate.get("currentName") == course_name]
        pair_course_candidates = exact_pair_courses if exact_pair_courses else pair_course_candidates
        if teacher and course is None:
            relation_matches = [
                candidate for candidate in pair_course_candidates
                if (candidate["courseCode"], teacher["sourceTeacherLabel"]) in relations
            ]
            if len(relation_matches) == 1:
                course, course_method, course_candidates = relation_matches[0], "pair_relation_unique", []
        if pair[0] in graph_course_matches:
            graph_course = graph_course_matches[pair[0]]
            if course_method != "pair_relation_unique":
                course, course_method, course_candidates = graph_course, "relation_graph_unique", []
        if not course or not teacher:
            for kind, legacy_id, raw_name, method, candidates in (
                ("course", pair[0], course_name, course_method, course_candidates),
                ("teacher", pair[1], teacher_name, teacher_method, teacher_candidates),
            ):
                if method not in {"unmatched", "ambiguous"}:
                    continue
                key = (kind, legacy_id)
                alias_exceptions_by_key[key] = {
                    "schema_version": "legacy-catalog-alias-exception-v1", "identity_kind": kind,
                    "legacy_identity_id": legacy_id, "legacy_source_label": raw_name,
                    "reason": method, "catalog_candidate_identities": candidates,
                    "terminal_status": "owner_review_required",
                }
            continue
        catalog_pair = (course["courseCode"], teacher["sourceTeacherLabel"])
        if catalog_pair not in relations:
            addition_requests_by_key[catalog_pair] = {
                "schema_version": "legacy-catalog-addition-request-v1", "request_kind": "relation",
                "catalog_course_code": catalog_pair[0], "catalog_teacher_label": catalog_pair[1],
                "legacy_course_ids": sorted({pair[0], *(addition_requests_by_key.get(catalog_pair, {}).get("legacy_course_ids") or [])}),
                "legacy_teacher_ids": sorted({pair[1], *(addition_requests_by_key.get(catalog_pair, {}).get("legacy_teacher_ids") or [])}),
                "reason": "approved_catalog_relation_missing", "terminal_status": "owner_review_required",
            }
            continue
        resolved.append({
            "schema_version": "legacy-catalog-identity-mapping-v1",
            "legacy_course_id": pair[0], "legacy_course_name": course_name,
            "legacy_teacher_id": pair[1], "legacy_teacher_name": teacher_name,
            "catalog_course_code": catalog_pair[0], "catalog_teacher_label": catalog_pair[1],
            "category": "sports" if course["category"] == "sports" else "general",
            "catalog_source_category": course["category"], "course_match_method": course_method,
            "teacher_match_method": teacher_method, "relation_verified": True,
        })

    resolved.sort(key=lambda row: (row["legacy_course_id"], row["legacy_teacher_id"]))
    alias_exceptions = sorted(alias_exceptions_by_key.values(), key=lambda row: (row["identity_kind"], row["legacy_identity_id"]))
    addition_requests = sorted(addition_requests_by_key.values(), key=lambda row: (row["catalog_course_code"], row["catalog_teacher_label"]))
    counts = {"required": len(required), "resolved": len(resolved), "alias_exceptions": len(alias_exceptions), "catalog_addition_requests": len(addition_requests)}
    status = "identity_mapping_complete" if not alias_exceptions and not addition_requests else "awaiting_owner_review"

    out.mkdir(parents=True)
    files = {
        "resolved-mappings.jsonl": write_jsonl(out / "resolved-mappings.jsonl", resolved),
        "alias-exceptions.jsonl": write_jsonl(out / "alias-exceptions.jsonl", alias_exceptions),
        "catalog-addition-requests.jsonl": write_jsonl(out / "catalog-addition-requests.jsonl", addition_requests),
    }
    course_exceptions = sum(item["identity_kind"] == "course" for item in alias_exceptions)
    teacher_exceptions = len(alias_exceptions) - course_exceptions
    review_lines = [
        "# Historical catalog identity exceptions", "",
        f"Status: `{status}`", "", f"Resolved relations: {counts['resolved']} / {counts['required']}", "",
        "## Deterministic policy already applied", "",
        "A historical identity is resolved only when its source label has one exact or minimally normalized approved-catalog target and that exact Course–Teacher Relation exists. Historical data never creates a catalog identity.", "",
        "## Owner decisions required", "",
    ]
    if not alias_exceptions and not addition_requests:
        review_lines.append("None. Every required historical identity maps uniquely to an existing approved catalog relation.")
    else:
        review_lines.extend([
            f"1. **Course aliases ({course_exceptions} identities):** decide each entry in `alias-exceptions.jsonl` with `identity_kind=course` as an approved alias, a Catalog addition request, or rejection. Same-name multi-code candidates are intentionally not merged.", "",
            f"2. **Teacher aliases ({teacher_exceptions} identities):** decide each entry with `identity_kind=teacher` as an approved alias, a Catalog addition request, or rejection. Composite or annotated source labels are intentionally not split automatically.", "",
            f"3. **Missing Relations ({len(addition_requests)} pairs):** decide each entry in `catalog-addition-requests.jsonl` as an approved Catalog addition request or rejection. Existing Course and Teacher identities alone do not prove the Relation.", "",
            "The JSONL files are the complete machine-readable exception queues; this document records policy and aggregate scope rather than duplicating sensitive row-level values.",
        ])
    review_bytes = ("\n".join(review_lines) + "\n").encode()
    (out / "owner-review.md").write_bytes(review_bytes)
    files["owner-review.md"] = {"rows": len(review_lines), "sha256": hashlib.sha256(review_bytes).hexdigest()}
    manifest = {
        "contract_version": "legacy-catalog-identity-mapping-manifest-v1", "status": status,
        "source_staging_manifest_sha256": staging_manifest_sha,
        "approved_catalog_manifest_sha256": catalog_manifest_sha,
        "approved_catalog_content_sha256": catalog_manifest.get("contentSha256"),
        "counts": counts, "files": files,
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Map historical identities to an approved catalog baseline")
    parser.add_argument("--staging-root", required=True)
    parser.add_argument("--catalog-root", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = map_catalog_identities(Path(args.staging_root), Path(args.catalog_root), Path(args.out))
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
