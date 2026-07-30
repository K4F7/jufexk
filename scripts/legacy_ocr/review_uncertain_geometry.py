from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np


CONTRACT_VERSION = "review-uncertain-geometry-v1"
CLIP_TERMS = {
    "left": ("左", "开头", "开端", "起始", "行首", "句首", "首行", "前导", "leading", "left-clipped", "left edge"),
    "right": ("右", "末尾", "结尾", "行尾", "截断", "后续", "ending", "right-clipped", "right edge"),
    "top": ("顶部", "上边", "top-clipped", "top edge"),
    "bottom": ("底部", "下边", "bottom-clipped", "bottom edge"),
}
CLIP_SIGNALS = ("裁", "截", "缺", "不可见", "超出", "clipp", "crop", "edge", "preceding", "continuation")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def marker_text(markers: list[Any]) -> str:
    return json.dumps(markers, ensure_ascii=False, sort_keys=True).lower()


def clipping_directions(markers: list[Any]) -> list[str]:
    text = marker_text(markers)
    if not any(signal in text for signal in CLIP_SIGNALS):
        return []
    return [direction for direction, terms in CLIP_TERMS.items() if any(term in text for term in terms)]


def resolve_manifest_path(lineage_path: Path, raw_path: str) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path
    candidates = [(lineage_path.parent / path).resolve()]
    normalized_parts = Path(raw_path.replace("\\", "/")).parts
    if "legacy_evidence" in normalized_parts:
        suffix = normalized_parts[normalized_parts.index("legacy_evidence") :]
        for parent in lineage_path.parents:
            candidates.append((parent / "scripts" / Path(*suffix)).resolve())
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"cannot resolve source manifest: {raw_path}")


def classify_geometry(
    bbox: list[int], image_size: tuple[int, int], directions: list[str], margin_x: int, margin_y: int,
) -> tuple[str, list[int], dict[str, int], str]:
    width, height = image_size
    x1, y1, x2, y2 = bbox
    available = {"left": x1, "right": width - x2, "top": y1, "bottom": height - y2}
    if not directions:
        return "already_complete", bbox[:], available, "uncertainty markers do not claim source-edge clipping"
    unavailable = [direction for direction in directions if available[direction] <= 0]
    if unavailable:
        return "source_clipped", bbox[:], available, f"no frozen-source pixels beyond: {','.join(unavailable)}"
    new_bbox = [
        max(0, x1 - (margin_x if "left" in directions else 0)),
        max(0, y1 - (margin_y if "top" in directions else min(8, margin_y))),
        min(width, x2 + (margin_x if "right" in directions else 0)),
        min(height, y2 + (margin_y if "bottom" in directions else min(8, margin_y))),
    ]
    return "expandable", new_bbox, available, "frozen-source pixels exist beyond every claimed clipped edge"


def source_manifest_index(lineage_path: Path) -> tuple[str, dict[tuple[str, str], dict[str, str]]]:
    lineage = read_json(lineage_path)
    index: dict[tuple[str, str], dict[str, str]] = {}
    for source in lineage["source_manifests"]:
        manifest_path = resolve_manifest_path(lineage_path, source["path"])
        actual_manifest_sha256 = sha256_file(manifest_path)
        if actual_manifest_sha256 != source["sha256"]:
            raise ValueError(f"source manifest hash mismatch: {manifest_path}")
        manifest = read_json(manifest_path)
        files = manifest["files"]
        entries = files.items() if isinstance(files, dict) else ((item["path"], item["sha256"]) for item in files)
        for relative, digest in entries:
            key = (relative.replace("\\", "/"), digest)
            value = {
                "role": source["role"],
                "manifest_path": str(manifest_path),
                "manifest_sha256": actual_manifest_sha256,
                "source_path": str((manifest_path.parent / relative).resolve()),
            }
            if key in index and index[key] != value:
                raise ValueError(f"ambiguous source manifest binding: {relative}")
            index[key] = value
    return sha256_file(lineage_path), index


def selected_analysis(cell: dict[str, Any]) -> dict[str, Any]:
    selected = cell.get("selected")
    analysis = cell.get(selected) if isinstance(selected, str) else None
    if not isinstance(analysis, dict):
        raise ValueError(f"selected analysis missing: {cell.get('key')}")
    return analysis


def load_targets(package_csv: Path, matrix_root: Path) -> list[dict[str, Any]]:
    matrices: dict[str, dict[str, Any]] = {}
    for path in matrix_root.glob("*/matrix.json"):
        for cell in read_json(path)["cells"]:
            matrices[cell["key"]] = cell
    with package_csv.open(encoding="utf-8-sig", newline="") as handle:
        rows = [
            row for row in csv.DictReader(handle)
            if row["comment"].strip() and "review_uncertain" in json.loads(row["manual_review_reasons_json"])
        ]
    result = []
    for row in rows:
        key = f"{row['worksheet']}|{row['source_row']}|{row['source_column']}"
        if key not in matrices:
            raise ValueError(f"target matrix cell missing: {key}")
        analysis = selected_analysis(matrices[key])
        result.append({
            "key": key,
            "evaluation_id": row["evaluation_id"],
            "worksheet": row["worksheet"],
            "row": int(row["source_row"]),
            "column": row["source_column"],
            "comment": row["comment"],
            "manual_review_reasons": json.loads(row["manual_review_reasons_json"]),
            "prior_conclusion": matrices[key].get("conclusion"),
            "prior_selected": matrices[key].get("selected"),
            "prior_raw_transcription": analysis["raw_transcription"],
            "prior_uncertainty_markers": analysis.get("uncertainty_markers", []),
        })
    return result


def build(
    package_csv: Path, queue_path: Path, matrix_root: Path, lineage_path: Path, out: Path,
    expected: int = 177, margin_x: int = 48, margin_y: int = 24,
) -> dict[str, Any]:
    paths = [package_csv, queue_path, lineage_path]
    if any(not path.exists() for path in paths):
        raise ValueError("required input is missing")
    targets = load_targets(package_csv, matrix_root)
    if len(targets) != expected or len({item["key"] for item in targets}) != expected:
        raise ValueError(f"target coverage mismatch: expected={expected} actual={len(targets)} unique={len({item['key'] for item in targets})}")
    queue = {item["key"]: item for item in read_jsonl(queue_path)}
    lineage_sha256, manifest_index = source_manifest_index(lineage_path)
    target_rows: list[dict[str, Any]] = []
    geometry_rows: list[dict[str, Any]] = []
    crops_root = out / "crops"

    for target in targets:
        key = target["key"]
        evidence = queue.get(key)
        if not evidence:
            raise ValueError(f"review queue entry missing: {key}")
        relative = evidence["source_file"].replace("\\", "/")
        binding = manifest_index.get((relative, evidence["source_sha256"]))
        if not binding:
            raise ValueError(f"source manifest binding missing: {key}")
        source_path = Path(binding["source_path"])
        if sha256_file(source_path) != evidence["source_sha256"]:
            raise ValueError(f"source image hash mismatch: {key}")
        old_crop_path = Path(evidence["crop"])
        if sha256_file(old_crop_path) != evidence["crop_sha256"]:
            raise ValueError(f"old crop hash mismatch: {key}")
        frame = cv2.imdecode(np.fromfile(source_path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError(f"cannot decode source image: {key}")
        bbox = [int(value) for value in evidence["bbox"]]
        x1, y1, x2, y2 = bbox
        if not (0 <= x1 < x2 <= frame.shape[1] and 0 <= y1 < y2 <= frame.shape[0]):
            raise ValueError(f"invalid old bbox: {key}")
        directions = clipping_directions(target["prior_uncertainty_markers"])
        classification, new_bbox, available, reason = classify_geometry(
            bbox, (frame.shape[1], frame.shape[0]), directions, margin_x, margin_y,
        )
        crop_path = None
        crop_sha256 = None
        if classification == "expandable":
            nx1, ny1, nx2, ny2 = new_bbox
            crop_path = crops_root / target["worksheet"] / f"{target['row']:03d}-{target['column']}.png"
            crop_path.parent.mkdir(parents=True, exist_ok=True)
            ok, encoded = cv2.imencode(".png", frame[ny1:ny2, nx1:nx2])
            if not ok:
                raise ValueError(f"cannot encode expanded crop: {key}")
            encoded.tofile(crop_path)
            crop_sha256 = sha256_file(crop_path)
        target_rows.append({
            **target,
            "input_sha256": hashlib.sha256(json.dumps({"target": target, "evidence": evidence}, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
            "source_file": relative,
            "source_sha256": evidence["source_sha256"],
            "source_manifest_role": binding["role"],
            "source_manifest_path": binding["manifest_path"],
            "source_manifest_sha256": binding["manifest_sha256"],
            "old_bbox": bbox,
            "old_crop": str(old_crop_path.resolve()),
            "old_crop_sha256": evidence["crop_sha256"],
            "ocr_tokens": evidence.get("tokens", []),
            "ocr_confidence": evidence.get("confidence"),
        })
        geometry_rows.append({
            "key": key,
            "classification": classification,
            "claimed_clipped_edges": directions,
            "reason": reason,
            "source_file": relative,
            "source_sha256": evidence["source_sha256"],
            "source_manifest_sha256": binding["manifest_sha256"],
            "source_dimensions": [frame.shape[1], frame.shape[0]],
            "old_bbox": bbox,
            "available_source_pixels": available,
            "new_bbox": new_bbox if classification == "expandable" else None,
            "new_crop": str(crop_path.resolve()) if crop_path else None,
            "new_crop_sha256": crop_sha256,
        })

    out.mkdir(parents=True, exist_ok=True)
    write_jsonl(out / "targets.jsonl", target_rows)
    write_jsonl(out / "geometry-classification.jsonl", geometry_rows)
    counts: dict[str, int] = {}
    for row in geometry_rows:
        counts[row["classification"]] = counts.get(row["classification"], 0) + 1
    summary = {
        "contract_version": CONTRACT_VERSION,
        "target_count": len(target_rows),
        "unique_key_count": len({row["key"] for row in target_rows}),
        "worksheet_row_count": len({(row["worksheet"], row["row"]) for row in target_rows}),
        "classification_counts": counts,
        "lineage_manifest_sha256": lineage_sha256,
        "inputs": {str(path.resolve()): sha256_file(path) for path in paths},
        "margin": {"x": margin_x, "y": margin_y},
    }
    (out / "geometry-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify and expand v15 nonblank review_uncertain crops")
    parser.add_argument("--package-csv", required=True)
    parser.add_argument("--review-queue", required=True)
    parser.add_argument("--matrix-root", required=True)
    parser.add_argument("--lineage-manifest", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--expected", type=int, default=177)
    parser.add_argument("--margin-x", type=int, default=48)
    parser.add_argument("--margin-y", type=int, default=24)
    args = parser.parse_args()
    summary = build(
        Path(args.package_csv), Path(args.review_queue), Path(args.matrix_root), Path(args.lineage_manifest), Path(args.out),
        args.expected, args.margin_x, args.margin_y,
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
