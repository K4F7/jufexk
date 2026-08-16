from __future__ import annotations

import argparse
import json
import re
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from build_cell_queue import token_center
from build_full_cell_queue import (
    REVIEW_FILE,
    SHEETS,
    assign_row_numbers,
    consensus_row_numbers,
    detect_selection,
    horizontal_intervals,
    horizontal_positions,
    load_pages,
    sha256_file,
    validate_bbox,
)


CONTEXT_FILE = re.compile(r"_context-([A-Z])-([A-Z])_anchor(\d+)\.png$")


def expected_context_keys() -> list[str]:
    return [
        f"{sheet}|{row}"
        for sheet, config in SHEETS.items()
        for row in range(config["rows"][0], config["rows"][1] + 1)
    ]


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def detect_context_selection(frame: np.ndarray) -> tuple[int, int, int, int]:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = ((hsv[:, :, 0] >= 90) & (hsv[:, :, 0] <= 130) & (hsv[:, :, 1] >= 120) & (hsv[:, :, 2] >= 90)).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    candidates = []
    for x, y, width, height, area in stats[1:count]:
        if y < 180 or width < 80 or height < 20 or area < 100:
            continue
        fill = area / (width * height)
        border_density = area / max(1, 2 * (width + height))
        if fill <= 0.35 and 0.5 <= border_density <= 8:
            candidates.append((int(x), int(y), int(width), int(height), int(area)))
    if not candidates:
        raise ValueError("context blue selection outline not found")
    x, y, width, height, _ = max(candidates, key=lambda item: (item[4], item[1]))
    return x, y, width, height


def consensus_context_right(anchor_rights: list[tuple[int, int]]) -> int:
    ordinary = [right for anchor, right in anchor_rights if anchor > 3]
    if len(ordinary) < 2:
        raise ValueError("at least two non-header context selections are required")
    median = int(statistics.median(ordinary))
    if sum(abs(right - median) <= 12 for right in ordinary) < 2:
        raise ValueError("context endpoint selections do not have a stable consensus")
    return median


def context_x_bounds(right: int, frame_width: int) -> tuple[int, int]:
    left = 100
    if not left + 80 <= right <= frame_width - 10:
        raise ValueError(f"invalid context horizontal bounds: {left}..{right} of {frame_width}")
    return left, right


def context_gap_records(missing: list[str], manifest_sha256: str) -> list[dict[str, Any]]:
    records = []
    for key in missing:
        worksheet, row = key.split("|")
        records.append({
            "key": key,
            "worksheet": worksheet,
            "row": int(row),
            "status": "context_gap",
            "reason": "missing_context_capture",
            "recovery_condition": "capture the missing source row context in a new frozen manifest version",
            "manifest_sha256": manifest_sha256,
        })
    return records


def build(capture_root: Path, raw_tokens: Path, out: Path, allow_context_gaps: bool = False) -> dict[str, Any]:
    capture_root = capture_root.resolve()
    manifest = json.loads((capture_root / "manifest.json").read_text(encoding="utf-8-sig"))
    if manifest.get("status") != "complete" or not isinstance(manifest.get("files"), dict):
        raise ValueError("capture manifest must be complete and contain a files object")
    pages = load_pages(raw_tokens)
    review_groups: dict[tuple[str, int], list[str]] = defaultdict(list)
    context_sources: dict[tuple[str, int], str] = {}
    for relative in sorted(manifest["files"]):
        sheet = relative.split("/", 1)[0]
        review_match = REVIEW_FILE.search(relative)
        context_match = CONTEXT_FILE.search(relative)
        if sheet not in SHEETS:
            continue
        if review_match:
            review_groups[(sheet, int(review_match.group(3)))].append(relative)
        elif context_match:
            key = (sheet, int(context_match.group(3)))
            if key in context_sources:
                raise ValueError(f"duplicate context source for {key}")
            context_sources[key] = relative

    review_rows: dict[tuple[str, int], dict[int, tuple[int, int]]] = {}
    for key, review_sources in sorted(review_groups.items()):
        position_sets = []
        selection_centers = []
        for relative in review_sources:
            path = capture_root / relative
            if sha256_file(path) != manifest["files"][relative]:
                raise ValueError(f"capture hash mismatch for {relative}")
            frame = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                raise ValueError(f"cannot decode {relative}")
            selected = detect_selection(frame)
            position_sets.append(horizontal_positions(frame, selected))
            selection_centers.append(selected[1] + selected[3] / 2)
        review_rows[key] = consensus_row_numbers(position_sets, selection_centers, key[1])

    right_candidates: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for (sheet, anchor), context_source in sorted(context_sources.items()):
        path = capture_root / context_source
        frame = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError(f"cannot decode {context_source}")
        selected = detect_context_selection(frame)
        right_candidates[sheet].append((anchor, selected[0] + selected[2]))
    context_rights = {sheet: consensus_context_right(values) for sheet, values in right_candidates.items()}

    candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    geometry = []
    for (sheet, anchor), context_source in sorted(context_sources.items()):
        context_path = capture_root / context_source
        if sha256_file(context_path) != manifest["files"][context_source]:
            raise ValueError(f"capture hash mismatch for {context_source}")
        frame = cv2.imdecode(np.fromfile(context_path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError(f"cannot decode {context_source}")
        selected = detect_context_selection(frame)
        x0, x1 = context_x_bounds(context_rights[sheet], frame.shape[1])
        try:
            rows = assign_row_numbers(horizontal_intervals(frame, selected), (selected[1], selected[1] + selected[3]), anchor)
            mapping_method = "context_selection"
        except ValueError as error:
            rows = review_rows.get((sheet, anchor))
            if not rows:
                raise ValueError(f"context row mapping failed for {sheet} anchor {anchor}: {error}") from error
            mapping_method = "same_anchor_review_consensus_fallback"
        first_row, last_row = SHEETS[sheet]["rows"]
        for row, (y0, y1) in rows.items():
            if not first_row <= row <= last_row:
                continue
            bbox = validate_bbox((x0, y0, x1, y1), (frame.shape[1], frame.shape[0]))
            candidates[f"{sheet}|{row}"].append(
                {
                    "source_file": context_source,
                    "bbox": list(bbox),
                    "score": min(y0 - 183, frame.shape[0] - y1) - (10000 if row == anchor else 0),
                    "selected_anchor": row == anchor,
                }
            )
        geometry.append({"worksheet": sheet, "anchor": anchor, "source_file": context_source, "mapping_method": mapping_method, "context_right": x1, "rows": rows})

    expected_keys = expected_context_keys()
    missing = sorted(set(expected_keys) - set(candidates))
    if missing and not allow_context_gaps:
        raise ValueError(f"full context geometry is missing {len(missing)} rows; first: {missing[:10]}")
    context_gaps = context_gap_records(missing, sha256_file(capture_root / "manifest.json"))
    chosen = {}
    for key, items in candidates.items():
        selected = max(items, key=lambda item: item["score"])
        chosen[key] = {**selected, "candidate_count": len(items)}

    used_sources = {item["source_file"] for item in chosen.values()}
    for source_file in used_sources:
        page = pages.get(source_file)
        if not page or page.get("status") != "completed":
            raise ValueError(f"completed OCR page missing for {source_file}")
        if page.get("input_sha256") != manifest["files"][source_file]:
            raise ValueError(f"OCR input hash mismatch for {source_file}")
        if not isinstance(page.get("tokens"), list):
            raise ValueError(f"OCR tokens are malformed for {source_file}")

    crops_root = out / "crops"
    records = []
    frames: dict[str, np.ndarray] = {}
    for key in expected_keys:
        if key not in chosen:
            continue
        sheet, row_text = key.split("|")
        row = int(row_text)
        candidate = chosen[key]
        source_file = candidate["source_file"]
        frame = frames.get(source_file)
        if frame is None:
            frame = cv2.imdecode(np.fromfile(capture_root / source_file, dtype=np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                raise ValueError(f"cannot decode {source_file}")
            frames[source_file] = frame
        x0, y0, x1, y1 = validate_bbox(tuple(candidate["bbox"]), (frame.shape[1], frame.shape[0]))
        crop = frame[y0 + 2:y1 - 2, x0 + 2:x1 - 2]
        crop_path = crops_root / sheet / f"{row:03d}.png"
        crop_path.parent.mkdir(parents=True, exist_ok=True)
        ok, encoded = cv2.imencode(".png", crop)
        if not ok:
            raise ValueError(f"cannot encode {key}")
        encoded.tofile(crop_path)
        page = pages[source_file]
        tokens = [
            token for token in page["tokens"]
            if x0 <= token_center(token)[0] < x1 and y0 <= token_center(token)[1] < y1
        ]
        tokens.sort(key=lambda item: (token_center(item)[1], token_center(item)[0]))
        text = " ".join(token["text"] for token in tokens).strip()
        records.append(
            {
                "key": key,
                "worksheet": sheet,
                "row": row,
                "source_file": source_file,
                "source_sha256": manifest["files"][source_file],
                "bbox": candidate["bbox"],
                "candidate_count": candidate["candidate_count"],
                "crop": str(crop_path.resolve()),
                "crop_sha256": sha256_file(crop_path),
                "tokens": tokens,
                "text": text,
                "confidence": round(statistics.mean(token["confidence"] for token in tokens), 5) if tokens else None,
            }
        )
    records.extend(context_gaps)
    key_order = {key: index for index, key in enumerate(expected_keys)}
    records.sort(key=lambda item: key_order[item["key"]])
    out.mkdir(parents=True, exist_ok=True)
    with (out / "context-queue.jsonl").open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    write_json(out / "geometry.json", geometry)
    write_json(out / "context-gaps.json", context_gaps)
    summary = {
        "expected_rows": len(expected_keys),
        "actual_rows": len(records),
        "unique_keys": len({record["key"] for record in records}),
        "rows_with_tokens": sum(bool(record.get("tokens")) for record in records),
        "context_gap_rows": len(context_gaps),
        "source_images_used": len(used_sources),
        "crop_count": len(records) - len(context_gaps),
    }
    write_json(out / "summary.json", summary)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Build traceable full-run context row crops")
    parser.add_argument("--capture-root", required=True)
    parser.add_argument("--raw-tokens", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--allow-context-gaps", action="store_true")
    args = parser.parse_args()
    print(json.dumps(build(Path(args.capture_root), Path(args.raw_tokens), Path(args.out), args.allow_context_gaps), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
