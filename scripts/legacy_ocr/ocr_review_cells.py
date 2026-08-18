from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from ocr_manifest import cuda_provider_evidence, ocr_cuda
from pipeline import Token

CHROME_OCR_PATH = re.compile(r"(?:^|[\\/._-])(?:formula|window|chrome|conflict|titlebar|只能查看)(?:[\\/._-]|$)", re.I)
CELL_CROP_PATH = re.compile(r"(?:^|[\\/])[^\\/]*-cell\.(?:jpe?g|png|webp)$", re.I)


def is_cell_crop_image(path: str, kind: str | None = None) -> bool:
    if kind in {"conflict", "formula", "window", "chrome"}:
        return False
    normalized = path.replace("\\", "/")
    if CHROME_OCR_PATH.search(normalized) and not CELL_CROP_PATH.search(normalized):
        return False
    return bool(CELL_CROP_PATH.search(normalized))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def token_payload(token: Token) -> dict[str, Any]:
    return {"text": token.text, "confidence": token.confidence, "box": token.box}


def load_cells(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    cells = inventory.get("cells")
    if not isinstance(cells, list):
        raise ValueError("inventory must contain cells")
    return [cell for cell in cells if isinstance(cell, dict) and cell.get("routing") == "pending_review"]


def run_cell_ocr(inventory_path: Path, out_dir: Path) -> dict[str, Any]:
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    providers = cuda_provider_evidence()
    cache_dir = out_dir / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cells: dict[str, Any] = {}
    existing = out_dir / "cells.json"
    if existing.exists():
        previous = json.loads(existing.read_text(encoding="utf-8"))
        if isinstance(previous, dict):
            cells.update(previous)
    failed: list[str] = []
    for cell in load_cells(inventory):
        key = cell.get("key")
        image = cell.get("cell_image")
        kind = cell.get("cell_image_kind")
        if not isinstance(key, str) or not isinstance(image, str) or not image:
            failed.append(str(key))
            continue
        if not is_cell_crop_image(image, kind if isinstance(kind, str) else None):
            failed.append(key)
            continue
        if isinstance(cells.get(key), dict) and cells[key].get("image_sha256"):
            continue
        path = Path(image)
        if not path.is_file():
            failed.append(key)
            continue
        image_hash = sha256_file(path)
        cache_path = cache_dir / f"{image_hash}.json"
        if cache_path.exists():
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            cells[key] = cached
            continue
        tokens, model = ocr_cuda(path)
        record = {
            "text": "".join(token.text for token in tokens),
            "confidence": min((token.confidence for token in tokens), default=None),
            "tokens": [token_payload(token) for token in tokens],
            "suspected_miss": len(tokens) == 0,
            "image_sha256": image_hash,
            "ocr_model": model,
            "providers": providers,
        }
        cache_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        cells[key] = record
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "cells.json").write_text(json.dumps(cells, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {
        "status": "completed" if not failed else "completed_with_exceptions",
        "ocr_cells": len(cells),
        "failed_keys": failed,
        "provider_evidence": providers,
        "cells_path": str(out_dir / "cells.json"),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="CUDA RapidOCR for routed review-package origin cells")
    parser.add_argument("--inventory", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    summary = run_cell_ocr(Path(args.inventory), Path(args.out))
    return 0 if not summary["failed_keys"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
