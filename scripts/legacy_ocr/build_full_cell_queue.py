from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from build_cell_queue import edge_groups, token_center


SHEETS = {
    "主要课程": {"rows": (19, 480), "reviews": "F:M"},
    "数学课": {"rows": (8, 240), "reviews": "D:J"},
    "美育": {"rows": (8, 201), "reviews": "E:M"},
    "大英和视听说": {"rows": (8, 203), "reviews": "H:O"},
    "思政课": {"rows": (8, 205), "reviews": "G:N"},
    "外教": {"rows": (3, 199), "reviews": "G:N"},
    "MOOC": {"rows": (8, 199), "reviews": "G:N"},
    "体育课": {"rows": (6, 211), "reviews": "D:K"},
}

REVIEW_FILE = re.compile(r"_reviews-([A-Z])(?:-([A-Z]))?_anchor(\d+)\.png$")


def review_columns(spec: str) -> list[str]:
    first, last = (ord(value) for value in spec.split(":"))
    return [chr(value) for value in range(first, last + 1)]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def detect_selection(frame: np.ndarray) -> tuple[int, int, int, int]:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = ((hsv[:, :, 0] >= 90) & (hsv[:, :, 0] <= 130) & (hsv[:, :, 1] >= 120) & (hsv[:, :, 2] >= 90)).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    candidates = []
    for x, y, width, height, area in stats[1:count]:
        if y < 180 or width < 80 or height < 20 or height > frame.shape[0] * 0.1 or area < 100:
            continue
        fill = area / (width * height)
        if fill > 0.35:
            continue
        border_density = area / max(1, 2 * (width + height))
        if not 0.5 <= border_density <= 8:
            continue
        candidates.append((int(x), int(y), int(width), int(height), int(area)))
    if not candidates:
        raise ValueError("blue selection outline not found")
    grid_edges = vertical_grid_edges(frame)
    supported = [
        item for item in candidates
        if any(abs(edge - item[0]) <= 8 for edge in grid_edges)
        and any(abs(edge - (item[0] + item[2])) <= 8 for edge in grid_edges)
    ]
    if not supported:
        raise ValueError("blue selection outline is not supported by full-height grid edges")
    # Grid support excludes toolbar icons and large colored context decorations.
    x, y, width, height, _ = max(supported, key=lambda item: (item[4], item[1]))
    return x, y, width, height


def horizontal_intervals(frame: np.ndarray, selected: tuple[int, int, int, int]) -> list[tuple[int, int]]:
    _, y, _, height = selected
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    # Grid borders span the sheet viewport. Restricting the probe to the
    # selected review cell makes long text strokes look like row borders.
    inset = min(80, max(8, frame.shape[1] // 20))
    roi = gray[:, inset:max(inset + 1, frame.shape[1] - inset)]
    sobel = np.abs(cv2.Sobel(roi, cv2.CV_32F, 0, 1, ksize=3))
    scores = (sobel > 80).mean(axis=1)
    raw_positions = [position for position, _ in edge_groups(scores, 0.65) if position >= 180]
    positions: list[int] = []
    for position in raw_positions:
        if positions and position - positions[-1] <= 6:
            positions[-1] = round((positions[-1] + position) / 2)
        else:
            positions.append(position)

    def snap(value: int) -> int:
        nearby = [position for position in positions if abs(position - value) <= 8]
        return min(nearby, key=lambda item: abs(item - value)) if nearby else value

    positions.extend([snap(y), snap(y + height)])
    boundaries = sorted(set(positions))
    return [(left, right) for left, right in zip(boundaries, boundaries[1:]) if right - left >= 8]


def horizontal_positions(frame: np.ndarray, selected: tuple[int, int, int, int]) -> list[int]:
    intervals = horizontal_intervals(frame, selected)
    return sorted({value for interval in intervals for value in interval})


def consensus_row_numbers(
    position_sets: list[list[int]], selection_centers: list[float], anchor: int
) -> dict[int, tuple[int, int]]:
    if len(position_sets) < 2 or len(position_sets) != len(selection_centers):
        raise ValueError("row consensus requires matching column views")
    observations = sorted(
        (position, source_index)
        for source_index, positions in enumerate(position_sets)
        for position in positions
    )
    clusters: list[list[tuple[int, int]]] = []
    for position, source_index in observations:
        if clusters and position - clusters[-1][-1][0] <= 6:
            clusters[-1].append((position, source_index))
        else:
            clusters.append([(position, source_index)])
    required_support = math.ceil(len(position_sets) / 2)
    boundaries = [
        round(statistics.median(position for position, _ in cluster))
        for cluster in clusters
        if len({source_index for _, source_index in cluster}) >= required_support
    ]
    collapsed: list[int] = []
    for position in boundaries:
        if collapsed and position - collapsed[-1] < 25:
            collapsed[-1] = round((collapsed[-1] + position) / 2)
        else:
            collapsed.append(position)
    intervals = [(left, right) for left, right in zip(collapsed, collapsed[1:]) if right - left >= 30]
    center = statistics.median(selection_centers)
    matches = [index for index, (left, right) in enumerate(intervals) if left <= center <= right]
    if len(matches) != 1:
        raise ValueError("selection center does not match exactly one consensus row interval")
    selected_index = matches[0]
    return {anchor + index - selected_index: interval for index, interval in enumerate(intervals)}


def assign_row_numbers(
    intervals: list[tuple[int, int]], selected: tuple[int, int], anchor: int
) -> dict[int, tuple[int, int]]:
    matches = [
        index for index, interval in enumerate(intervals)
        if abs(interval[0] - selected[0]) <= 8 and abs(interval[1] - selected[1]) <= 8
    ]
    if len(matches) != 1:
        raise ValueError("selected row interval does not match exactly one grid interval")
    selected_index = matches[0]
    return {anchor + index - selected_index: interval for index, interval in enumerate(intervals)}


def vertical_grid_edges(frame: np.ndarray) -> list[int]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    roi = gray[min(266, frame.shape[0] - 1):]
    sobel = np.abs(cv2.Sobel(roi, cv2.CV_32F, 1, 0, ksize=3))
    scores = (sobel > 80).mean(axis=0)
    return [position for position, _ in edge_groups(scores, 0.25)]


def column_ranges_from_edges(
    selected: tuple[int, int, int, int], columns: list[str], edges: list[int]
) -> dict[str, tuple[int, int]]:
    x, y, width, height = selected
    if len(columns) == 1:
        return {columns[0]: (x, x + width)}
    if len(columns) != 2:
        raise ValueError(f"review image must declare one or two columns: {columns}")
    if not any(abs(edge - x) <= 8 for edge in edges) or not any(abs(edge - (x + width)) <= 8 for edge in edges):
        raise ValueError(f"selected review cell is not supported by full-height grid edges: {selected}")
    previous = [edge for edge in edges if edge < x - 3]
    if not previous:
        raise ValueError(f"left edge for selected review pair not found: {selected}")
    left = max(previous)
    first_width = x - left
    if not 80 <= first_width <= 1200:
        raise ValueError(f"first review column is clipped or implausibly wide: {columns[0]} width={first_width} selected={selected}")
    return {columns[0]: (left, x), columns[1]: (x, x + width)}


def x_ranges(frame: np.ndarray, selected: tuple[int, int, int, int], columns: list[str]) -> dict[str, tuple[int, int]]:
    return column_ranges_from_edges(selected, columns, vertical_grid_edges(frame))


def load_pages(path: Path) -> dict[str, dict[str, Any]]:
    pages: dict[str, dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line:
            continue
        item = json.loads(line)
        source_file = item["source_file"]
        if source_file in pages:
            raise ValueError(f"duplicate OCR page: {source_file}")
        pages[source_file] = item
    return pages


def validate_bbox(bbox: tuple[int, int, int, int], frame_size: tuple[int, int]) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = (int(value) for value in bbox)
    width, height = frame_size
    if x0 < 0 or y0 < 0 or x1 > width or y1 > height or x1 - x0 <= 4 or y1 - y0 <= 4:
        raise ValueError(f"bbox is outside the frame or too small: {(x0, y0, x1, y1)} in {frame_size}")
    return x0, y0, x1, y1


def has_unrecognized_ink(crop: np.ndarray, tokens: list[dict[str, Any]]) -> bool:
    if tokens:
        return False
    # A sub-glyph-height row is a structural spacer/collapsed row. Bright grid
    # antialiasing or sheet watermarks inside it must not become review text.
    if crop.shape[0] < 12:
        return False
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    background = float(np.median(gray))
    ink_pixels = int(np.count_nonzero(gray > 160)) if background < 80 else int(np.count_nonzero(gray < 140))
    return ink_pixels > max(25, round(crop.shape[0] * crop.shape[1] * 0.002))


def capture_gap_records(missing: list[str], manifest_sha256: str) -> list[dict[str, Any]]:
    records = []
    for key in missing:
        worksheet, row, column = key.split("|")
        records.append({
            "key": key,
            "worksheet": worksheet,
            "row": int(row),
            "column": column,
            "reason": "missing_review_capture",
            "recovery_condition": "capture the missing source row and review column in a new frozen manifest version",
            "manifest_sha256": manifest_sha256,
        })
    return records


def build(capture_root: Path, raw_tokens: Path, out: Path, allow_capture_gaps: bool = False) -> dict[str, Any]:
    capture_root = capture_root.resolve()
    manifest = json.loads((capture_root / "manifest.json").read_text(encoding="utf-8-sig"))
    pages = load_pages(raw_tokens)
    if not isinstance(manifest.get("files"), dict) or manifest.get("status") != "complete":
        raise ValueError("capture manifest must be complete and contain a files object")
    candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    geometry = []
    review_groups: dict[tuple[str, int], list[tuple[str, list[str]]]] = defaultdict(list)
    for relative in sorted(manifest["files"]):
        match = REVIEW_FILE.search(relative)
        if not match:
            continue
        sheet = relative.split("/", 1)[0]
        if sheet not in SHEETS:
            continue
        columns = [match.group(1)] + ([match.group(2)] if match.group(2) else [])
        anchor = int(match.group(3))
        review_groups[(sheet, anchor)].append((relative, columns))

    for (sheet, anchor), sources in sorted(review_groups.items()):
        loaded = []
        for relative, columns in sources:
            image_path = capture_root / relative
            actual_hash = sha256_file(image_path)
            if actual_hash != manifest["files"][relative]:
                raise ValueError(f"capture hash mismatch for {relative}")
            frame = cv2.imdecode(np.fromfile(image_path, dtype=np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                raise ValueError(f"cannot decode {relative}")
            selected = detect_selection(frame)
            intervals = horizontal_intervals(frame, selected)
            rows = assign_row_numbers(
                intervals,
                (selected[1], selected[1] + selected[3]),
                anchor,
            )
            loaded.append((relative, columns, frame, selected, rows))
        first_row, last_row = SHEETS[sheet]["rows"]
        for relative, columns, frame, selected, rows in loaded:
            columns_to_x = x_ranges(frame, selected, columns)
            geometry.append({"source_file": relative, "anchor": anchor, "selected": selected, "rows": rows, "columns": columns_to_x})
            for row, (y0, y1) in rows.items():
                if not first_row <= row <= last_row:
                    continue
                margin = min(y0 - 183, frame.shape[0] - y1)
                for column, (x0, x1) in columns_to_x.items():
                    bbox = validate_bbox((x0, y0, x1, y1), (frame.shape[1], frame.shape[0]))
                    key = f"{sheet}|{row}|{column}"
                    candidates[key].append({
                        "source_file": relative,
                        "bbox": list(bbox),
                        "score": margin - (10000 if row == anchor else 0),
                        "selected_anchor": row == anchor,
                    })

    chosen = {}
    for key, items in candidates.items():
        selected = max(items, key=lambda item: item["score"])
        chosen[key] = {**selected, "candidate_count": len(items)}
    expected_keys = [
        f"{sheet}|{row}|{column}"
        for sheet, config in SHEETS.items()
        for row in range(config["rows"][0], config["rows"][1] + 1)
        for column in review_columns(config["reviews"])
    ]
    missing = sorted(set(expected_keys) - set(chosen))
    if missing and not allow_capture_gaps:
        raise ValueError(f"full geometry is missing {len(missing)} cells; first: {missing[:10]}")
    capture_gaps = capture_gap_records(missing, sha256_file(capture_root / "manifest.json"))

    crops_root = out / "crops"
    source_groups: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for key in expected_keys:
        if key in chosen:
            source_groups[chosen[key]["source_file"]].append((key, chosen[key]))
    for source_file in source_groups:
        page = pages.get(source_file)
        if not page or page.get("status") != "completed":
            raise ValueError(f"completed OCR page missing for {source_file}")
        if page.get("input_sha256") != manifest["files"][source_file]:
            raise ValueError(f"OCR input hash mismatch for {source_file}")
        if not isinstance(page.get("tokens"), list):
            raise ValueError(f"OCR tokens are malformed for {source_file}")
    queue = []
    matrix = []
    records = []
    for source_file, items in source_groups.items():
        frame = cv2.imdecode(np.fromfile(capture_root / source_file, dtype=np.uint8), cv2.IMREAD_COLOR)
        page = pages.get(source_file)
        if frame is None or not page or page.get("status") != "completed":
            raise ValueError(f"completed OCR page missing for {source_file}")
        for key, candidate in items:
            sheet, row_text, column = key.split("|")
            row = int(row_text)
            x0, y0, x1, y1 = validate_bbox(tuple(candidate["bbox"]), (frame.shape[1], frame.shape[0]))
            crop = frame[y0 + 2:y1 - 2, x0 + 2:x1 - 2]
            crop_path = crops_root / sheet / f"{row:03d}-{column}.png"
            crop_path.parent.mkdir(parents=True, exist_ok=True)
            ok, encoded = cv2.imencode(".png", crop)
            if not ok:
                raise ValueError(f"cannot encode {key}")
            encoded.tofile(crop_path)
            tokens = [token for token in page["tokens"] if x0 <= token_center(token)[0] < x1 and y0 <= token_center(token)[1] < y1]
            tokens.sort(key=lambda item: (token_center(item)[1], token_center(item)[0]))
            text = " ".join(token["text"] for token in tokens).strip()
            confidence = round(statistics.mean(token["confidence"] for token in tokens), 5) if tokens else None
            suspected_miss = has_unrecognized_ink(crop, tokens)
            record = {
                "key": key, "worksheet": sheet, "row": row, "column": column,
                "source_file": source_file, "source_sha256": manifest["files"][source_file],
                "bbox": candidate["bbox"], "selected_anchor": candidate["selected_anchor"],
                "candidate_count": candidate["candidate_count"],
                "crop": str(crop_path.resolve()), "crop_sha256": sha256_file(crop_path),
                "tokens": tokens, "text": text, "confidence": confidence, "suspected_miss": suspected_miss,
            }
            records.append(record)
            status = "pending_review" if tokens or suspected_miss else "blank"
            matrix.append({"key": key, "status": status, "crop_sha256": record["crop_sha256"]})
            if status == "pending_review":
                queue.append(record)

    for gap in capture_gaps:
        matrix.append({
            "key": gap["key"],
            "status": "capture_gap",
            "crop_sha256": None,
            "reason": gap["reason"],
            "recovery_condition": gap["recovery_condition"],
            "manifest_sha256": gap["manifest_sha256"],
        })

    record_by_key = {item["key"]: item for item in records}
    key_order = {key: index for index, key in enumerate(expected_keys)}
    queue_keys = {item["key"] for item in queue}
    gaps_by_sheet: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for gap in capture_gaps:
        gaps_by_sheet[gap["worksheet"]].append(gap)
    matrix.sort(key=lambda item: key_order[item["key"]])
    queue.sort(key=lambda item: key_order[item["key"]])
    groups_root = out / "groups"
    groups_root.mkdir(parents=True, exist_ok=True)
    for sheet, config in SHEETS.items():
        first_row, last_row = config["rows"]
        columns = review_columns(config["reviews"])
        group = {
            "worksheet": sheet,
            "rows": [first_row, last_row],
            "review_columns": [{"column": column, "display_header": f"source column {column}"} for column in columns],
            "context_index": [{"row": row, "course": "[unclear]", "teacher": "[unclear]"} for row in range(first_row, last_row + 1)],
            "ocr_cells": [
                {name: record_by_key[f"{sheet}|{row}|{column}"][name] for name in ("row", "column", "tokens", "text", "confidence", "suspected_miss", "crop")}
                for row in range(first_row, last_row + 1)
                for column in columns
                if f"{sheet}|{row}|{column}" in queue_keys
            ],
            "capture_gaps": gaps_by_sheet[sheet],
        }
        (groups_root / f"{sheet}.json").write_text(json.dumps(group, ensure_ascii=False, indent=2), encoding="utf-8")

    out.mkdir(parents=True, exist_ok=True)
    (out / "geometry.json").write_text(json.dumps(geometry, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "matrix.json").write_text(json.dumps(matrix, ensure_ascii=False, indent=2), encoding="utf-8")
    with (out / "review-queue.jsonl").open("w", encoding="utf-8") as handle:
        for item in queue:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
    (out / "capture-gaps.json").write_text(json.dumps(capture_gaps, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "expected_cells": len(expected_keys), "actual_cells": len(matrix), "unique_keys": len({item["key"] for item in matrix}),
        "routed_cells": len(queue), "blank_cells": len(matrix) - len(queue) - len(capture_gaps),
        "capture_gap_cells": len(capture_gaps), "crop_count": len(matrix) - len(capture_gaps),
        "source_images_used": len(source_groups), "source_images_available": len(manifest["files"]),
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a traceable full-run cell matrix and review queue")
    parser.add_argument("--capture-root", required=True)
    parser.add_argument("--raw-tokens", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--allow-capture-gaps", action="store_true")
    args = parser.parse_args()
    print(json.dumps(build(Path(args.capture_root), Path(args.raw_tokens), Path(args.out), args.allow_capture_gaps), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
