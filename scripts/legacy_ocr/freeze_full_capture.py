from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np


FULL_SHEETS: dict[str, dict[str, Any]] = {
    "主要课程": {"last": 480, "header": 2, "context": "A:E", "reviews": "F:M", "views": ["context-A-E", "reviews-F-G", "reviews-H-I", "reviews-J-K", "reviews-L-M"], "supplemental_anchors": [182, 185]},
    "数学课": {"last": 240, "header": 3, "context": "A:C", "reviews": "D:J", "views": ["context-A-C", "reviews-D-E", "reviews-F-G", "reviews-H-I", "reviews-J"]},
    "美育": {"last": 201, "header": 2, "context": "A:D", "reviews": "E:M", "views": ["context-A-D", "reviews-E-F", "reviews-G-H", "reviews-I-J", "reviews-K-L", "reviews-M"]},
    "大英和视听说": {"last": 203, "header": 2, "context": "A:G", "reviews": "H:O", "views": ["context-A-G", "reviews-H-I", "reviews-J-K", "reviews-L-M", "reviews-N-O"]},
    "思政课": {"last": 205, "header": 2, "context": "A:F", "reviews": "G:N", "views": ["context-A-F", "reviews-G-H", "reviews-I-J", "reviews-K-L", "reviews-M-N"]},
    "外教": {"last": 199, "header": 2, "context": "A:F", "reviews": "G:N", "views": ["context-A-F", "reviews-G-H", "reviews-I-J", "reviews-K-L", "reviews-M-N"]},
    "MOOC": {"last": 199, "header": 2, "context": "A:F", "reviews": "G:N", "views": ["context-A-F", "reviews-G-H", "reviews-I-J", "reviews-K-L", "reviews-M-N"]},
    "体育课": {"last": 211, "header": 2, "context": "A:C", "reviews": "D:K", "views": ["context-A-C", "reviews-D-E", "reviews-F-G", "reviews-H-I", "reviews-J-K"]},
}


def anchors(config: dict[str, Any]) -> list[int]:
    values = [config["header"], *range(60, config["last"], 60)]
    if values[-1] != config["last"]:
        values.append(config["last"])
    return values


def sheet_paths(sheet: str, config: dict[str, Any]) -> list[str]:
    if sheet == "主要课程":
        plan = [("context-A-E", anchor) for anchor in [*anchors(config), 63, 127, 182, 185, 190, 302]]
        review_anchors = [19, *range(60, config["last"] + 1, 60), 185]
        plan.extend((view, anchor) for anchor in review_anchors for view in ["reviews-F-G", "reviews-H-I", "reviews-J-K", "reviews-L-M"])
        plan.extend((view, 183) for view in ["reviews-F", "reviews-G", "reviews-H-I", "reviews-J-K", "reviews-L-M"])
    else:
        plan = [
            (view, anchor)
            for view in config["views"]
            for anchor in [*anchors(config), *config.get("supplemental_anchors", [])]
        ]
    return [
        f"{sheet}/{sheet}_rows001-{config['last']:03d}_{view}_anchor{anchor:03d}.png"
        for view, anchor in plan
    ]


def expected_paths() -> list[str]:
    return [path for sheet, config in FULL_SHEETS.items() for path in sheet_paths(sheet, config)]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def freeze(root: Path) -> dict[str, Any]:
    root = root.resolve()
    files: dict[str, str] = {}
    dimensions: dict[str, list[int]] = {}
    hash_owners: dict[str, str] = {}
    errors = []
    for relative in expected_paths():
        path = (root / relative).resolve()
        if root not in path.parents or not path.is_file():
            errors.append(f"missing or escaping image: {relative}")
            continue
        frame = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            errors.append(f"cannot decode PNG: {relative}")
            continue
        height, width = frame.shape[:2]
        if (width, height) != (2560, 8000):
            errors.append(f"unexpected dimensions for {relative}: {width}x{height}")
        digest = sha256_file(path)
        if digest in hash_owners:
            errors.append(f"duplicate image hash: {relative} and {hash_owners[digest]}")
        hash_owners[digest] = relative
        files[relative] = digest
        dimensions[relative] = [width, height]
    extras = sorted(path.relative_to(root).as_posix() for path in root.rglob("*.png") if path.relative_to(root).as_posix() not in files)
    if extras:
        errors.append(f"unexpected PNG files: {len(extras)}")
    if errors:
        raise ValueError("; ".join(errors[:20]))

    groups = [
        {
            "sheet": sheet,
            "rows": [1, config["last"]],
            "context_columns": config["context"],
            "review_columns": config["reviews"],
            "anchors": anchors(config),
            "supplemental_anchors": config.get("supplemental_anchors", []),
            "views": config["views"],
            "image_count": len(sheet_paths(sheet, config)),
        }
        for sheet, config in FULL_SHEETS.items()
    ]
    source_layout_notes = [
        "思政课: source columns B:E are hidden; visible context endpoints A (course) and F (teacher) are captured",
        "体育课: source column B is hidden; visible context endpoints A (course) and C (teacher) are captured",
        "主要课程 anchor300: merged A299:A300 normalizes the active selection to A299; row 300 and teacher column E remain visible",
    ]
    qa = {
        "status": "accepted",
        "batch": root.name,
        "expected_files": len(expected_paths()),
        "actual_files": len(files),
        "decoded_pngs": len(dimensions),
        "unique_hashes": len(hash_owners),
        "dimensions": {"width": 2560, "height": 8000},
        "groups": [{"sheet": group["sheet"], "status": "accepted", "image_count": group["image_count"]} for group in groups],
        "visual_checks": [
            "主要课程/reviews-L-M/anchor480: L and M visible; row 480 visible",
            "数学课/context-A-C/anchor240: A through C visible; row 240 visible",
            "大英和视听说/reviews-N-O/anchor203: N and O visible; row 203 visible",
            "思政课/reviews-M-N/anchor205: M and N visible; row 205 visible",
            "主要课程/context-A-E/anchor182: context A:E and rows 182-183 visible",
            "主要课程/context supplements 063/127/190/302 close all independently measured row-coverage gaps",
            "主要课程/reviews/anchor183: F and G single-column supplements plus H:M pairs are visible",
            "主要课程/anchor185: review pairs F:M visible; rows 184-189 visible",
        ],
        "source_layout_notes": source_layout_notes,
        "rejected_predecessors": [
            "full-20260728-v1: first-column navigation did not guarantee right-hand coverage",
            "full-20260728-v2: anchors 180 and 240 left rows 182-189 uncovered after variable-height row geometry validation",
            "full-20260728-v3: context-A-E anchor185 did not show columns A through E",
            "full-20260728-v4: legacy context captures used inconsistent horizontal navigation",
            "full-20260728-v5: the first context capture after each worksheet switch retained the prior worksheet viewport",
            "full-20260728-v6: pair geometry used selected-row Sobel edges and silently expanded first-column crops across unrelated fields",
            "full-20260728-v7: source row 182 is a merged full-row selection and cannot anchor review-column geometry",
            "full-20260728-v8: reviews-F-G anchor183 exposed only 39 pixels of source column F",
            "full-20260728-v9: Capture QA rejected four images for inherited horizontal viewport, wrong active column, or clipped pair coverage",
            "full-20260728-v10: Capture QA rejected reviews-L-M anchor183 because M was absent and L remained active",
            "full-20260728-v11: independent context geometry exposed uncovered rows 63-75, 122-127, 187-191, and 302",
        ],
    }
    manifest = {
        "batch": root.name,
        "status": "complete",
        "contract_version": "ocr-first-full-capture-v5",
        "source_mode": "read_only",
        "source_layout_notes": source_layout_notes,
        "groups": groups,
        "files": files,
    }
    for path, value in ((root / "capture-qa.json", qa), (root / "manifest.json", manifest)):
        payload = stable_bytes(value)
        if path.exists() and path.read_bytes() != payload:
            raise ValueError(f"refusing to mutate frozen artifact: {path.name}")
        if not path.exists():
            path.write_bytes(payload)
    manifest_hash = sha256_file(root / "manifest.json")
    sidecar = root / "manifest.sha256"
    sidecar_payload = f"{manifest_hash}  manifest.json\n".encode("ascii")
    if sidecar.exists() and sidecar.read_bytes() != sidecar_payload:
        raise ValueError("refusing to mutate frozen manifest sidecar")
    if not sidecar.exists():
        sidecar.write_bytes(sidecar_payload)
    return {"status": "accepted", "files": len(files), "unique_hashes": len(hash_owners), "manifest_sha256": manifest_hash}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and freeze a full capture batch")
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    print(json.dumps(freeze(Path(args.root)), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
