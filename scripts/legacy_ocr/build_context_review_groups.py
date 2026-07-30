from __future__ import annotations

import argparse
import json
from pathlib import Path


MAPPINGS = {
    "主要课程": ("A", ["E"]),
    "数学课": ("B", ["C"]),
    "美育": ("A", ["D"]),
    "大英和视听说": ("A", ["E"]),
    "思政课": ("A", ["F"]),
    "外教": ("A", ["E", "F"]),
    "MOOC": ("A", ["E"]),
    "体育课": ("A", ["B"]),
}

FIELD_PIXELS = {
    "主要课程": {"course": "0:212", "teacher": "618:862"},
    "数学课": {"course": "276:638", "teacher": "638:836"},
    "美育": {"course": "0:272", "teacher": "724:932"},
    "大英和视听说": {"course": "0:374", "teacher": "824:1136"},
    "思政课": {"course": "0:220", "teacher": "270:432"},
    "外教": {"course": "0:134", "teacher": "134:404"},
    "MOOC": {"course": "0:134", "teacher": "134:184"},
    "体育课": {"course": "0:216", "teacher": "216:264"},
}


def build_group(sheet: str, source: dict, contexts: dict[tuple[str, int], dict]) -> dict:
    low, high = source["rows"]
    review_rows = {item["row"] for item in source["ocr_cells"]}
    evidence_rows = {
        row for (candidate_sheet, row), item in contexts.items()
        if candidate_sheet == sheet and (item.get("tokens") or item.get("text"))
    }
    gap_rows = {
        row for (candidate_sheet, row), item in contexts.items()
        if candidate_sheet == sheet and low <= row <= high and item.get("status") == "context_gap"
    }
    routed_rows = sorted(review_rows | evidence_rows | gap_rows)
    course, teachers = MAPPINGS[sheet]
    missing = [row for row in routed_rows if (sheet, row) not in contexts]
    if missing:
        raise ValueError(f"{sheet}: missing context crops for rows {missing}")
    pixels = FIELD_PIXELS[sheet]
    mapping = (
        f"course source column {course}, crop-relative x={pixels['course']}; "
        f"teacher source column(s) {','.join(teachers)}, crop-relative x={pixels['teacher']}; ignore all other pixels"
    )
    return {
        "worksheet": sheet,
        "rows": [low, high],
        "review_columns": [{"column": "CTX", "display_header": mapping}],
        "context_index": [
            {
                "row": row,
                "course": "[missing capture]" if row in gap_rows else "[pending]",
                "teacher": "[missing capture]" if row in gap_rows else "[pending]",
            }
            for row in range(low, high + 1)
        ],
        "ocr_cells": [
            {
                "row": row, "column": "CTX", "tokens": contexts[(sheet, row)].get("tokens", []),
                "text": contexts[(sheet, row)].get("text", ""), "confidence": contexts[(sheet, row)].get("confidence"),
                "crop": contexts[(sheet, row)]["crop"],
            }
            for row in routed_rows if row not in gap_rows
        ],
        "capture_gaps": [
            {
                "key": f"{sheet}|{row}|CTX", "row": row, "column": "CTX",
                "reason": contexts[(sheet, row)]["reason"],
                "recovery_condition": contexts[(sheet, row)]["recovery_condition"],
                "manifest_sha256": contexts[(sheet, row)]["manifest_sha256"],
            }
            for row in sorted(gap_rows)
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build isolated A/B row-context review groups")
    parser.add_argument("--context-queue", required=True)
    parser.add_argument("--cell-groups", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    contexts = {}
    for line in Path(args.context_queue).read_text(encoding="utf-8-sig").splitlines():
        item = json.loads(line)
        contexts[(item["worksheet"], item["row"])] = item
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    summary = {"worksheets": {}, "routed_rows": 0}
    for sheet in MAPPINGS:
        source = json.loads((Path(args.cell_groups) / f"{sheet}.json").read_text(encoding="utf-8-sig"))
        group = build_group(sheet, source, contexts)
        path = out / f"{sheet}.json"
        path.write_text(json.dumps(group, ensure_ascii=False, indent=2), encoding="utf-8")
        count = len(group["ocr_cells"])
        summary["worksheets"][sheet] = count
        summary["routed_rows"] += count
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
