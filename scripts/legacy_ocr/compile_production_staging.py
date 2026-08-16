from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Any


API_CATEGORIES = {"general", "sports"}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def write_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(value)
    temporary.replace(path)


def write_json(path: Path, value: Any) -> None:
    write_bytes(path, json_bytes(value))


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    write_bytes(path, b"".join(json_bytes(row) for row in rows))
    return {"rows": len(rows), "sha256": sha256(path)}


def logical_rows(path: Path) -> int:
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return max(0, sum(1 for _ in csv.reader(handle)) - 1)
    return sum(1 for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip())


def verified_manifest(root: Path, filename: str, contract: str) -> tuple[dict[str, Any], str]:
    path = root / filename
    manifest = read_json(path)
    if manifest.get("contract_version") != contract or not isinstance(manifest.get("files"), dict):
        raise ValueError(f"invalid {contract} manifest")
    for name, expected in manifest["files"].items():
        target = root / name
        if not target.is_file():
            raise ValueError(f"missing declared file: {name}")
        if sha256(target) != expected.get("sha256"):
            raise ValueError(f"hash mismatch: {name}")
        if expected.get("kind") == "binary":
            if target.stat().st_size != expected.get("bytes"):
                raise ValueError(f"byte count mismatch: {name}")
        elif logical_rows(target) != expected.get("rows"):
            raise ValueError(f"row count mismatch: {name}")
    return manifest, sha256(path)


def declared_jsonl(root: Path, manifest: dict[str, Any], prefix: str) -> list[dict[str, Any]]:
    names = [name for name in manifest["files"] if name.startswith(prefix + ".") and name.endswith(".jsonl")]
    if len(names) != 1:
        raise ValueError(f"expected one declared {prefix} JSONL, got {names}")
    return read_jsonl(root / names[0])


def unique(rows: list[dict[str, Any]], field: str, label: str) -> dict[str, dict[str, Any]]:
    result = {}
    for row in rows:
        key = row.get(field)
        if not isinstance(key, str) or not key or key in result:
            raise ValueError(f"invalid or duplicate {label}: {key}")
        result[key] = row
    return result


def formula_record_hash(record: dict[str, Any]) -> str:
    content = {key: value for key, value in record.items() if key != "record_sha256"}
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def verified_formula_evidence(manifest: dict[str, Any], package_root: Path) -> dict[str, dict[str, Any]]:
    names = [name for name in manifest["files"] if name.startswith("formula_bar_evidence.") and name.endswith(".jsonl")]
    if not names:
        return {}
    if len(names) != 1 or not isinstance(manifest.get("formula_bar_evidence_manifest_sha256"), str):
        raise ValueError("invalid formula-bar package evidence declaration")
    source_manifest_name = manifest.get("formula_bar_evidence_manifest_file")
    record_files = manifest.get("formula_bar_record_files")
    if not isinstance(source_manifest_name, str) or not isinstance(record_files, dict):
        raise ValueError("missing formula-bar source evidence chain")
    source_manifest_path = package_root / source_manifest_name
    if sha256(source_manifest_path) != manifest["formula_bar_evidence_manifest_sha256"]:
        raise ValueError("formula-bar source manifest hash mismatch")
    source_manifest = read_json(source_manifest_path)
    if source_manifest.get("contract_version") != "formula-bar-evidence-set-v1" or not isinstance(source_manifest.get("files"), dict):
        raise ValueError("invalid formula-bar source manifest")
    if set(record_files) != set(source_manifest["files"]):
        raise ValueError("formula-bar source record set mismatch")
    if source_manifest.get("evidence_count") == 14_985:
        audit_declaration = source_manifest.get("full_scan_audit")
        audit_name = manifest.get("formula_bar_full_scan_audit_file")
        audit_sha = manifest.get("formula_bar_full_scan_audit_sha256")
        if not isinstance(audit_declaration, dict) or not isinstance(audit_name, str) or audit_sha != audit_declaration.get("sha256"):
            raise ValueError("missing production full-scan audit chain")
        audit_path = package_root / audit_name
        if not audit_path.is_file() or sha256(audit_path) != audit_sha:
            raise ValueError("production full-scan audit hash mismatch")
        audit = read_json(audit_path)
        content = {key: value for key, value in audit.items() if key != "audit_sha256"}
        if (
            audit.get("contract_version") != "formula-bar-full-scan-audit-v1"
            or hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest() != audit.get("audit_sha256")
            or audit.get("status") != "completed"
            or audit.get("plan_sha256") != "379f8d7cae7cbfd8bc31bcd336734c4f17bf7479ba113dcb13b8fcd19e4ae18d"
            or audit.get("completed_cells") != 14_985
            or audit.get("strong_suspect_cells") != 110
            or audit.get("strong_suspect_keys_sha256") != "48206e7e17c44d24dff5e21bf4b5416566324f1ae78e7b452f8c0a8af80301a1"
            or audit.get("checkpoint_count") != 78
            or audit.get("read_only") is not True
        ):
            raise ValueError("production full-scan audit contract mismatch")
    source_records = {}
    for original_name, expected in source_manifest["files"].items():
        bundled_name = record_files[original_name]
        if not isinstance(bundled_name, str) or sha256(package_root / bundled_name) != expected.get("sha256"):
            raise ValueError(f"formula-bar source record hash mismatch: {original_name}")
        record = read_json(package_root / bundled_name)
        key = record.get("key")
        if expected.get("key") != key or not isinstance(key, str) or key in source_records:
            raise ValueError(f"invalid or duplicate formula-bar source record: {key}")
        if record.get("contract_version") != "formula-bar-cell-evidence-v1" or formula_record_hash(record) != record.get("record_sha256"):
            raise ValueError(f"formula-bar source record contract mismatch: {key}")
        source_records[key] = record
    if source_manifest.get("evidence_count") != len(source_records):
        raise ValueError("formula-bar source evidence count mismatch")
    result = {}
    for record in read_jsonl(package_root / names[0]):
        key = record.get("key")
        if not isinstance(key, str) or not key or key in result:
            raise ValueError(f"invalid or duplicate formula-bar package evidence: {key}")
        if record.get("contract_version") != "formula-bar-cell-evidence-v1" or formula_record_hash(record) != record.get("record_sha256"):
            raise ValueError(f"formula-bar package evidence hash mismatch: {key}")
        if key not in source_records or source_records[key] != record:
            raise ValueError(f"formula-bar aggregate evidence differs from source: {key}")
        result[key] = record
    if set(result) != set(source_records):
        raise ValueError("formula-bar aggregate evidence set mismatch")
    return result


def formula_provenance_valid(row: dict[str, Any], formula_evidence: dict[str, dict[str, Any]], evidence_manifest_sha256: str | None, declared_files: dict[str, Any] | None = None) -> bool:
    source = row.get("source") or {}
    formula = source.get("formula_bar")
    if not isinstance(formula, dict):
        return False
    record = formula_evidence.get(str(formula.get("key", "")))
    if not record:
        return False
    cell_file = formula.get("cell_image_file")
    conflict_file = formula.get("conflict_image_file")
    files = declared_files or {}
    cell_meta = files.get(cell_file) if isinstance(cell_file, str) else None
    conflict_meta = files.get(conflict_file) if isinstance(conflict_file, str) else None
    return bool(
        formula.get("contract_version") == "formula-bar-cell-evidence-v1"
        and formula.get("evidence_manifest_sha256") == evidence_manifest_sha256
        and formula.get("record_sha256") == record.get("record_sha256")
        and formula.get("terminal_status") == record.get("terminal_status")
        and formula.get("formula_bar_value") == record.get("formula_bar_value")
        and formula.get("formula_bar_text_sha256") == record.get("formula_bar_text_sha256")
        and formula.get("cell_image_sha256") == (record.get("evidence", {}).get("cell_image") or {}).get("sha256")
        and formula.get("conflict_image_sha256") == (record.get("evidence", {}).get("conflict_image") or {}).get("sha256")
        and (formula.get("cell_image_sha256") is None or (cell_meta or {}).get("sha256") == formula.get("cell_image_sha256"))
        and (formula.get("conflict_image_sha256") is None or (conflict_meta or {}).get("sha256") == formula.get("conflict_image_sha256"))
    )


def api_evidence_compatible(row: dict[str, Any], formula_evidence: dict[str, dict[str, Any]] | None = None, evidence_manifest_sha256: str | None = None, declared_files: dict[str, Any] | None = None) -> bool:
    source = row.get("source") or {}
    formula = source.get("formula_bar")
    if isinstance(formula, dict):
        value = formula.get("formula_bar_value")
        return bool(
            formula_provenance_valid(row, formula_evidence or {}, evidence_manifest_sha256, declared_files)
            and formula.get("terminal_status") == "review_origin"
            and isinstance(value, str) and value
            and formula.get("formula_bar_text_sha256") == hashlib.sha256(value.encode()).hexdigest()
        )
    confidence = source.get("ocr_confidence")
    tokens = source.get("ocr_tokens")
    return bool(
        isinstance(source.get("ocr_text"), str) and source["ocr_text"].strip()
        and isinstance(confidence, (int, float)) and 0 <= confidence <= 1
        and isinstance(tokens, list) and tokens
        and all(
            isinstance(token, dict)
            and isinstance(token.get("text"), str) and token["text"].strip()
            and isinstance(token.get("confidence"), (int, float))
            and 0 <= token["confidence"] <= 1
            for token in tokens
        )
    )


def validate_ai_candidate(row: dict[str, Any], relations: set[tuple[str, str]]) -> None:
    evaluation_id = row.get("evaluation_id")
    if row.get("review_status") != "candidate" or row.get("manual_review_reasons") != []:
        raise ValueError(f"not an unqualified candidate: {evaluation_id}")
    if not str(row.get("comment", "")).strip():
        raise ValueError(f"candidate has blank comment: {evaluation_id}")
    pair = (row.get("course_id"), row.get("teacher_id"))
    if not all(isinstance(item, str) and item for item in pair) or pair not in relations:
        raise ValueError(f"candidate has invalid relation: {evaluation_id}")
    if row.get("review_conclusion") not in {"agreed", "arbitrated"}:
        raise ValueError(f"candidate lacks completed A/B conclusion: {evaluation_id}")
    if row.get("review_uncertainty_markers") or row.get("context_uncertainty_markers"):
        raise ValueError(f"candidate contains hidden uncertainty: {evaluation_id}")
    source = row.get("source") or {}
    for field in ("capture_manifest_sha256", "review_source_file", "review_source_sha256", "review_crop_sha256"):
        if not source.get(field):
            raise ValueError(f"candidate lacks {field}: {evaluation_id}")


def stage_package(package_root: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    manifest, manifest_sha256 = verified_manifest(package_root, "package-manifest.json", "legacy-review-package-v1")
    evaluations = declared_jsonl(package_root, manifest, "historical_evaluations")
    courses = unique(declared_jsonl(package_root, manifest, "courses"), "course_id", "course")
    teachers = unique(declared_jsonl(package_root, manifest, "teachers"), "teacher_id", "teacher")
    relation_rows = declared_jsonl(package_root, manifest, "course_teachers")
    relations = unique(relation_rows, "relation_id", "relation")
    relation_pairs = {(row.get("course_id"), row.get("teacher_id")) for row in relation_rows}
    evaluation_index = unique(evaluations, "evaluation_id", "evaluation")
    formula_evidence = verified_formula_evidence(manifest, package_root)
    formula_manifest_sha = manifest.get("formula_bar_evidence_manifest_sha256")
    if len(formula_evidence) == 14_985:
        rebuild_reports = declared_jsonl(package_root, manifest, "formula-bar-rebuild-verification")
        if len(rebuild_reports) != 1 or rebuild_reports[0].get("full_scan_audit_verified") is not True \
                or not all(rebuild_reports[0].get("closure", {}).values()):
            raise ValueError("production formula-bar rebuild closure is not verified")

    ai_verified, api_ready, api_blocked, quarantined, excluded = [], [], [], [], []
    for row in evaluation_index.values():
        reasons = row.get("manual_review_reasons")
        if not isinstance(reasons, list):
            raise ValueError(f"invalid manual review reasons: {row.get('evaluation_id')}")
        if isinstance((row.get("source") or {}).get("formula_bar"), dict) and not formula_provenance_valid(row, formula_evidence, formula_manifest_sha, manifest["files"]):
            raise ValueError(f"formula-bar package provenance mismatch: {row.get('evaluation_id')}")
        if "evidence_conflict" in reasons:
            quarantined.append({**row, "production_disposition": "quarantined", "production_reasons": reasons})
        elif not str(row.get("comment", "")).strip():
            excluded.append({**row, "production_disposition": "excluded", "production_reasons": ["comment_blank"]})
        elif reasons:
            quarantined.append({**row, "production_disposition": "quarantined", "production_reasons": reasons})
        else:
            validate_ai_candidate(row, relation_pairs)
            approved = {
                **row,
                "approval_status": "ai_verified",
                "approval_contract": "legacy-ai-evidence-approval-v1",
                "approval_basis": "independent_a_b_with_arbitration",
            }
            ai_verified.append(approved)
            (api_ready if api_evidence_compatible(row, formula_evidence, formula_manifest_sha, manifest["files"]) else api_blocked).append(approved)

    approved_course_ids = {row["course_id"] for row in ai_verified}
    approved_teacher_ids = {row["teacher_id"] for row in ai_verified}
    approved_pairs = {(row["course_id"], row["teacher_id"]) for row in ai_verified}
    approved_courses = [courses[key] for key in sorted(approved_course_ids)]
    approved_teachers = [teachers[key] for key in sorted(approved_teacher_ids)]
    approved_relations = [
        row for row in sorted(relations.values(), key=lambda item: item["relation_id"])
        if (row["course_id"], row["teacher_id"]) in approved_pairs
    ]
    templates = [
        {
            "legacy_course_id": row["course_id"], "legacy_course_name": courses[row["course_id"]]["name"],
            "legacy_teacher_id": row["teacher_id"], "legacy_teacher_name": teachers[row["teacher_id"]]["name"],
            "database_course_id": None, "database_teacher_id": None, "category": None,
        }
        for row in approved_relations
    ]

    out.mkdir(parents=True)
    files = {}
    artifacts = {
        "ai-verified-evaluations.jsonl": ai_verified,
        "api-ready-evaluations.jsonl": api_ready,
        "api-evidence-blocked.jsonl": api_blocked,
        "quarantined-evaluations.jsonl": quarantined,
        "excluded-evaluations.jsonl": excluded,
        "courses.jsonl": approved_courses,
        "teachers.jsonl": approved_teachers,
        "course-teachers.jsonl": approved_relations,
        "catalog-mapping-required.jsonl": templates,
    }
    for name, rows in artifacts.items():
        files[name] = write_jsonl(out / name, rows)
    counts = {
        "input_evaluations": len(evaluations), "ai_verified": len(ai_verified), "api_ready": len(api_ready),
        "api_evidence_blocked": len(api_blocked), "quarantined": len(quarantined),
        "excluded_blank": len(excluded),
        "pending_external_review": sum(
            "review_uncertain" in row["production_reasons"]
            or "formula_bar_missing_evaluation" in row["production_reasons"]
            for row in quarantined
        ),
    }
    partition_closed = counts["input_evaluations"] == counts["ai_verified"] + counts["quarantined"] + counts["excluded_blank"]
    if not partition_closed:
        raise ValueError("production staging evaluation partition does not close")
    staging_manifest = {
        "contract_version": "legacy-production-staging-v1",
        "status": "awaiting_catalog_mapping",
        "source_dataset_version": manifest.get("dataset_version"),
        "source_package_manifest_sha256": manifest_sha256,
        "approval_contract": "legacy-ai-evidence-approval-v1",
        "counts": counts,
        "closure": {"input_evaluations_partitioned_once": partition_closed},
        "files": files,
    }
    write_json(out / "production-staging-manifest.json", staging_manifest)
    return staging_manifest


def catalog_mapping(path: Path) -> dict[tuple[str, str], dict[str, Any]]:
    result = {}
    course_targets, teacher_targets = {}, {}
    for row in read_jsonl(path):
        pair = (row.get("legacy_course_id"), row.get("legacy_teacher_id"))
        if not all(isinstance(item, str) and item for item in pair) or pair in result:
            raise ValueError(f"invalid or duplicate catalog mapping: {pair}")
        course_id, teacher_id, category = row.get("database_course_id"), row.get("database_teacher_id"), row.get("category")
        if not isinstance(course_id, int) or course_id < 1 or not isinstance(teacher_id, int) or teacher_id < 1:
            raise ValueError(f"catalog mapping requires positive numeric IDs: {pair}")
        if category not in API_CATEGORIES:
            raise ValueError(f"invalid catalog category: {pair}")
        if pair[0] in course_targets and course_targets[pair[0]] != (course_id, category):
            raise ValueError(f"conflicting course mapping: {pair[0]}")
        if pair[1] in teacher_targets and teacher_targets[pair[1]] != teacher_id:
            raise ValueError(f"conflicting teacher mapping: {pair[1]}")
        course_targets[pair[0]] = (course_id, category)
        teacher_targets[pair[1]] = teacher_id
        result[pair] = row
    return result


def api_row(evaluation: dict[str, Any], mapping: dict[str, Any]) -> dict[str, Any]:
    source = evaluation["source"]
    formula = source.get("formula_bar") if isinstance(source.get("formula_bar"), dict) else None
    raw_text = formula["formula_bar_value"] if formula else source["ocr_text"]
    confidence = 1 if formula else source["ocr_confidence"]
    tokens = [{"text": raw_text, "confidence": 1}] if formula else source["ocr_tokens"]
    return {
        "course_id": mapping["database_course_id"], "teacher_id": mapping["database_teacher_id"],
        "offering_id": None, "category": mapping["category"], "comment": evaluation["comment"], "term": "",
        "source_file": source["review_source_file"], "sheet_name": evaluation["worksheet"],
        "source_row": f"{evaluation['source_row']}:{evaluation['source_column']}",
        "raw_ocr_text": raw_text, "ocr_confidence": confidence,
        "ocr_tokens_json": json.dumps(tokens, ensure_ascii=False, separators=(",", ":")),
        "inherited_from": str(evaluation.get("context_inherited_from_row") or ""),
        "ocr_course_name": evaluation["course_name"], "ocr_teacher_name": evaluation["teacher_name"],
        "duplicate_group": None, "source_type": "legacy_formula_bar" if formula else "legacy_ocr", "source_label": "腾讯表格历史资料",
    }


def compile_batches(staging_root: Path, mapping_path: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    manifest, staging_sha256 = verified_manifest(
        staging_root, "production-staging-manifest.json", "legacy-production-staging-v1",
    )
    rows = read_jsonl(staging_root / "api-ready-evaluations.jsonl")
    mappings = catalog_mapping(mapping_path)
    required_rows = read_jsonl(staging_root / "catalog-mapping-required.jsonl")
    required_pairs = {
        (row.get("legacy_course_id"), row.get("legacy_teacher_id"))
        for row in required_rows
    }
    if any(not all(isinstance(item, str) and item for item in pair) for pair in required_pairs):
        raise ValueError("invalid required catalog mapping pair")
    supplied_pairs = set(mappings)
    if supplied_pairs != required_pairs:
        missing = sorted(required_pairs - supplied_pairs)
        extra = sorted(supplied_pairs - required_pairs)
        raise ValueError(f"catalog mapping set mismatch: missing={missing}, extra={extra}")
    converted = []
    for row in rows:
        pair = (row.get("course_id"), row.get("teacher_id"))
        if pair not in mappings:
            raise ValueError(f"missing catalog mapping: {pair}")
        converted.append((row["evaluation_id"], api_row(row, mappings[pair])))

    out.mkdir(parents=True)
    payload_files = {}
    for offset in range(0, len(converted), 40):
        batch = converted[offset:offset + 40]
        number = offset // 40 + 1
        identity = json_bytes({"staging_manifest_sha256": staging_sha256, "evaluation_ids": [item[0] for item in batch]})
        payload = {
            "idempotencyKey": hashlib.sha256(identity).hexdigest(),
            "manifest": {
                "contract_version": "legacy-production-import-batch-v1",
                "staging_manifest_sha256": staging_sha256,
                "catalog_mapping_sha256": sha256(mapping_path),
                "evaluation_ids": [item[0] for item in batch],
            },
            "rows": [item[1] for item in batch],
        }
        name = f"batch-{number:04d}.json"
        write_json(out / name, payload)
        payload_files[name] = {"rows": len(batch), "sha256": sha256(out / name)}
    import_manifest = {
        "contract_version": "legacy-production-import-manifest-v1",
        "status": "ready_for_api_preview",
        "staging_manifest_sha256": staging_sha256,
        "catalog_mapping_sha256": sha256(mapping_path),
        "counts": {"rows": len(converted), "batches": len(payload_files)},
        "files": payload_files,
    }
    write_json(out / "import-manifest.json", import_manifest)
    return import_manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile verified legacy-review staging and production API payloads")
    subparsers = parser.add_subparsers(dest="command", required=True)
    stage = subparsers.add_parser("stage"); stage.add_argument("--package-root", required=True); stage.add_argument("--out", required=True)
    compile_parser = subparsers.add_parser("compile"); compile_parser.add_argument("--staging-root", required=True)
    compile_parser.add_argument("--catalog-mapping", required=True); compile_parser.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.command == "stage":
        result = stage_package(Path(args.package_root), Path(args.out))
    else:
        result = compile_batches(Path(args.staging_root), Path(args.catalog_mapping), Path(args.out))
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
