from __future__ import annotations

import argparse
import hashlib
import json
import statistics
from pathlib import Path
from typing import Any

import cv2
import numpy as np


SHEETS = {
    "主要课程": ((19, 26), "F:M"), "数学课": ((8, 14), "D:J"),
    "美育": ((8, 14), "E:M"), "大英和视听说": ((8, 14), "F:M"),
    "思政课": ((8, 14), "G:M"), "外教": ((3, 6), "G:M"),
    "MOOC": ((8, 14), "G:M"), "体育课": ((6, 14), "D:K"),
}

# Each rectangle is the blue selection outline in the raw body capture: x, y, width, height.
# The browser selected the first or second source column in that file as recorded by role.
LAYOUTS = {
    "MOOC": [
        ("reviews01-02", "MOOC_reviews01-02_body.png", (651, 1105, 302, 235), "first"),
        ("reviews03-04", "MOOC_reviews03-04_body.png", (1329, 1105, 388, 236), "first"),
        ("reviews05-06", "MOOC_reviews05-06_body.png", (2011, 1105, 302, 235), "first"),
        ("reviews07-08", "MOOC_reviews07-08_body.png", (2373, 1105, 139, 235), "single"),
    ],
    "主要课程": [
        ("reviews01-02", "主要课程_reviews01-02_body-precise.png", (1552, 2866, 658, 174), "second"),
        ("reviews03-04", "主要课程_reviews03-04_body-precise.png", (1950, 2865, 562, 175), "second"),
        ("reviews05-06", "主要课程_reviews05-06_body-precise.png", (2143, 2865, 369, 175), "second"),
        ("reviews07-08", "主要课程_reviews07-08_body-precise.png", (1843, 2865, 669, 175), "second"),
    ],
    "数学课": [
        ("reviews01-02", "数学课_reviews01-02_body.png", (933, 2147, 637, 173), "first"),
        ("reviews03-04", "数学课_reviews03-04_body-precise.png", (1371, 2147, 411, 173), "second"),
        ("reviews05-06", "数学课_reviews05-06_body-precise.png", (1796, 2148, 716, 172), "second"),
        ("reviews07", "数学课_reviews07_body.png", (2023, 2147, 489, 173), "single"),
    ],
    "美育": [
        # This legacy sheet stores its only populated free-form review in the
        # wide E column. F:M are retained as source-addressable blank cells.
        ("reviews01-02", "美育_reviews01-02_body.png", (100, 577, 825, 51), "single"),
        ("reviews01-02", "美育_reviews01-02_body.png", (925, 577, 205, 51), "first"),
        ("reviews03-04", "美育_reviews03-04_body.png", (1329, 577, 205, 52), "first"),
        ("reviews05-06", "美育_reviews05-06_body.png", (1733, 577, 205, 51), "first"),
        ("reviews07-08", "美育_reviews07-08_body.png", (2138, 578, 204, 51), "first"),
    ],
    "大英和视听说": [
        ("reviews01-02", "大英和视听说_reviews01-02_body.png", (449, 1963, 305, 77), "first"),
        ("reviews03-04", "大英和视听说_reviews03-04_body.png", (1051, 1963, 605, 77), "first"),
        ("reviews05-06", "大英和视听说_reviews05-06-edge_body-precise.png", (2049, 1963, 463, 78), "second"),
        ("reviews07-08", "大英和视听说_reviews07-08-edge_body-precise.png", (2171, 1963, 341, 77), "second"),
    ],
    "思政课": [
        ("reviews01-02", "思政课_reviews01-02_body.png", (540, 1391, 827, 180), "first"),
        ("reviews03-04", "思政课_reviews03-04_body.png", (1844, 1390, 451, 182), "first"),
        ("reviews05-06", "思政课_reviews05-06-edge_body-precise.png", (2231, 1485, 281, 141), "second"),
        ("reviews07-08", "思政课_reviews07-08_body.png", (2197, 348, 315, 186), "single"),
    ],
    "外教": [
        ("reviews01-02", "外教_reviews01-02_body.png", (532, 429, 417, 637), "first"),
        ("reviews03-04", "外教_reviews03-04_body.png", (1081, 429, 320, 636), "first"),
        ("reviews05-06", "外教_reviews05-06_body.png", (1653, 429, 264, 635), "first"),
        ("reviews07-08", "外教_reviews07-08_body.png", (2199, 429, 313, 635), "single"),
    ],
    "体育课": [
        ("reviews01-02", "体育课_reviews01-02_body.png", (690, 1516, 606, 244), "first"),
        ("reviews03-04", "体育课_reviews03-04_body.png", (1918, 1516, 594, 244), "first"),
        ("reviews05-06", "体育课_reviews05-06_body.png", (2140, 1516, 372, 244), "first"),
        ("reviews07-08", "体育课_reviews07-08-edge_body-precise.png", (2152, 1516, 360, 244), "second"),
    ],
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def column_letters(spec: str) -> list[str]:
    first, last = (ord(value) for value in spec.split(":"))
    return [chr(value) for value in range(first, last + 1)]


def adjacent_ranges(selected: tuple[int, int], role: str, edges: list[int]) -> list[tuple[int, int]]:
    left, right = selected
    if role == "single":
        return [(left, right)]
    if role == "first":
        candidates = [edge for edge in edges if edge > right + 3]
        if not candidates:
            raise ValueError("missing right-hand column edge")
        return [(left, right), (right, min(candidates))]
    if role == "second":
        candidates = [edge for edge in edges if edge < left - 3]
        if not candidates:
            raise ValueError("missing left-hand column edge")
        return [(max(candidates), left), (left, right)]
    raise ValueError(f"unknown selection role: {role}")


def edge_groups(scores: np.ndarray, threshold: float) -> list[tuple[int, float]]:
    indexes = np.where(scores >= threshold)[0]
    groups: list[list[int]] = []
    for value in indexes:
        if not groups or value > groups[-1][-1] + 1:
            groups.append([int(value)])
        else:
            groups[-1].append(int(value))
    return [(round(statistics.mean(group)), float(max(scores[group]))) for group in groups]


def vertical_edges(frame: np.ndarray, y0: int, y1: int) -> list[int]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    roi = gray[max(0, y0 + 5):max(y0 + 6, y1 - 5)]
    scores = np.abs(cv2.Sobel(roi, cv2.CV_32F, 1, 0, ksize=3)).mean(axis=0)
    groups = edge_groups(scores, max(18.0, float(scores.max()) * 0.45))
    return sorted(set([0, frame.shape[1], *[position for position, _ in groups]]))


def row_ranges(frame: np.ndarray, selected: tuple[int, int, int, int], count: int) -> list[tuple[int, int]]:
    x, y, width, height = selected
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    roi = gray[:, max(0, x + 8):min(frame.shape[1], x + width - 8)]
    sobel = np.abs(cv2.Sobel(roi, cv2.CV_32F, 0, 1, ksize=3))
    # True grid borders cross nearly the full selected cell width. Text and
    # watermarks may have stronger local edges, but low horizontal coverage.
    scores = (sobel > 80).mean(axis=1)
    groups = edge_groups(scores, 0.7)
    positions = [position for position, _ in groups]

    def snap(value: int) -> int:
        nearby = [position for position in positions if abs(position - value) <= 6]
        return min(nearby, key=lambda item: abs(item - value)) if nearby else value

    boundaries = [snap(y), snap(y + height)]
    for position in positions:
        if position > boundaries[-1] + 5:
            boundaries.append(position)
            if len(boundaries) == count + 1:
                break
    if len(boundaries) != count + 1:
        raise ValueError(f"only found {len(boundaries) - 1}/{count} row ranges from {selected}")
    return list(zip(boundaries, boundaries[1:]))


def load_pages(path: Path) -> dict[str, dict[str, Any]]:
    pages = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        item = json.loads(line)
        pages[item["source_file"]] = item
    return pages


def token_center(token: dict[str, Any]) -> tuple[float, float]:
    return (
        statistics.mean(point[0] for point in token["box"]),
        statistics.mean(point[1] for point in token["box"]),
    )


def build_queue(capture_root: Path, raw_tokens: Path, out: Path) -> dict[str, Any]:
    manifest = json.loads((capture_root / "manifest.json").read_text(encoding="utf-8-sig"))
    pages = load_pages(raw_tokens)
    parts = capture_root / ".parts"
    crops_root = out / "crops"
    groups_root = out / "groups"
    queue: list[dict[str, Any]] = []
    matrix: list[dict[str, Any]] = []
    geometry: dict[str, Any] = {}

    for sheet, (rows, review_spec) in SHEETS.items():
        row_count = rows[1] - rows[0] + 1
        letters = column_letters(review_spec)
        group_cells: list[dict[str, Any]] = []
        layout_columns = iter(letters)
        group_geometry = []
        for label, raw_name, selected, role in LAYOUTS[sheet]:
            raw_path = parts / raw_name
            frame = cv2.imdecode(np.fromfile(raw_path, dtype=np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                raise ValueError(f"cannot decode {raw_path}")
            y_ranges = row_ranges(frame, selected, row_count)
            x_ranges = adjacent_ranges((selected[0], selected[0] + selected[2]), role, vertical_edges(frame, selected[1], selected[1] + selected[3]))
            assigned = [next(layout_columns) for _ in x_ranges]
            final_name = next(name for name in manifest["files"] if name.startswith(f"{sheet}/") and label in name)
            page = pages.get(final_name)
            if not page or page.get("status") != "completed":
                raise ValueError(f"OCR page missing for {final_name}")
            group_geometry.append({"source_file": final_name, "raw_body": raw_name, "selected": selected, "role": role, "columns": dict(zip(assigned, x_ranges)), "rows": dict(zip(range(rows[0], rows[1] + 1), y_ranges))})
            for column, (x0, x1) in zip(assigned, x_ranges):
                for row, (y0, y1) in zip(range(rows[0], rows[1] + 1), y_ranges):
                    crop = frame[max(0, y0 + 2):min(frame.shape[0], y1 - 2), max(0, x0 + 2):min(frame.shape[1], x1 - 2)]
                    crop_path = crops_root / sheet / f"{row:03d}-{column}.png"
                    crop_path.parent.mkdir(parents=True, exist_ok=True)
                    if not cv2.imencode(".png", crop)[0]:
                        raise ValueError(f"cannot encode crop {crop_path}")
                    cv2.imencode(".png", crop)[1].tofile(crop_path)
                    tokens = []
                    for token in page["tokens"]:
                        cx, cy = token_center(token)
                        if x0 <= cx < x1 and y0 + 1000 <= cy < y1 + 1000:
                            tokens.append(token)
                    text = " ".join(token["text"] for token in sorted(tokens, key=lambda item: (token_center(item)[1], token_center(item)[0]))).strip()
                    confidence = round(statistics.mean(token["confidence"] for token in tokens), 5) if tokens else None
                    bright = int(np.count_nonzero(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) > 160))
                    suspected_miss = not tokens and bright > max(25, round(crop.shape[0] * crop.shape[1] * 0.002))
                    key = f"{sheet}|{row}|{column}"
                    item = {
                        "key": key, "worksheet": sheet, "row": row, "column": column,
                        "source_file": final_name, "source_sha256": manifest["files"][final_name],
                        "raw_body": raw_name, "bbox": [x0, y0, x1, y1],
                        "crop": str(crop_path.resolve()), "crop_sha256": sha256_file(crop_path),
                        "tokens": tokens, "text": text, "confidence": confidence,
                        "suspected_miss": suspected_miss,
                    }
                    group_cells.append(item)
                    matrix.append({"key": key, "status": "pending_review" if tokens or suspected_miss else "blank", "crop_sha256": item["crop_sha256"]})
                    if tokens or suspected_miss:
                        queue.append(item)
        if len(group_cells) != row_count * len(letters):
            raise ValueError(f"incomplete matrix for {sheet}: {len(group_cells)}")
        geometry[sheet] = group_geometry
        context_index = [{"row": row, "course": "[unclear]", "teacher": "[unclear]"} for row in range(rows[0], rows[1] + 1)]
        group_input = {
            "worksheet": sheet, "rows": list(rows),
            "review_columns": [{"column": letter, "display_header": f"source column {letter}"} for letter in letters],
            "context_index": context_index,
            "ocr_cells": [{key: cell[key] for key in ("row", "column", "tokens", "text", "confidence", "suspected_miss", "crop")} for cell in group_cells if cell["tokens"] or cell["suspected_miss"]],
        }
        groups_root.mkdir(parents=True, exist_ok=True)
        (groups_root / f"{sheet}.json").write_text(json.dumps(group_input, ensure_ascii=False, indent=2), encoding="utf-8")

    expected = sum((end - start + 1) * len(column_letters(spec)) for (start, end), spec in SHEETS.values())
    if len(matrix) != expected or len({item["key"] for item in matrix}) != expected:
        raise ValueError("matrix key coverage is not complete and unique")
    out.mkdir(parents=True, exist_ok=True)
    (out / "geometry.json").write_text(json.dumps(geometry, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "matrix.json").write_text(json.dumps(matrix, ensure_ascii=False, indent=2), encoding="utf-8")
    with (out / "review-queue.jsonl").open("w", encoding="utf-8") as handle:
        for item in queue:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
    summary = {"expected_cells": expected, "actual_cells": len(matrix), "unique_keys": len({item["key"] for item in matrix}), "routed_cells": len(queue), "blank_cells": len(matrix) - len(queue), "crop_count": len(matrix)}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Build traceable cell crops and OCR review queue")
    parser.add_argument("--capture-root", required=True)
    parser.add_argument("--raw-tokens", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    print(json.dumps(build_queue(Path(args.capture_root), Path(args.raw_tokens), Path(args.out)), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
