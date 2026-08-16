from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


SHEET_ORDER = ["主要课程", "数学课", "美育", "大英和视听说", "思政课", "外教", "MOOC", "体育课"]
CONTRACT_VERSION = "ocr-first-smoke-sample-v1"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def select_smoke_cells(queue: list[dict[str, Any]], sheets: list[str]) -> list[dict[str, Any]]:
    selected = []
    for sheet in sheets:
        candidates = sorted(
            (item for item in queue if item.get("worksheet") == sheet),
            key=lambda item: (int(item["row"]), str(item["column"])),
        )
        if not candidates:
            raise ValueError(f"missing non-empty smoke cell for {sheet}")
        selected.append(candidates[0])
    return selected


def build(queue_root: Path, capture_root: Path, output: Path) -> dict[str, Any]:
    matrix = json.loads((queue_root / "matrix.json").read_text(encoding="utf-8-sig"))
    queue = [json.loads(line) for line in (queue_root / "review-queue.jsonl").read_text(encoding="utf-8-sig").splitlines() if line]
    manifest_path = capture_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    matrix_by_key = {item["key"]: item for item in matrix}
    errors: list[str] = []

    if len(matrix_by_key) != len(matrix):
        errors.append("matrix keys are not unique")
    queue_keys = set()
    for item in queue:
        key = item["key"]
        queue_keys.add(key)
        if key not in matrix_by_key or matrix_by_key[key]["status"] != "pending_review":
            errors.append(f"queue key is not pending in matrix: {key}")
        if manifest["files"].get(item["source_file"]) != item["source_sha256"]:
            errors.append(f"source hash mismatch: {key}")
        crop = Path(item["crop"])
        if not crop.is_file() or sha256_file(crop) != item["crop_sha256"]:
            errors.append(f"queue crop hash mismatch: {key}")

    for item in matrix:
        sheet, row, column = item["key"].split("|")
        crop = queue_root / "crops" / sheet / f"{int(row):03d}-{column}.png"
        if not crop.is_file() or sha256_file(crop) != item["crop_sha256"]:
            errors.append(f"matrix crop hash mismatch: {item['key']}")
        expected_pending = item["key"] in queue_keys
        if (item["status"] == "pending_review") != expected_pending:
            errors.append(f"matrix routing mismatch: {item['key']}")

    selected = select_smoke_cells(queue, SHEET_ORDER)
    payload = {
        "contract_version": CONTRACT_VERSION,
        "manifest_sha256": sha256_file(manifest_path),
        "cells": selected,
    }
    validation = {
        "valid": not errors,
        "manifest_sha256": payload["manifest_sha256"],
        "matrix_cells": len(matrix),
        "unique_keys": len(matrix_by_key),
        "routed_cells": len(queue),
        "blank_cells": len(matrix) - len(queue),
        "verified_crop_hashes": len(matrix),
        "smoke_sheets": [item["worksheet"] for item in selected],
        "errors": errors,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "smoke-sample.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
    if errors:
        raise ValueError(f"cell queue validation failed with {len(errors)} error(s)")
    return validation


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the cell queue and select one non-empty smoke cell per sheet")
    parser.add_argument("--queue-root", required=True)
    parser.add_argument("--capture-root", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    print(json.dumps(build(Path(args.queue_root), Path(args.capture_root), Path(args.out)), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
