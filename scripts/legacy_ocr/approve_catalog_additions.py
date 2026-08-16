from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from compile_production_staging import json_bytes, read_json, read_jsonl, sha256, write_json, write_jsonl


def verified_request_queue(root: Path) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    manifest_path = root / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest.get("contract_version") != "legacy-catalog-identity-mapping-manifest-v1" or manifest.get("status") != "awaiting_owner_review":
        raise ValueError("input is not an awaiting-owner-review identity mapping package")
    declaration = (manifest.get("files") or {}).get("catalog-addition-requests.jsonl")
    request_path = root / "catalog-addition-requests.jsonl"
    if not isinstance(declaration, dict) or not request_path.is_file() or sha256(request_path) != declaration.get("sha256"):
        raise ValueError("catalog addition request queue integrity mismatch")
    rows = read_jsonl(request_path)
    if len(rows) != declaration.get("rows") or len(rows) != (manifest.get("counts") or {}).get("catalog_addition_requests"):
        raise ValueError("catalog addition request queue count mismatch")
    return manifest, sha256(manifest_path), rows


def approve_catalog_additions(mapping_root: Path, out: Path, decision_reference: str) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    if not decision_reference.strip():
        raise ValueError("decision reference is required")
    source_manifest, source_manifest_sha, requests = verified_request_queue(mapping_root)
    decisions = []
    seen: set[tuple[str, str]] = set()
    for request in requests:
        pair = (request.get("catalog_course_code"), request.get("catalog_teacher_label"))
        if (
            request.get("schema_version") != "legacy-catalog-addition-request-v1"
            or request.get("request_kind") != "relation"
            or request.get("reason") != "approved_catalog_relation_missing"
            or request.get("terminal_status") != "owner_review_required"
            or not all(isinstance(item, str) and item for item in pair)
            or pair in seen
        ):
            raise ValueError("request queue contains an ineligible batch-approval record")
        seen.add(pair)
        request_hash = hashlib.sha256(json_bytes(request)).hexdigest()
        decisions.append({
            "schema_version": "legacy-catalog-addition-decision-v1", "request_kind": "relation",
            "catalog_course_code": pair[0], "catalog_teacher_label": pair[1],
            "source_request_sha256": request_hash, "decision": "approve",
            "decision_mode": "owner_batch_approval", "decision_reference": decision_reference,
            "decision_reason": "frozen_legacy_relation_evidence_and_approved_catalog_identities",
        })
    decisions.sort(key=lambda row: (row["catalog_course_code"], row["catalog_teacher_label"]))
    out.mkdir(parents=True)
    artifact = write_jsonl(out / "decisions.jsonl", decisions)
    manifest = {
        "contract_version": "legacy-catalog-addition-decisions-manifest-v1",
        "status": "addition_requests_approved", "source_mapping_manifest_sha256": source_manifest_sha,
        "source_staging_manifest_sha256": source_manifest.get("source_staging_manifest_sha256"),
        "approved_catalog_manifest_sha256": source_manifest.get("approved_catalog_manifest_sha256"),
        "decision_reference": decision_reference, "counts": {"approved": len(decisions)},
        "files": {"decisions.jsonl": artifact},
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile an explicit owner batch approval for catalog Relation additions")
    parser.add_argument("--mapping-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--decision-reference", required=True)
    args = parser.parse_args()
    result = approve_catalog_additions(Path(args.mapping_root), Path(args.out), args.decision_reference)
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
