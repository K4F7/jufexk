from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter
from copy import deepcopy
from pathlib import Path
from typing import Any

from compile_production_staging import declared_jsonl, json_bytes, read_json, sha256, verified_manifest, write_bytes


EVIDENCE_CONTRACT = "formula-bar-cell-evidence-v1"
EVIDENCE_SET_CONTRACT = "formula-bar-evidence-set-v1"
PACKAGE_CONTRACT = "legacy-review-package-v1"
TERMINAL_STATUSES = {"review_origin", "horizontal_overflow_blank", "ordinary_blank", "evidence_conflict"}
IDENTITY_FILES = ("courses", "teachers", "course_teachers", "capture_gaps")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
FULL_SCAN_PLAN_SHA256 = "379f8d7cae7cbfd8bc31bcd336734c4f17bf7479ba113dcb13b8fcd19e4ae18d"
FULL_SCAN_TARGET_SET_SHA256 = "5984eee86e3f587ea97a602c6991efd035005f73315a75d701d8a26998b86c11"
FULL_SCAN_TARGET_KEYS_SHA256 = "48206e7e17c44d24dff5e21bf4b5416566324f1ae78e7b452f8c0a8af80301a1"
FULL_SCAN_SHEETS = (
    ("主要课程", 19, 480, "F", "M", 3696),
    ("数学课", 8, 240, "D", "J", 1631),
    ("美育", 8, 201, "E", "M", 1746),
    ("大英和视听说", 8, 203, "H", "O", 1568),
    ("思政课", 8, 205, "G", "N", 1584),
    ("外教", 3, 199, "G", "N", 1576),
    ("MOOC", 8, 199, "G", "N", 1536),
    ("体育课", 6, 211, "D", "K", 1648),
)


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(stable_json(value).encode()).hexdigest()


def stable_id(kind: str, *parts: str) -> str:
    canonical = "\0".join([kind, *[unicodedata.normalize("NFC", part.strip()) for part in parts]])
    return f"{kind}-{hashlib.sha256(canonical.encode()).hexdigest()[:32]}"


def display_text(value: str) -> str:
    return "".join(unicodedata.normalize("NFKC", value).split())


def source_key(row: dict[str, Any]) -> str:
    return f"{row.get('worksheet')}|{row.get('source_row')}|{row.get('source_column')}"


def acknowledged_halt(row: dict[str, Any]) -> bool:
    return (
        row.get("halt_batch") is True
        and row.get("terminal_status") == "evidence_conflict"
        and row.get("conflict_reason") in {"active_address_mismatch", "formula_bar_reads_mismatch"}
        and row.get("evidence", {}).get("conflict_image") is not None
    )


def validate_reference(evidence_path: Path, reference: Any, kind: str) -> None:
    if reference is None:
        return
    if not isinstance(reference, dict) or reference.get("kind") != kind or not HEX64.fullmatch(str(reference.get("sha256", ""))):
        raise ValueError(f"invalid formula-bar {kind} reference")
    target = Path(str(reference.get("path", "")))
    target = target if target.is_absolute() else evidence_path.parent / target
    if not target.is_file() or sha256(target) != reference["sha256"]:
        raise ValueError(f"formula-bar evidence file hash mismatch: {reference.get('path')}")


def validate_evidence(path: Path, evidence: Any) -> dict[str, Any]:
    if not isinstance(evidence, dict) or evidence.get("contract_version") != EVIDENCE_CONTRACT:
        raise ValueError("invalid formula-bar evidence contract")
    record_hash = evidence.get("record_sha256")
    content = {key: value for key, value in evidence.items() if key != "record_sha256"}
    if not isinstance(record_hash, str) or content_hash(content) != record_hash:
        raise ValueError("formula-bar evidence hash mismatch")
    worksheet, row, column = evidence.get("worksheet"), evidence.get("row"), evidence.get("column")
    if not isinstance(worksheet, str) or not worksheet or not isinstance(row, int) or row < 1 or not isinstance(column, str):
        raise ValueError("invalid formula-bar evidence identity")
    if evidence.get("key") != f"{worksheet}|{row}|{column}" or evidence.get("target_address") != f"{column}{row}":
        raise ValueError("formula-bar evidence identity mismatch")
    status = evidence.get("terminal_status")
    if status not in TERMINAL_STATUSES or evidence.get("read_only") is not True:
        raise ValueError("invalid formula-bar terminal status")
    refs = evidence.get("evidence")
    if not isinstance(refs, dict):
        raise ValueError("invalid formula-bar evidence references")
    validate_reference(path, refs.get("cell_image"), "cell")
    validate_reference(path, refs.get("conflict_image"), "conflict")
    value = evidence.get("formula_bar_value")
    visible = evidence.get("visible_cell_text")
    target = evidence["target_address"]
    addresses = evidence.get("active_addresses")
    reads = evidence.get("formula_bar_reads")
    if not isinstance(addresses, list) or not isinstance(reads, list):
        raise ValueError("invalid formula-bar address/read sequence")
    if status != "evidence_conflict" or evidence.get("conflict_reason") == "visible_text_formula_mismatch":
        if addresses != [target, target] or len(reads) != 2:
            raise ValueError("formula-bar evidence is not address-bound double-read")
        for index, read in enumerate(reads, 1):
            if not isinstance(read, dict) or read.get("sequence") != index or read.get("value") != value:
                raise ValueError("invalid formula-bar read sequence")
            if read.get("sha256") != hashlib.sha256(str(read.get("value", "")).encode()).hexdigest():
                raise ValueError("formula-bar read hash mismatch")
    if status == "review_origin":
        if not isinstance(value, str) or not value or evidence.get("formula_bar_text_sha256") != hashlib.sha256(value.encode()).hexdigest():
            raise ValueError("invalid nonempty formula-bar evidence")
        if not isinstance(visible, str) or not display_text(visible) or not display_text(value).startswith(display_text(visible)):
            raise ValueError("formula-bar visible text does not match source")
        if refs.get("cell_image") is None or evidence.get("halt_batch") is not False:
            raise ValueError("nonempty formula-bar evidence lacks cell image")
    elif status in {"horizontal_overflow_blank", "ordinary_blank"}:
        if value != "" or evidence.get("formula_bar_nonempty") is not False:
            raise ValueError("invalid blank formula-bar evidence")
        if not isinstance(visible, str) or (status == "horizontal_overflow_blank") != bool(display_text(visible)):
            raise ValueError("formula-bar blank classification mismatch")
    elif refs.get("conflict_image") is None:
        raise ValueError("formula-bar conflict lacks conflict image")
    if isinstance(value, str) and evidence.get("formula_bar_nonempty") != bool(value):
        raise ValueError("formula-bar nonempty flag mismatch")
    if isinstance(visible, str) and evidence.get("visible_cell_text_sha256") != hashlib.sha256(visible.encode()).hexdigest():
        raise ValueError("formula-bar visible text hash mismatch")
    return evidence


def load_evidence_set(root: Path) -> tuple[dict[str, Any], str, list[dict[str, Any]], dict[str, Path]]:
    manifest_path = root / "evidence-manifest.json"
    manifest = read_json(manifest_path)
    if manifest.get("contract_version") != EVIDENCE_SET_CONTRACT or not isinstance(manifest.get("files"), dict):
        raise ValueError("invalid formula-bar evidence-set manifest")
    if not HEX64.fullmatch(str(manifest.get("source_locator_plan_sha256", ""))):
        raise ValueError("invalid source locator plan hash")
    rows = []
    seen = set()
    source_paths = {}
    for name, expected in sorted(manifest["files"].items()):
        path = root / name
        if not path.is_file() or sha256(path) != expected.get("sha256"):
            raise ValueError(f"formula-bar evidence manifest hash mismatch: {name}")
        evidence = validate_evidence(path, read_json(path))
        if expected.get("key") != evidence["key"]:
            raise ValueError(f"stale formula-bar evidence manifest key: {name}")
        if evidence["key"] in seen:
            raise ValueError(f"duplicate formula-bar evidence key: {evidence['key']}")
        seen.add(evidence["key"])
        rows.append(evidence)
        source_paths[evidence["key"]] = path
    expected_count = manifest.get("evidence_count")
    if expected_count != len(rows):
        raise ValueError("formula-bar evidence-set count mismatch")
    validate_full_scan_audit(root, manifest, rows)
    return manifest, sha256(manifest_path), rows, source_paths


def column_number(column: str) -> int:
    return sum((ord(character) - 64) * (26 ** index) for index, character in enumerate(reversed(column)))


def column_name(number: int) -> str:
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def full_scan_keys() -> list[str]:
    keys = []
    for worksheet, first_row, last_row, first_column, last_column, _cells in FULL_SCAN_SHEETS:
        columns = [column_name(number) for number in range(column_number(first_column), column_number(last_column) + 1)]
        keys.extend(f"{worksheet}|{row}|{column}" for row in range(first_row, last_row + 1) for column in columns)
    return keys


def validate_full_scan_audit(root: Path, manifest: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    declaration = manifest.get("full_scan_audit")
    if declaration is None:
        if len(rows) == 14_985:
            raise ValueError("full formula-bar evidence set lacks full-scan audit")
        return None
    if not isinstance(declaration, dict) or not isinstance(declaration.get("path"), str) or not HEX64.fullmatch(str(declaration.get("sha256", ""))):
        raise ValueError("invalid full-scan audit declaration")
    audit_path = root / declaration["path"]
    if not audit_path.is_file() or sha256(audit_path) != declaration["sha256"]:
        raise ValueError("full-scan audit file hash mismatch")
    audit = read_json(audit_path)
    audit_hash = audit.get("audit_sha256")
    audit_content = {key: value for key, value in audit.items() if key != "audit_sha256"}
    if audit.get("contract_version") != "formula-bar-full-scan-audit-v1" or content_hash(audit_content) != audit_hash:
        raise ValueError("invalid full-scan audit contract or hash")
    expected_keys = full_scan_keys()
    by_key = {row["key"]: row for row in rows}
    if len(by_key) != len(rows) or set(by_key) != set(expected_keys):
        raise ValueError("full-scan evidence keys do not cover frozen matrix")
    expected_worksheets = [
        {"worksheet": worksheet, "planned_cells": cells, "completed_cells": cells}
        for worksheet, _first, _last, _first_column, _last_column, cells in FULL_SCAN_SHEETS
    ]
    actual_worksheets = audit.get("worksheets")
    if not isinstance(actual_worksheets, list) or [
        {key: row.get(key) for key in ("worksheet", "planned_cells", "completed_cells")}
        for row in actual_worksheets
    ] != expected_worksheets:
        raise ValueError("full-scan worksheet count mismatch")
    record_hashes = [by_key[key]["record_sha256"] for key in expected_keys]
    strong_keys = manifest.get("strong_suspect_keys")
    if not isinstance(strong_keys, list) or len(strong_keys) != 110 or len(set(strong_keys)) != 110:
        raise ValueError("invalid strong-suspect key declaration")
    strong_keys = sorted(strong_keys)
    if (
        manifest.get("strong_suspect_keys_sha256") != FULL_SCAN_TARGET_KEYS_SHA256
        or hashlib.sha256(stable_json(strong_keys).encode()).hexdigest() != FULL_SCAN_TARGET_KEYS_SHA256
        or any(key not in by_key for key in strong_keys)
    ):
        raise ValueError("strong-suspect key set differs from frozen target set")
    strong_set = set(strong_keys)
    if any(
        row.get("read_only") is not True
        or (row.get("halt_batch") is not False and not acknowledged_halt(row))
        for row in rows
    ):
        raise ValueError("full-scan evidence contains nonterminal or writable record")
    for row in rows:
        cell = row.get("evidence", {}).get("cell_image")
        reason = row.get("cell_image_reason")
        if acknowledged_halt(row):
            if cell is not None:
                raise ValueError(f"full-scan halted conflict has redundant cell screenshot: {row['key']}")
            continue
        if row.get("formula_bar_nonempty") is True and (cell is None or reason != "formula_nonempty"):
            raise ValueError(f"full-scan nonempty formula lacks original screenshot: {row['key']}")
        if row["key"] in strong_set and cell is None:
            raise ValueError(f"full-scan strong suspect lacks screenshot: {row['key']}")
        if row.get("formula_bar_nonempty") is False:
            if row["key"] in strong_set and reason != "forced_scope":
                raise ValueError(f"full-scan blank strong suspect lacks forced screenshot: {row['key']}")
            if row["key"] not in strong_set and (reason is not None or cell is not None):
                raise ValueError(f"full-scan ordinary blank has redundant screenshot: {row['key']}")
    if (
        manifest.get("source_locator_plan_sha256") != FULL_SCAN_PLAN_SHA256
        or manifest.get("strong_suspect_count") != 110
        or manifest.get("strong_suspect_target_set_sha256") != FULL_SCAN_TARGET_SET_SHA256
        or audit.get("status") != "completed"
        or audit.get("plan_sha256") != FULL_SCAN_PLAN_SHA256
        or audit.get("planned_rows") != 1_878
        or audit.get("planned_cells") != 14_985
        or audit.get("completed_cells") != 14_985
        or audit.get("strong_suspect_cells") != 110
        or audit.get("strong_suspect_keys_sha256") != FULL_SCAN_TARGET_KEYS_SHA256
        or audit.get("checkpoint_count") != 78
        or not isinstance(audit.get("checkpoint_sha256s"), list)
        or len(audit["checkpoint_sha256s"]) != 78
        or audit.get("evidence_content_sha256") != hashlib.sha256(stable_json(record_hashes).encode()).hexdigest()
        or audit.get("read_only") is not True
    ):
        raise ValueError("full-scan audit does not close frozen production matrix")
    return audit


def formula_source(evidence: dict[str, Any], evidence_manifest_sha256: str) -> dict[str, Any]:
    cell = evidence["evidence"].get("cell_image")
    conflict = evidence["evidence"].get("conflict_image")
    return {
        "contract_version": EVIDENCE_CONTRACT,
        "evidence_manifest_sha256": evidence_manifest_sha256,
        "record_sha256": evidence["record_sha256"],
        "key": evidence["key"],
        "target_address": evidence["target_address"],
        "terminal_status": evidence["terminal_status"],
        "formula_bar_value": evidence.get("formula_bar_value"),
        "formula_bar_text_sha256": evidence.get("formula_bar_text_sha256"),
        "cell_image_sha256": cell.get("sha256") if cell else None,
        "conflict_image_sha256": conflict.get("sha256") if conflict else None,
        "cell_image_file": f"formula_bar_images/{cell['sha256']}.bin" if cell else None,
        "conflict_image_file": f"formula_bar_images/{conflict['sha256']}.bin" if conflict else None,
    }


def missing_evaluation(evidence: dict[str, Any], peers: list[dict[str, Any]], version: str, evidence_sha: str) -> dict[str, Any]:
    identities = {(row.get("course_id"), row.get("course_name"), row.get("teacher_id"), row.get("teacher_name")) for row in peers}
    identity = sorted(identities, key=lambda item: tuple(str(part or "") for part in item))[0] if len(identities) == 1 else (None, "[unclear]", None, "[unclear]")
    course_id, course_name, teacher_id, teacher_name = identity
    reasons = ["formula_bar_missing_evaluation"]
    if course_id is None:
        reasons.extend(["course_unclear", "teacher_unclear"])
    source = deepcopy(peers[0].get("source", {})) if len(identities) == 1 else {}
    source["formula_bar"] = formula_source(evidence, evidence_sha)
    return {
        "schema_version": "historical-evaluation-v1", "dataset_version": version,
        "evaluation_id": stable_id("evaluation", evidence_sha, evidence["key"]),
        "review_status": "needs_review", "manual_review_reasons": reasons,
        "worksheet": evidence["worksheet"], "source_row": evidence["row"], "source_column": evidence["column"],
        "course_id": course_id, "course_name": course_name, "teacher_id": teacher_id, "teacher_name": teacher_name,
        "comment": evidence.get("formula_bar_value") or "", "context_inherited_from_row": None,
        "review_conclusion": "formula_bar_discovered", "review_selected": "formula_bar",
        "review_uncertainty_markers": ["missing historical evaluation"], "context_uncertainty_markers": [],
        "context_raw": peers[0].get("context_raw", "") if len(identities) == 1 else "", "context_conclusion": "inherited_from_source_row",
        "source": source,
    }


def rebuild_package(package_root: Path, evidence_root: Path, out: Path, version: str) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    base_manifest, base_sha = verified_manifest(package_root, "package-manifest.json", PACKAGE_CONTRACT)
    evidence_manifest, evidence_sha, evidence_rows, evidence_paths = load_evidence_set(evidence_root)
    evaluations = declared_jsonl(package_root, base_manifest, "historical_evaluations")
    by_key: dict[str, dict[str, Any]] = {}
    for row in evaluations:
        key = source_key(row)
        if key in by_key:
            raise ValueError(f"duplicate historical evaluation source key: {key}")
        by_key[key] = deepcopy(row)
    immutable_fields = ("course_id", "course_name", "teacher_id", "teacher_name", "worksheet", "source_row", "source_column", "context_raw")
    original_identities = {row["evaluation_id"]: tuple(row.get(field) for field in immutable_fields) for row in evaluations}
    peers_by_row: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for row in evaluations:
        peers_by_row.setdefault((row.get("worksheet"), row.get("source_row")), []).append(row)

    full_audit = validate_full_scan_audit(evidence_root, evidence_manifest, evidence_rows)
    evidence_keys = {row["key"] for row in evidence_rows}
    original_keys = set(by_key)
    existing_coverage_closed = original_keys <= evidence_keys
    if full_audit is not None and not existing_coverage_closed:
        raise ValueError("full formula-bar scan does not cover every historical evaluation")

    reconciliation = []
    for evidence in evidence_rows:
        key, status = evidence["key"], evidence["terminal_status"]
        existing = by_key.get(key)
        action = "no_existing_blank"
        if status == "review_origin":
            if existing is None:
                existing = missing_evaluation(evidence, peers_by_row.get((evidence["worksheet"], evidence["row"]), []), version, evidence_sha)
                by_key[key] = existing
                action = "created_needs_review"
            else:
                existing["comment"] = evidence["formula_bar_value"]
                existing["dataset_version"] = version
                existing.setdefault("source", {})["formula_bar"] = formula_source(evidence, evidence_sha)
                existing["manual_review_reasons"] = [reason for reason in existing.get("manual_review_reasons", []) if reason != "comment_blank"]
                existing["review_status"] = "needs_review" if existing["manual_review_reasons"] else "candidate"
                action = "retained_formula_text"
        elif existing is not None:
            existing["dataset_version"] = version
            existing.setdefault("source", {})["formula_bar"] = formula_source(evidence, evidence_sha)
            if status in {"horizontal_overflow_blank", "ordinary_blank"}:
                existing["comment"] = ""
                existing["manual_review_reasons"] = [status]
                existing["review_status"] = "needs_review"
                action = "excluded_blank"
            else:
                reasons = list(existing.get("manual_review_reasons", []))
                if "evidence_conflict" not in reasons:
                    reasons.append("evidence_conflict")
                existing["manual_review_reasons"] = reasons
                existing["review_status"] = "needs_review"
                action = "quarantined_conflict"
        elif status == "evidence_conflict":
            existing = missing_evaluation(evidence, peers_by_row.get((evidence["worksheet"], evidence["row"]), []), version, evidence_sha)
            existing["manual_review_reasons"] = ["evidence_conflict"]
            by_key[key] = existing
            action = "quarantined_conflict"
        reconciliation.append({"key": key, "terminal_status": status, "action": action, "record_sha256": evidence["record_sha256"]})

    for evaluation_id, identity in original_identities.items():
        row = next(row for row in by_key.values() if row["evaluation_id"] == evaluation_id)
        if tuple(row.get(field) for field in immutable_fields) != identity:
            raise ValueError(f"formula rebuild changed historical identity: {evaluation_id}")
    for row in by_key.values():
        row["dataset_version"] = version

    sheet_order = {name: index for index, name in enumerate(["主要课程", "数学课", "美育", "大英和视听说", "思政课", "外教", "MOOC", "体育课"])}
    rebuilt = sorted(by_key.values(), key=lambda row: (sheet_order.get(row.get("worksheet"), 99), row.get("source_row", 0), row.get("source_column", ""), row["evaluation_id"]))
    statuses = Counter(row["terminal_status"] for row in evidence_rows)
    actions = Counter(row["action"] for row in reconciliation)
    reconciliation_by_key = {row["key"]: row for row in reconciliation}
    original_partition = Counter(reconciliation_by_key[key]["action"] for key in original_keys if key in reconciliation_by_key)
    original_partition_closed = sum(original_partition.values()) == len(evaluations)
    production_partition_actions = {"retained_formula_text", "excluded_blank", "quarantined_conflict"}
    production_partition_closed = full_audit is None or (
        len(evaluations) == 1_972 and original_partition_closed and set(original_partition) <= production_partition_actions
    )
    evidence_by_key = {row["key"]: row for row in evidence_rows}
    origin_inventory_closed = all(
        key in by_key and by_key[key].get("comment") == evidence.get("formula_bar_value")
        for key, evidence in evidence_by_key.items() if evidence.get("terminal_status") == "review_origin"
    )
    approved_rows = [row for row in rebuilt if not row.get("manual_review_reasons") and str(row.get("comment", "")).strip()]
    approved_origins_only = full_audit is None or all(
        evidence_by_key.get(source_key(row), {}).get("terminal_status") == "review_origin" for row in approved_rows
    )
    approved_by_source_row: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for row in approved_rows:
        approved_by_source_row.setdefault((row.get("worksheet"), row.get("source_row")), []).append(row)
    adjacent_duplicate_rule_closed = True
    if full_audit is not None:
        for peers in approved_by_source_row.values():
            ordered = sorted(peers, key=lambda row: column_number(str(row.get("source_column", ""))))
            for left, right in zip(ordered, ordered[1:]):
                if (
                    column_number(str(right.get("source_column"))) == column_number(str(left.get("source_column"))) + 1
                    and display_text(str(left.get("comment", ""))) == display_text(str(right.get("comment", "")))
                    and any(evidence_by_key.get(source_key(row), {}).get("terminal_status") != "review_origin" for row in (left, right))
                ):
                    adjacent_duplicate_rule_closed = False
    report = {
        "contract_version": "formula-bar-rebuild-verification-v1", "status": "closed", "dataset_version": version,
        "source_package_manifest_sha256": base_sha, "evidence_manifest_sha256": evidence_sha,
        "source_locator_plan_sha256": evidence_manifest.get("source_locator_plan_sha256"),
        "counts": {"evidence": len(evidence_rows), "source_evaluations": len(evaluations), "terminal_statuses": dict(sorted(statuses.items())), "actions": dict(sorted(actions.items())), "original_partition": dict(sorted(original_partition.items())), "output_evaluations": len(rebuilt)},
        "closure": {"evidence_equals_terminal_statuses": len(evidence_rows) == sum(statuses.values()), "evidence_equals_actions": len(evidence_rows) == sum(actions.values()), "all_existing_evaluations_have_formula_evidence": existing_coverage_closed, "original_evaluations_partitioned_once": original_partition_closed, "production_1972_partition_closed": production_partition_closed, "nonempty_origin_inventory_closed": origin_inventory_closed, "approved_rows_are_verified_origins": approved_origins_only, "adjacent_duplicate_rule_closed": adjacent_duplicate_rule_closed, "full_scan_audit_requirement_satisfied": full_audit is not None or len(evidence_rows) != 14_985, "identity_mapping_unchanged": True},
        "full_scan_audit_verified": full_audit is not None,
        "identity_rows_checked": len(original_identities),
    }
    if not all(report["closure"].values()):
        raise ValueError("formula-bar rebuild count closure failed")

    out.mkdir(parents=True)
    files: dict[str, dict[str, Any]] = {}
    source_manifest_name = "formula_bar_evidence_manifest.source.json"
    source_manifest_path = evidence_root / "evidence-manifest.json"
    write_bytes(out / source_manifest_name, source_manifest_path.read_bytes())
    files[source_manifest_name] = {"kind": "binary", "bytes": (out / source_manifest_name).stat().st_size, "sha256": sha256(out / source_manifest_name)}
    source_audit_name = None
    source_audit = evidence_manifest.get("full_scan_audit")
    if isinstance(source_audit, dict):
        source_audit_path = evidence_root / str(source_audit.get("path", ""))
        if not source_audit_path.is_file() or sha256(source_audit_path) != source_audit.get("sha256"):
            raise ValueError("full-scan audit changed before package assembly")
        source_audit_name = "formula_bar_full_scan_audit.source.json"
        write_bytes(out / source_audit_name, source_audit_path.read_bytes())
        files[source_audit_name] = {"kind": "binary", "bytes": (out / source_audit_name).stat().st_size, "sha256": sha256(out / source_audit_name)}
    bundled_records = {}
    for original_name, expected in sorted(evidence_manifest["files"].items()):
        source_path = evidence_root / original_name
        bundled_name = f"formula_bar_records/{expected['sha256']}.json"
        write_bytes(out / bundled_name, source_path.read_bytes())
        files[bundled_name] = {"kind": "binary", "bytes": (out / bundled_name).stat().st_size, "sha256": sha256(out / bundled_name)}
        bundled_records[original_name] = bundled_name
    for evidence in evidence_rows:
        evidence_path = evidence_paths[evidence["key"]]
        for reference in evidence["evidence"].values():
            if reference is None:
                continue
            source_path = Path(reference["path"])
            source_path = source_path if source_path.is_absolute() else evidence_path.parent / source_path
            name = f"formula_bar_images/{reference['sha256']}.bin"
            target = out / name
            if not target.exists():
                write_bytes(target, source_path.read_bytes())
            files[name] = {"kind": "binary", "bytes": target.stat().st_size, "sha256": sha256(target)}
    objects = {"historical_evaluations": rebuilt}
    for prefix in IDENTITY_FILES:
        objects[prefix] = declared_jsonl(package_root, base_manifest, prefix)
    objects["formula_bar_overlay"] = sorted(reconciliation, key=lambda row: row["key"])
    objects["formula_bar_evidence"] = sorted(evidence_rows, key=lambda row: row["key"])
    for prefix, rows in objects.items():
        name = f"{prefix}.{version}.jsonl"
        write_bytes(out / name, b"".join(json_bytes(row) for row in rows))
        files[name] = {"rows": len(rows), "sha256": sha256(out / name)}
    report_name = "formula-bar-rebuild-verification.jsonl"
    write_bytes(out / report_name, json_bytes(report))
    files[report_name] = {"rows": 1, "sha256": sha256(out / report_name)}
    manifest = {
        "contract_version": PACKAGE_CONTRACT, "dataset_version": version,
        "source_package_manifest_sha256": base_sha,
        "formula_bar_evidence_manifest_sha256": evidence_sha,
        "formula_bar_evidence_manifest_file": source_manifest_name,
        "formula_bar_full_scan_audit_file": source_audit_name,
        "formula_bar_full_scan_audit_sha256": source_audit.get("sha256") if isinstance(source_audit, dict) else None,
        "formula_bar_record_files": bundled_records,
        "files": files,
    }
    write_bytes(out / "package-manifest.json", json_bytes(manifest))
    return {"manifest": manifest, "report": report}


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild legacy evaluations from verified formula-bar evidence")
    parser.add_argument("--package-root", required=True); parser.add_argument("--evidence-root", required=True)
    parser.add_argument("--version", required=True); parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = rebuild_package(Path(args.package_root), Path(args.evidence_root), Path(args.out), args.version)
    print(stable_json(result["report"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
