from __future__ import annotations

import argparse
import json
from pathlib import Path


GROUPS = [
    ("主要课程", 63, 65, ["F", "G", "H", "I"]),
    ("主要课程", 98, 98, ["K"]),
    ("主要课程", 121, 121, ["H"]),
    ("主要课程", 122, 126, ["F", "G", "H", "I", "J", "K", "L", "M"]),
    ("主要课程", 323, 323, ["F"]),
    ("主要课程", 439, 439, ["F"]),
    ("主要课程", 449, 449, ["F"]),
    ("大英和视听说", 56, 56, ["H"]),
]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def selected_context(cell: dict) -> tuple[str, str] | None:
    selected = cell.get("selected")
    analysis = cell.get(selected) if selected else None
    if not analysis:
        return None
    raw = analysis.get("corrected_text") or analysis.get("raw_transcription") or ""
    if not raw.startswith("course=") or "\nteacher=" not in raw:
        raise ValueError(f"invalid selected context format: {cell.get('key')}: {raw!r}")
    course, separator, teacher = raw[7:].rpartition("\nteacher=")
    if not separator:
        raise ValueError(f"invalid selected context format: {cell.get('key')}: {raw!r}")
    normalize = lambda value: "".join(line.strip() for line in value.splitlines())
    return normalize(course), normalize(teacher)


def resolved_contexts(old_root: Path, new_root: Path) -> dict[tuple[str, int], dict]:
    cells: dict[tuple[str, int], dict] = {}
    for matrix_path in old_root.glob("*/matrix.json"):
        for cell in load_json(matrix_path)["cells"]:
            cells[(cell["worksheet"], cell["row"])] = cell
    for matrix_path in new_root.glob("*/matrix.json"):
        for cell in load_json(matrix_path)["cells"]:
            cells[(cell["worksheet"], cell["row"])] = cell

    result = {}
    sheets = sorted({sheet for sheet, _ in cells})
    for sheet in sheets:
        carry_course = ""
        for key in sorted((key for key in cells if key[0] == sheet), key=lambda item: item[1]):
            cell = cells[key]
            parsed = selected_context(cell)
            if parsed is None:
                if cell.get("status") == "capture_gap":
                    carry_course = ""
                result[key] = {"row": key[1], "course": "[unavailable]", "teacher": "[unavailable]"}
                continue
            course, teacher = parsed
            if course == "[blank]":
                course = carry_course or "[blank]"
            elif course == "[unclear]":
                carry_course = ""
            else:
                carry_course = course
            result[key] = {"row": key[1], "course": course, "teacher": teacher}
    return result


def build_group(
    sheet: str,
    low: int,
    high: int,
    columns: list[str],
    patches: dict[str, dict],
    contexts: dict[tuple[str, int], dict],
) -> dict:
    expected = [f"{sheet}|{row}|{column}" for row in range(low, high + 1) for column in columns]
    missing = [key for key in expected if key not in patches]
    if missing:
        raise ValueError(f"missing targeted review patches: {missing}")
    return {
        "worksheet": sheet,
        "rows": [low, high],
        "review_columns": [{"column": column, "display_header": f"legacy review source column {column}"} for column in columns],
        "context_index": [
            contexts.get((sheet, row), {"row": row, "course": "[unavailable]", "teacher": "[unavailable]"})
            for row in range(low, high + 1)
        ],
        "ocr_cells": [
            {
                "row": item["row"],
                "column": item["column"],
                "tokens": item.get("tokens", []),
                "text": item.get("text", ""),
                "confidence": item.get("confidence"),
                "crop": item["crop"],
            }
            for key in expected
            for item in [patches[key]]
        ],
        "capture_gaps": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build isolated review groups for the v15 recapture")
    parser.add_argument("--review-patches", required=True)
    parser.add_argument("--old-context-root", required=True)
    parser.add_argument("--new-context-root", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    items = load_jsonl(Path(args.review_patches))
    patches = {item["key"]: item for item in items}
    if len(patches) != len(items):
        raise ValueError("duplicate review patch key")
    contexts = resolved_contexts(Path(args.old_context_root), Path(args.new_context_root))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    expected_keys = set()
    summary = {"groups": len(GROUPS), "cells": 0, "worksheets": {}}
    for sheet, low, high, columns in GROUPS:
        group = build_group(sheet, low, high, columns, patches, contexts)
        name = f"{sheet}-{low:03d}-{high:03d}-{'-'.join(columns)}.json"
        (out / name).write_text(json.dumps(group, ensure_ascii=False, indent=2), encoding="utf-8")
        keys = {f"{sheet}|{row}|{column}" for row in range(low, high + 1) for column in columns}
        expected_keys.update(keys)
        summary["cells"] += len(keys)
        summary["worksheets"][sheet] = summary["worksheets"].get(sheet, 0) + len(keys)
    if set(patches) != expected_keys:
        raise ValueError(f"review target mismatch: extra={sorted(set(patches) - expected_keys)}, missing={sorted(expected_keys - set(patches))}")
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
