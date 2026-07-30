from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


def read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def merge(source_path: Path, shard_dirs: list[Path]) -> tuple[dict, list[dict], dict, dict]:
    raw = source_path.read_bytes()
    source = json.loads(raw.decode("utf-8-sig"))
    columns = [item["column"].upper() for item in source["review_columns"]]
    expected = [f"{source['worksheet']}|{row}|{column}" for row in range(source["rows"][0], source["rows"][1] + 1) for column in columns]
    cells: list[dict] = []
    attempts: list[dict] = []
    ranges = []
    for index, shard in enumerate(shard_dirs, 1):
        matrix = read(shard / "matrix.json")
        status = read(shard / "status.json")
        validation = read(shard / "validation.json")
        shard_unresolved = sum(cell.get("conclusion") == "unresolved" for cell in matrix.get("cells", []))
        shard_capture_gaps = sum(cell.get("status") == "capture_gap" for cell in matrix.get("cells", []))
        expected_status = "capture_blocked" if shard_capture_gaps else "completed" if shard_unresolved == 0 else "completed_with_exceptions"
        if (status.get("status") != expected_status or status.get("unresolved_cells") != shard_unresolved
                or status.get("capture_gap_cells", 0) != shard_capture_gaps
                or not validation.get("valid") or not validation.get("references_valid")):
            raise ValueError(f"shard {shard} is not completed and valid")
        if matrix.get("worksheet") != source["worksheet"] or [item["column"].upper() for item in matrix.get("review_columns", [])] != columns:
            raise ValueError(f"shard {shard} contract mismatch")
        ranges.append(tuple(matrix["rows"]))
        cells.extend(matrix["cells"])
        shard_attempts = read(shard / "attempts.json")
        if not isinstance(shard_attempts, list):
            raise ValueError(f"shard {shard} attempts must be an array")
        for attempt_index, attempt in enumerate(shard_attempts, 1):
            if not isinstance(attempt, dict) or not isinstance(attempt.get("task_id"), str) or not attempt["task_id"]:
                raise ValueError(f"shard {shard} contains an invalid attempt task_id")
            if attempt.get("side") not in {"analysis_a", "analysis_b", "arbitration"} or attempt.get("status") not in {"completed", "completed_with_exceptions", "failed"}:
                raise ValueError(f"shard {shard} contains an invalid attempt contract")
            if not isinstance(attempt.get("cell_keys"), list) or not attempt["cell_keys"] or not re.fullmatch(r"[0-9a-f]{64}", str(attempt.get("input_sha256", ""))):
                raise ValueError(f"shard {shard} contains invalid attempt evidence")
            attempts.append({
                **attempt,
                "shard": index,
                "source_attempt_index": attempt_index,
                "task_id": f"shard-{index:02d}/attempt-{attempt_index:06d}/{attempt.get('task_id', '')}",
            })
    covered_rows = [row for low, high in sorted(ranges) for row in range(low, high + 1)]
    if covered_rows != list(range(source["rows"][0], source["rows"][1] + 1)):
        raise ValueError("shard row ranges do not exactly cover the source")
    if any(not isinstance(cell, dict) or not isinstance(cell.get("key"), str) or not cell["key"] for cell in cells):
        raise ValueError("shard contains a cell without a valid key")
    by_key = {cell["key"]: cell for cell in cells}
    if len(by_key) != len(cells) or set(by_key) != set(expected):
        raise ValueError("shard cell keys are duplicated or incomplete")
    ordered = [by_key[key] for key in expected]
    unresolved = sum(cell.get("conclusion") == "unresolved" for cell in ordered)
    capture_gaps = sum(cell.get("status") == "capture_gap" for cell in ordered)
    matrix = {
        "contract_version": "ocr-first-cell-review-v2",
        "input_sha256": hashlib.sha256(raw).hexdigest(),
        "worksheet": source["worksheet"], "rows": source["rows"],
        "review_columns": source["review_columns"], "cells": ordered,
    }
    validation = {"valid": True, "expected_cells": len(expected), "actual_cells": len(ordered), "unique_keys": len(by_key), "references_valid": True}
    status = {
        "status": "capture_blocked" if capture_gaps else "completed" if unresolved == 0 else "completed_with_exceptions",
        "expected_cells": len(expected), "routed_cells": len(source["ocr_cells"]),
        "unresolved_cells": unresolved, "capture_gap_cells": capture_gaps,
    }
    return matrix, attempts, validation, status


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge completed row-sharded OCR-first workflows")
    parser.add_argument("--input", required=True)
    parser.add_argument("--shard", action="append", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    matrix, attempts, validation, status = merge(Path(args.input), [Path(item) for item in args.shard])
    out = Path(args.out)
    write(out / "matrix.json", matrix); write(out / "attempts.json", attempts)
    write(out / "validation.json", validation); write(out / "status.json", status)
    print(json.dumps(status, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
