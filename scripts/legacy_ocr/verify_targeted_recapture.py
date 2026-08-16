from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

from build_targeted_overlay import CONTENT_KEYS, CONTEXT_KEYS, REVIEW_GAP_KEYS, SHEETS, read_json


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def selected_raw(cell: dict) -> tuple[str, list[str]]:
    selected = cell.get("selected")
    analysis = cell.get(selected) or {} if selected else {}
    return analysis.get("raw_transcription", ""), analysis.get("uncertainty_markers", [])


def matrix_index(root: Path) -> dict[str, dict]:
    result = {}
    for sheet in SHEETS:
        for cell in read_json(root / sheet / "matrix.json")["cells"]:
            if cell["key"] in result:
                raise ValueError(f"duplicate matrix key: {cell['key']}")
            result[cell["key"]] = cell
    return result


def csv_reason_counts(path: Path) -> tuple[int, Counter]:
    counts = Counter()
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        counts.update(json.loads(row["manual_review_reasons_json"]))
    return len(rows), counts


def verify_manifest(capture_root: Path, manifest_path: Path) -> list[dict]:
    manifest = read_json(manifest_path)
    result = []
    for item in manifest["files"]:
        path = capture_root / item["path"]
        actual = sha256(path) if path.exists() else None
        result.append({"path": item["path"], "exists": path.exists(), "expected_sha256": item["sha256"], "actual_sha256": actual, "valid": actual == item["sha256"]})
    return result


def verify_package(package_root: Path) -> list[dict]:
    manifest = read_json(package_root / "package-manifest.json")
    result = []
    for name, metadata in manifest["files"].items():
        path = package_root / name
        actual_hash = sha256(path) if path.exists() else None
        if name.endswith(".jsonl"):
            actual_rows = sum(bool(line.strip()) for line in path.read_text(encoding="utf-8").splitlines())
        else:
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                actual_rows = sum(1 for _ in csv.DictReader(handle))
        result.append({"path": name, "rows": actual_rows, "expected_rows": metadata["rows"], "sha256": actual_hash, "expected_sha256": metadata["sha256"], "valid": actual_rows == metadata["rows"] and actual_hash == metadata["sha256"]})
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify v15 targeted recapture acceptance criteria")
    parser.add_argument("--capture-root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--overlay", required=True)
    parser.add_argument("--base-package", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    overlay_root = Path(args.overlay)
    package_root = Path(args.package)
    review = matrix_index(overlay_root / "review")
    context = matrix_index(overlay_root / "context")

    content_results = {}
    for key in sorted(CONTENT_KEYS):
        raw, markers = selected_raw(review[key])
        content_results[key] = {"conclusion": review[key].get("conclusion"), "selected": review[key].get("selected"), "raw_transcription": raw, "uncertainty_markers": markers}
    target_review_uncertainties = {}
    for key in sorted(REVIEW_GAP_KEYS | CONTENT_KEYS):
        raw, markers = selected_raw(review[key])
        if markers:
            target_review_uncertainties[key] = {"raw_transcription": raw, "uncertainty_markers": markers}
    context_results = {}
    for key in sorted(CONTEXT_KEYS):
        cell = context[f"{key}|CTX"]
        raw, markers = selected_raw(cell)
        context_results[key] = {"conclusion": cell.get("conclusion"), "raw_transcription": raw, "uncertainty_markers": markers}

    base_manifest = read_json(Path(args.base_package) / "package-manifest.json")
    new_manifest = read_json(package_root / "package-manifest.json")
    base_version = base_manifest["dataset_version"]
    new_version = new_manifest["dataset_version"]
    base_manual = Path(args.base_package) / f"manual_review_required.{base_version}.csv"
    new_manual = package_root / f"manual_review_required.{new_version}.csv"
    base_manual_rows, base_reasons = csv_reason_counts(base_manual)
    new_manual_rows, new_reasons = csv_reason_counts(new_manual)

    manifest_files = verify_manifest(Path(args.capture_root), Path(args.manifest))
    package_files = verify_package(package_root)
    review_capture_gaps = [key for key, cell in review.items() if cell.get("status") == "capture_gap"]
    context_capture_gaps = [key for key, cell in context.items() if cell.get("status") == "capture_gap"]
    content_unresolved = [key for key, cell in review.items() if cell.get("conclusion") == "unresolved" and cell.get("status") != "capture_gap"]
    gap_statuses = Counter(review[key].get("status") for key in REVIEW_GAP_KEYS)
    report = {
        "valid": all(item["valid"] for item in manifest_files + package_files) and not review_capture_gaps and not context_capture_gaps and not content_unresolved,
        "capture_manifest_sha256": sha256(Path(args.manifest)),
        "capture_files": manifest_files,
        "package_files": package_files,
        "review_gap_targets": {"expected": 52, "statuses": dict(gap_statuses), "remaining_capture_gaps": [key for key in REVIEW_GAP_KEYS if review[key].get("status") == "capture_gap"]},
        "context_gap_targets": {"expected": 41, "reviewed": sum(context[f"{key}|CTX"].get("status") == "review" for key in CONTEXT_KEYS), "remaining_capture_gaps": [key for key in CONTEXT_KEYS if context[f"{key}|CTX"].get("status") == "capture_gap"]},
        "content_targets": content_results,
        "target_review_uncertainties": target_review_uncertainties,
        "remaining": {"review_capture_gaps": review_capture_gaps, "context_capture_gaps": context_capture_gaps, "content_unresolved": content_unresolved},
        "before_after": {
            "capture_gaps": [base_manifest["files"][f"capture_gaps.{base_version}.jsonl"]["rows"], new_manifest["files"][f"capture_gaps.{new_version}.jsonl"]["rows"]],
            "content_unresolved": [base_reasons["content_unresolved"], new_reasons["content_unresolved"]],
            "manual_review_required": [base_manual_rows, new_manual_rows],
            "manual_reason_counts": {"before": dict(base_reasons), "after": dict(new_reasons)},
        },
        "target_context_results": context_results,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"valid": report["valid"], "review_gap_statuses": dict(gap_statuses), "before_after": report["before_after"], "remaining": report["remaining"]}, ensure_ascii=False))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
