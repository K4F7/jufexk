from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def split_rows(payload: dict, ranges: list[tuple[int, int]]) -> list[dict]:
    source_low, source_high = payload["rows"]
    covered = [row for low, high in ranges for row in range(low, high + 1)]
    if covered != list(range(source_low, source_high + 1)):
        raise ValueError("row ranges must exactly and contiguously cover the source group")
    parts = []
    for low, high in ranges:
        part = {
            **payload,
            "rows": [low, high],
            "context_index": [item for item in payload["context_index"] if low <= item["row"] <= high],
            "ocr_cells": [item for item in payload["ocr_cells"] if low <= item["row"] <= high],
            "capture_gaps": [item for item in payload.get("capture_gaps", []) if low <= item["row"] <= high],
        }
        parts.append(part)
    keys = [(item["row"], item["column"]) for part in parts for item in part["ocr_cells"]]
    source_keys = [(item["row"], item["column"]) for item in payload["ocr_cells"]]
    if sorted(keys) != sorted(source_keys) or len(keys) != len(set(keys)):
        raise ValueError("split changed OCR cell coverage")
    gap_keys = [item["key"] for part in parts for item in part.get("capture_gaps", [])]
    source_gap_keys = [item["key"] for item in payload.get("capture_gaps", [])]
    if sorted(gap_keys) != sorted(source_gap_keys) or len(gap_keys) != len(set(gap_keys)):
        raise ValueError("split changed capture gap coverage")
    return parts


def main() -> int:
    parser = argparse.ArgumentParser(description="Split one full review group into contiguous resumable row shards")
    parser.add_argument("--input", required=True)
    parser.add_argument("--ranges", required=True, help="comma-separated inclusive ranges, for example 19-126,127-232")
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()
    source = Path(args.input)
    payload = json.loads(source.read_text(encoding="utf-8-sig"))
    ranges = [tuple(map(int, item.split("-", 1))) for item in args.ranges.split(",")]
    parts = split_rows(payload, ranges)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    source_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest = {"source": str(source.resolve()), "source_sha256": source_sha256, "parts": []}
    for index, part in enumerate(parts, 1):
        path = out / f"part-{index:02d}.json"
        path.write_text(json.dumps(part, ensure_ascii=False, indent=2), encoding="utf-8")
        manifest["parts"].append({"path": path.name, "rows": part["rows"], "ocr_cells": len(part["ocr_cells"]), "capture_gaps": len(part.get("capture_gaps", [])), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
