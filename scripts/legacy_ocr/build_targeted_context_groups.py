from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from build_context_review_groups import FIELD_PIXELS, MAPPINGS


TARGET_RANGES = {
    "主要课程": [(62, 62), (191, 193), (422, 456)],
    "体育课": [(24, 25)],
}


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def build_group(sheet: str, low: int, high: int, by_key: dict[tuple[str, int], dict]) -> dict:
    course_column, teacher_columns = MAPPINGS[sheet]
    pixels = FIELD_PIXELS[sheet]
    mapping = (
        f"course source column {course_column}, crop-relative x={pixels['course']}; "
        f"teacher source column(s) {','.join(teacher_columns)}, crop-relative x={pixels['teacher']}; "
        "ignore all other pixels"
    )
    cells = []
    for row in range(low, high + 1):
        item = by_key.get((sheet, row))
        if item is None:
            raise ValueError(f"missing targeted context patch: {sheet}|{row}")
        cells.append(
            {
                "row": row,
                "column": "CTX",
                "tokens": item.get("tokens", []),
                "text": item.get("text", ""),
                "confidence": item.get("confidence"),
                "crop": item["crop"],
            }
        )
    return {
        "worksheet": sheet,
        "rows": [low, high],
        "review_columns": [{"column": "CTX", "display_header": mapping}],
        "context_index": [
            {"row": row, "course": "[pending]", "teacher": "[pending]"}
            for row in range(low, high + 1)
        ],
        "ocr_cells": cells,
        "capture_gaps": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build isolated context-review groups for the v15 recapture")
    parser.add_argument("--context-patches", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    patches = load_jsonl(Path(args.context_patches))
    by_key = {(item["worksheet"], item["row"]): item for item in patches}
    if len(by_key) != len(patches):
        raise ValueError("duplicate worksheet/row in context patches")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    summary = defaultdict(int)
    for sheet, ranges in TARGET_RANGES.items():
        for low, high in ranges:
            group = build_group(sheet, low, high, by_key)
            name = f"{sheet}-{low:03d}-{high:03d}.json"
            (out / name).write_text(json.dumps(group, ensure_ascii=False, indent=2), encoding="utf-8")
            summary[sheet] += high - low + 1

    expected = {(sheet, row) for sheet, ranges in TARGET_RANGES.items() for low, high in ranges for row in range(low, high + 1)}
    if set(by_key) != expected:
        extra = sorted(set(by_key) - expected)
        missing = sorted(expected - set(by_key))
        raise ValueError(f"target mismatch: extra={extra}, missing={missing}")
    result = {"groups": sum(len(ranges) for ranges in TARGET_RANGES.values()), "rows": sum(summary.values()), "worksheets": dict(summary)}
    (out / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
