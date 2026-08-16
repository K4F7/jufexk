from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
from collections import Counter
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from build_full_cell_queue import horizontal_intervals, load_pages, sha256_file, token_center, validate_bbox, vertical_grid_edges


def columns(spec: str) -> list[str]:
    first, last = (ord(value) for value in spec.split(":"))
    return [chr(value) for value in range(first, last + 1)]


def collapse_edges(values: list[int], tolerance: int = 6) -> list[int]:
    groups: list[list[int]] = []
    for value in sorted(values):
        if groups and value - groups[-1][-1] <= tolerance:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [round(statistics.median(group)) for group in groups]


def column_bounds(frame: np.ndarray, visible_spec: str) -> dict[str, tuple[int, int]]:
    visible = columns(visible_spec)
    edges = collapse_edges(vertical_grid_edges(frame))
    intervals = [(left, right) for left, right in zip(edges, edges[1:]) if right - left >= 80]
    if len(intervals) < len(visible):
        raise ValueError(f"only {len(intervals)} visible column intervals for {visible_spec}: {edges}")
    return {column: intervals[index] for index, column in enumerate(visible)}


def row_bounds(frame: np.ndarray, page: dict[str, Any], target_rows: set[int]) -> dict[int, tuple[int, int]]:
    intervals = [
        interval for interval in horizontal_intervals(frame, (0, 230, 1, 1))
        if interval[0] >= 225 and interval[1] <= frame.shape[0] - 30
    ]
    observations: list[tuple[int, int]] = []
    direct: dict[int, list[int]] = {}
    for token in page["tokens"]:
        text = token.get("text", "").strip()
        x, y = token_center(token)
        if x >= 110 or not re.fullmatch(r"\d{1,3}", text):
            continue
        row = int(text)
        if not 1 <= row <= 480:
            continue
        matches = [index for index, (top, bottom) in enumerate(intervals) if top <= y < bottom]
        if len(matches) != 1:
            continue
        index = matches[0]
        observations.append((row, index))
        if row in target_rows:
            direct.setdefault(row, []).append(index)
    if not observations:
        raise ValueError("no row-number OCR observations")
    offset, support = Counter(row - index for row, index in observations).most_common(1)[0]
    if support < 3:
        raise ValueError(f"row-number consensus is too weak: offset={offset} support={support}")
    result: dict[int, tuple[int, int]] = {}
    for row in sorted(target_rows):
        predicted = row - offset
        candidates = direct.get(row, [])
        index = min(candidates, key=lambda value: abs(value - predicted)) if candidates else predicted
        if not 0 <= index < len(intervals):
            raise ValueError(f"target row {row} is outside detected intervals; offset={offset}")
        result[row] = intervals[index]
    return result


def target_sets(manifest: dict[str, Any]) -> tuple[set[str], set[str]]:
    review = set(manifest["scope"]["content_unresolved"]["keys"])
    for item in manifest["scope"]["review_capture_gaps"]["keys"]:
        for row in range(item["rows"][0], item["rows"][1] + 1):
            for column in columns(item["columns"]):
                review.add(f"{item['sheet']}|{row}|{column}")
    context = set()
    for item in manifest["scope"]["context_capture_gaps"]["keys"]:
        for row in range(item["rows"][0], item["rows"][1] + 1):
            context.add(f"{item['sheet']}|{row}")
    return review, context


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def build(capture_root: Path, raw_tokens: Path, processing_map_path: Path, out: Path) -> dict[str, Any]:
    capture_root = capture_root.resolve()
    manifest_path = capture_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    processing_map = json.loads(processing_map_path.read_text(encoding="utf-8-sig"))
    manifest_sha256 = sha256_file(manifest_path)
    if processing_map.get("manifest_sha256") != manifest_sha256:
        raise ValueError("processing map is not linked to the targeted manifest")
    pages = load_pages(raw_tokens)
    review_targets, context_targets = target_sets(manifest)
    review_records: dict[str, dict[str, Any]] = {}
    context_records: dict[str, dict[str, Any]] = {}
    crops_root = out / "crops"

    for item in manifest["files"]:
        relative = item["path"]
        image_path = capture_root / relative
        if sha256_file(image_path) != item["sha256"]:
            raise ValueError(f"capture hash mismatch for {relative}")
        page = pages.get(relative)
        if not page or page.get("status") != "completed" or page.get("input_sha256") != item["sha256"]:
            raise ValueError(f"completed linked OCR page missing for {relative}")
        frame = cv2.imdecode(np.fromfile(image_path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError(f"cannot decode {relative}")
        mapping = processing_map["files"].get(relative)
        if not mapping:
            raise ValueError(f"processing map entry missing for {relative}")
        column_map = column_bounds(frame, mapping["visible_columns"])
        declared_rows = set(range(item["rows"][0], item["rows"][1] + 1))
        declared_columns = set(columns(item["columns"]))
        if item["type"] == "reviews":
            keys = {
                key for key in review_targets
                if key.split("|")[0] == item["sheet"]
                and int(key.split("|")[1]) in declared_rows
                and key.split("|")[2] in declared_columns
            }
            rows = {int(key.split("|")[1]) for key in keys}
        else:
            keys = {
                key for key in context_targets
                if key.split("|")[0] == item["sheet"] and int(key.split("|")[1]) in declared_rows
            }
            rows = {int(key.split("|")[1]) for key in keys}
        if not keys:
            continue
        row_map = row_bounds(frame, page, rows)

        for key in sorted(keys):
            parts = key.split("|")
            row = int(parts[1])
            y0, y1 = row_map[row]
            if item["type"] == "reviews":
                column = parts[2]
                if column not in column_map:
                    raise ValueError(f"target column {column} not visible in {relative}")
                x0, x1 = column_map[column]
                crop_path = crops_root / item["sheet"] / f"{row:03d}-{column}.png"
            else:
                target_columns = columns(item["columns"])
                x0 = column_map[target_columns[0]][0]
                x1 = column_map[target_columns[-1]][1]
                crop_path = crops_root / item["sheet"] / f"{row:03d}-context.png"
            x0, y0, x1, y1 = validate_bbox((x0, y0, x1, y1), (frame.shape[1], frame.shape[0]))
            crop = frame[y0 + 2:y1 - 2, x0 + 2:x1 - 2]
            crop_path.parent.mkdir(parents=True, exist_ok=True)
            ok, encoded = cv2.imencode(".png", crop)
            if not ok:
                raise ValueError(f"cannot encode {key}")
            encoded.tofile(crop_path)
            tokens = [token for token in page["tokens"] if x0 <= token_center(token)[0] < x1 and y0 <= token_center(token)[1] < y1]
            tokens.sort(key=lambda token: (token_center(token)[1], token_center(token)[0]))
            record = {
                "key": key, "worksheet": item["sheet"], "row": row,
                "source_file": relative, "source_sha256": item["sha256"],
                "capture_manifest_sha256": manifest_sha256, "bbox": [x0, y0, x1, y1],
                "crop": str(crop_path.resolve()), "crop_sha256": sha256_file(crop_path),
                "tokens": tokens, "text": " ".join(token["text"] for token in tokens).strip(),
                "confidence": round(statistics.mean(token["confidence"] for token in tokens), 5) if tokens else None,
            }
            if item["type"] == "reviews":
                record["column"] = parts[2]
                if key in review_records:
                    raise ValueError(f"duplicate review patch: {key}")
                review_records[key] = record
            else:
                if key in context_records:
                    raise ValueError(f"duplicate context patch: {key}")
                context_records[key] = record

    missing_review = sorted(review_targets - set(review_records))
    missing_context = sorted(context_targets - set(context_records))
    if missing_review or missing_context:
        raise ValueError(f"targeted patches incomplete: review={missing_review[:8]} context={missing_context[:8]}")
    reviews = [review_records[key] for key in sorted(review_records)]
    contexts = [context_records[key] for key in sorted(context_records)]
    write_jsonl(out / "review-patches.jsonl", reviews)
    write_jsonl(out / "context-patches.jsonl", contexts)
    summary = {
        "contract_version": "targeted-recapture-patches-v1",
        "manifest_sha256": manifest_sha256,
        "review_patch_count": len(reviews),
        "context_patch_count": len(contexts),
        "review_target_count": len(review_targets),
        "context_target_count": len(context_targets),
        "source_image_count": len(manifest["files"]),
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Build review/context patches from a targeted recapture manifest")
    parser.add_argument("--capture-root", required=True)
    parser.add_argument("--raw-tokens", required=True)
    parser.add_argument("--processing-map", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    print(json.dumps(build(Path(args.capture_root), Path(args.raw_tokens), Path(args.processing_map), Path(args.out)), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
