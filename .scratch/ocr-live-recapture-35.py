from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(r"D:\19016\Documents\Workload\jufexk")
CAPTURES = ROOT / "scripts/legacy_evidence/output/human-queue-20260820-v3-live-recapture/captures.json"
OUT = ROOT / "scripts/legacy_evidence/output/human-queue-20260820-v3-live-recapture"
sys.path.insert(0, str(ROOT / "scripts/legacy_ocr"))
from ocr_manifest import cuda_provider_evidence, ocr_cuda  # noqa: E402


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
    min_area = max(800, int(width * height * 0.002))
    max_area = int(width * height * 0.25)
    candidates = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < min_area or area > max_area:
            continue
        if w < 40 or h < 18:
            continue
        if y < 80:
            continue
        if y + h > height - 24:
            continue
        if x < 30:
            continue
        aspect = w / h
        if aspect < 0.2 or aspect > 20:
            continue
        candidates.append((area, x, y, w, h))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    _area, x, y, w, h = candidates[0]
    inset = 3
    return (x + inset, y + inset, max(1, w - 2 * inset), max(1, h - 2 * inset))


def token_text(tokens) -> str:
    return "".join(token.text for token in tokens)


def main() -> None:
    captures = json.loads(CAPTURES.read_text(encoding="utf-8"))
    crops_dir = OUT / "crops"
    overlays_dir = OUT / "overlays"
    crops_dir.mkdir(exist_ok=True)
    overlays_dir.mkdir(exist_ok=True)
    providers = cuda_provider_evidence()
    results = []
    for index, item in enumerate(captures["items"], start=1):
        key = item["key"]
        image_path = Path(item["image"])
        formula = item.get("formula_bar_value") or ""
        bgr = cv2.imdecode(np.fromfile(str(image_path), dtype=np.uint8), cv2.IMREAD_COLOR)
        selection = find_selection_rect(bgr)
        overlay = bgr.copy()
        record = {
            "key": key,
            "formula_bar_value": formula,
            "source_image": str(image_path),
            "address_match": item.get("status") == "captured",
        }
        if selection:
            x, y, w, h = selection
            cv2.rectangle(overlay, (x, y), (x + w, y + h), (0, 0, 255), 2)
            crop = bgr[y:y + h, x:x + w]
            crop_path = crops_dir / f"{key.replace('|', '_')}.jpg"
            cv2.imencode(".jpg", crop)[1].tofile(str(crop_path))
            tokens, model = ocr_cuda(crop_path)
            ocr_text = token_text(tokens)
            record.update({
                "status": "cropped",
                "compare": compare_texts(ocr_text, formula),
                "ocr_text": ocr_text,
                "ocr_model": model,
                "selection": {"x": x, "y": y, "w": w, "h": h},
                "crop_path": str(crop_path),
            })
        else:
            record.update({
                "status": "selection_not_found",
                "compare": "no_crop",
                "ocr_text": "",
                "selection": None,
            })
        overlay_path = overlays_dir / f"{key.replace('|', '_')}.jpg"
        cv2.imencode(".jpg", overlay)[1].tofile(str(overlay_path))
        record["overlay_path"] = str(overlay_path)
        results.append(record)
        print(f"[{index}/{len(captures['items'])}] {key} {record['status']} {record['compare']}")

    counts = {}
    compares = {}
    for item in results:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
        compares[item["compare"]] = compares.get(item["compare"], 0) + 1
    summary = {
        "cells": len(results),
        "status_counts": counts,
        "compare_counts": compares,
        "provider_evidence": providers,
        "exact_or_prefix": [item["key"] for item in results if item["compare"] in ("exact", "prefix", "contains")],
        "mismatch": [item["key"] for item in results if item["compare"] == "mismatch"],
        "empty": [item["key"] for item in results if item["compare"] == "ocr_empty_formula_nonempty"],
        "no_crop": [item["key"] for item in results if item["compare"] == "no_crop"],
    }
    (OUT / "ocr-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "ocr-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
