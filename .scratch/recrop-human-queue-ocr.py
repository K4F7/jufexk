from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(r"D:\19016\Documents\Workload\jufexk")
QUEUE = ROOT / "scripts/legacy_evidence/output/human-queue-20260820-v3/human-queue.json"
OUT = ROOT / "scripts/legacy_evidence/output/human-queue-20260820-v3-recrop-ocr"
LEGACY_OCR = ROOT / "scripts/legacy_ocr"

sys.path.insert(0, str(LEGACY_OCR))
from ocr_manifest import cuda_provider_evidence, ocr_cuda  # noqa: E402


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def compare_texts(ocr_text: str, formula: str) -> str:
    ocr = normalize_text(ocr_text)
    formula_n = normalize_text(formula)
    if not ocr and not formula_n:
        return "both_empty"
    if not ocr and formula_n:
        return "ocr_empty_formula_nonempty"
    if ocr and not formula_n:
        return "ocr_nonempty_formula_empty"
    if ocr == formula_n:
        return "exact"
    if formula_n.startswith(ocr) or ocr.startswith(formula_n):
        return "prefix"
    if ocr in formula_n or formula_n in ocr:
        return "contains"
    return "mismatch"


def find_selection_rect(bgr: np.ndarray) -> tuple[int, int, int, int] | None:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    bright = cv2.inRange(hsv, (90, 70, 130), (140, 255, 255))
    kernel = np.ones((5, 5), np.uint8)
    filled = cv2.erode(bright, kernel, iterations=2)
    border = cv2.subtract(bright, filled)
    border = cv2.dilate(border, np.ones((3, 3), np.uint8), iterations=2)
    contours, _ = cv2.findContours(border, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    height, width = bgr.shape[:2]
    min_area = max(800, int(width * height * 0.004))
    max_area = int(width * height * 0.45)
    candidates: list[tuple[int, int, int, int, int]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < min_area or area > max_area:
            continue
        if w < 40 or h < 24:
            continue
        if y < 8 or y + h > height - 28:
            continue
        if x < 40:
            continue
        aspect = w / h
        if aspect < 0.25 or aspect > 18:
            continue
        candidates.append((area, x, y, w, h))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    _area, x, y, w, h = candidates[0]
    inset = 3
    return (x + inset, y + inset, max(1, w - 2 * inset), max(1, h - 2 * inset))


def crop_left_gutter(bgr: np.ndarray) -> np.ndarray:
    height, width = bgr.shape[:2]
    return bgr[0:height - 36, 0:min(90, width)]


def visible_rows_from_ocr(text: str) -> list[int]:
    rows = sorted({int(match) for match in re.findall(r"\b(\d{1,3})\b", text) if 1 <= int(match) <= 500})
    return rows


def token_text(tokens) -> str:
    return "".join(token.text for token in tokens)


def main() -> None:
    queue = json.loads(QUEUE.read_text(encoding="utf-8"))
    items = queue["items"]
    OUT.mkdir(parents=True, exist_ok=True)
    crops_dir = OUT / "crops"
    overlays_dir = OUT / "overlays"
    crops_dir.mkdir(exist_ok=True)
    overlays_dir.mkdir(exist_ok=True)

    providers = cuda_provider_evidence()
    results = []
    for index, item in enumerate(items, start=1):
        key = item["key"]
        image_path = Path(item["cell_image"])
        formula = item.get("formula_bar_value") or ""
        row = int(item["row"])
        record = {
            "key": key,
            "worksheet": item["worksheet"],
            "row": row,
            "column": item["column"],
            "human_decision": item.get("decision"),
            "human_note": item.get("note"),
            "formula_bar_value": formula,
            "source_image": str(image_path),
            "source_sha256": sha256_file(image_path) if image_path.is_file() else None,
        }
        if not image_path.is_file():
            record.update({
                "status": "missing_image",
                "compare": "missing_image",
                "ocr_text": "",
                "visible_rows": [],
                "selection": None,
            })
            results.append(record)
            print(f"[{index}/{len(items)}] {key} missing_image")
            continue

        bgr = cv2.imdecode(np.fromfile(str(image_path), dtype=np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            record.update({
                "status": "unreadable_image",
                "compare": "unreadable_image",
                "ocr_text": "",
                "visible_rows": [],
                "selection": None,
            })
            results.append(record)
            print(f"[{index}/{len(items)}] {key} unreadable_image")
            continue

        gutter_path = OUT / "gutter" / f"{key.replace('|', '_')}.jpg"
        gutter_path.parent.mkdir(exist_ok=True)
        gutter = crop_left_gutter(bgr)
        cv2.imencode(".jpg", gutter)[1].tofile(str(gutter_path))
        gutter_tokens, _model = ocr_cuda(gutter_path)
        visible_rows = visible_rows_from_ocr(token_text(gutter_tokens))
        row_visible = row in visible_rows or (visible_rows and min(visible_rows) <= row <= max(visible_rows))

        selection = find_selection_rect(bgr)
        overlay = bgr.copy()
        if selection:
            x, y, w, h = selection
            cv2.rectangle(overlay, (x, y), (x + w, y + h), (0, 0, 255), 2)
            crop = bgr[y:y + h, x:x + w]
            crop_path = crops_dir / f"{key.replace('|', '_')}.jpg"
            cv2.imencode(".jpg", crop)[1].tofile(str(crop_path))
            tokens, model = ocr_cuda(crop_path)
            ocr_text = token_text(tokens)
            compare = compare_texts(ocr_text, formula)
            if not normalize_text(ocr_text) and formula.strip():
                status = "empty_selected_cell"
            else:
                status = "cropped"
            record.update({
                "status": status,
                "compare": compare,
                "ocr_text": ocr_text,
                "ocr_model": model,
                "ocr_token_count": len(tokens),
                "crop_path": str(crop_path),
                "crop_sha256": sha256_file(crop_path),
                "selection": {"x": x, "y": y, "w": w, "h": h},
                "visible_rows": visible_rows,
                "row_visible": bool(row_visible),
            })
        else:
            status = "recapture_required" if not row_visible else "selection_not_found"
            record.update({
                "status": status,
                "compare": "no_crop",
                "ocr_text": "",
                "visible_rows": visible_rows,
                "row_visible": bool(row_visible),
                "selection": None,
            })
        overlay_path = overlays_dir / f"{key.replace('|', '_')}.jpg"
        cv2.imencode(".jpg", overlay)[1].tofile(str(overlay_path))
        record["overlay_path"] = str(overlay_path)
        results.append(record)
        print(f"[{index}/{len(items)}] {key} {record['status']} {record['compare']} rows={visible_rows[:8]}")

    counts: dict[str, int] = {}
    compare_counts: dict[str, int] = {}
    for item in results:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
        compare_counts[item["compare"]] = compare_counts.get(item["compare"], 0) + 1

    summary = {
        "queue": str(QUEUE),
        "cells": len(results),
        "status_counts": counts,
        "compare_counts": compare_counts,
        "provider_evidence": providers,
        "recapture_required": [item["key"] for item in results if item["status"] == "recapture_required"],
        "empty_selected_cell": [item["key"] for item in results if item["status"] == "empty_selected_cell"],
        "mismatch": [item["key"] for item in results if item["compare"] == "mismatch"],
        "exact_or_prefix": [
            item["key"] for item in results if item["compare"] in ("exact", "prefix", "contains")
        ],
    }
    (OUT / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
