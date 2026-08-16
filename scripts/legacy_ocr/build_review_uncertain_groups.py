from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build(targets_path: Path, geometry_path: Path, matrix_root: Path, out: Path) -> dict[str, Any]:
    targets = {item["key"]: item for item in read_jsonl(targets_path)}
    geometry = {item["key"]: item for item in read_jsonl(geometry_path)}
    if set(targets) != set(geometry):
        raise ValueError("target and geometry key sets differ")
    matrix_cells: dict[str, dict[str, Any]] = {}
    for path in matrix_root.glob("*/matrix.json"):
        for cell in json.loads(path.read_text(encoding="utf-8-sig"))["cells"]:
            matrix_cells[cell["key"]] = cell

    grouped: dict[tuple[str, str], list[str]] = defaultdict(list)
    for key, item in geometry.items():
        if item["classification"] == "expandable":
            grouped[(targets[key]["worksheet"], targets[key]["column"])].append(key)
    groups = []
    for (worksheet, column), keys in sorted(grouped.items()):
        keys.sort(key=lambda key: targets[key]["row"])
        first = targets[keys[0]]["row"]
        last = targets[keys[-1]]["row"]
        contexts = {}
        for row in range(first, last + 1):
            candidates = [
                cell for cell in matrix_cells.values()
                if cell.get("worksheet") == worksheet and cell.get("row") == row and isinstance(cell.get("context"), dict)
            ]
            if not candidates:
                raise ValueError(f"context missing for {worksheet}|{row}")
            contexts[row] = candidates[0]["context"]
        ocr_cells = []
        for key in keys:
            target = targets[key]
            geo = geometry[key]
            crop = Path(geo["new_crop"])
            if not crop.exists():
                raise ValueError(f"expanded crop missing: {key}")
            ocr_cells.append({
                "row": target["row"],
                "column": column,
                "tokens": target["ocr_tokens"],
                "confidence": target["ocr_confidence"],
                "crop": str(crop.resolve()),
            })
        group_id = f"{worksheet}-{column}"
        input_path = out / "inputs" / f"{group_id}.json"
        result_path = out / "agent-review" / worksheet / column
        write_json(input_path, {
            "worksheet": worksheet,
            "rows": [first, last],
            "review_columns": [{"column": column, "display_header": f"source column {column}"}],
            "context_index": [contexts[row] for row in range(first, last + 1)],
            "ocr_cells": ocr_cells,
            "capture_gaps": [],
        })
        groups.append({
            "group_id": group_id,
            "worksheet": worksheet,
            "column": column,
            "target_count": len(keys),
            "keys": keys,
            "input": str(input_path.resolve()),
            "output": str(result_path.resolve()),
        })
    manifest = {
        "contract_version": "review-uncertain-agent-groups-v1",
        "group_count": len(groups),
        "target_count": sum(group["target_count"] for group in groups),
        "max_agent_batch_size": 8,
        "groups": groups,
    }
    write_json(out / "agent-groups.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Build isolated agent inputs for expandable review_uncertain crops")
    parser.add_argument("--targets", required=True)
    parser.add_argument("--geometry", required=True)
    parser.add_argument("--matrix-root", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = build(Path(args.targets), Path(args.geometry), Path(args.matrix_root), Path(args.out))
    print(json.dumps({key: result[key] for key in ("group_count", "target_count", "max_agent_batch_size")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
