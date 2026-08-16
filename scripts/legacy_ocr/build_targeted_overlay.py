from __future__ import annotations

import argparse
import hashlib
import json
from copy import deepcopy
from pathlib import Path


SHEETS = ["主要课程", "数学课", "美育", "大英和视听说", "思政课", "外教", "MOOC", "体育课"]
REVIEW_GAP_KEYS = {
    f"主要课程|{row}|{column}"
    for low, high, columns in [(63, 65, "FGHI"), (122, 126, "FGHIJKLM")]
    for row in range(low, high + 1)
    for column in columns
}
CONTENT_KEYS = {
    "主要课程|98|K", "主要课程|121|H", "主要课程|323|F",
    "主要课程|439|F", "主要课程|449|F", "大英和视听说|56|H",
}
CONTEXT_KEYS = {
    *(f"主要课程|{row}" for row in [62, *range(191, 194), *range(422, 457)]),
    *(f"体育课|{row}" for row in range(24, 26)),
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def selected_analysis(cell: dict) -> dict:
    selected = cell.get("selected")
    return cell.get(selected) or {} if selected else {}


def confirmed_blank(cell: dict) -> bool:
    analysis = selected_analysis(cell)
    return (
        cell.get("conclusion") in {"agreed", "arbitrated"}
        and analysis.get("raw_transcription", "") == ""
        and not analysis.get("uncertainty_markers")
    )


def as_deterministic_blank(cell: dict) -> dict:
    keep = {
        name: deepcopy(cell.get(name))
        for name in (
            "key", "worksheet", "row", "source_column", "display_header", "context_row",
            "context", "ocr",
        )
    }
    return {
        **keep,
        "status": "blank",
        "routing_reason": "deterministic_blank_after_targeted_recapture",
        "capture_gap": None,
        "conclusion": "blank",
        "selected": None,
        "unresolved_reason": None,
    }


def collect_patch_cells(root: Path) -> dict[str, dict]:
    result = {}
    for path in root.glob("*/matrix.json"):
        for cell in read_json(path)["cells"]:
            key = cell["key"]
            if key in result:
                raise ValueError(f"duplicate patch matrix cell: {key}")
            result[key] = cell
    return result


def matrix_status(cells: list[dict]) -> dict:
    gaps = sum(cell.get("status") == "capture_gap" for cell in cells)
    unresolved = sum(cell.get("conclusion") == "unresolved" for cell in cells)
    return {
        "status": "completed" if not gaps and not unresolved else "completed_with_exceptions",
        "expected_cells": len(cells),
        "routed_cells": sum(cell.get("status") == "review" for cell in cells),
        "unresolved_cells": gaps + unresolved,
        "capture_gap_cells": gaps,
    }


def overlay_matrices(old_root: Path, patch_root: Path, out_root: Path, target_keys: set[str], review: bool) -> dict[str, dict]:
    patches = collect_patch_cells(patch_root)
    if set(patches) != target_keys:
        raise ValueError(f"patch matrix target mismatch: extra={sorted(set(patches) - target_keys)}, missing={sorted(target_keys - set(patches))}")
    all_cells = {}
    for sheet in SHEETS:
        source = read_json(old_root / sheet / "matrix.json")
        cells = []
        replaced = set()
        for old_cell in source["cells"]:
            key = old_cell["key"]
            if key in patches:
                cell = deepcopy(patches[key])
                if review and key in REVIEW_GAP_KEYS and confirmed_blank(cell):
                    cell = as_deterministic_blank(cell)
                cells.append(cell)
                replaced.add(key)
            else:
                cells.append(old_cell)
        expected_for_sheet = {key for key in target_keys if key.startswith(f"{sheet}|")}
        if replaced != expected_for_sheet:
            raise ValueError(f"matrix keys absent from base {sheet}: {sorted(expected_for_sheet - replaced)}")
        matrix = {**source, "input_sha256": sha256(old_root / sheet / "matrix.json"), "cells": cells}
        write_json(out_root / sheet / "matrix.json", matrix)
        status = matrix_status(cells)
        write_json(out_root / sheet / "status.json", status)
        write_json(
            out_root / sheet / "validation.json",
            {"valid": True, "unique_keys": len({cell["key"] for cell in cells}), "expected_cells": len(cells), "targeted_replacements": len(replaced)},
        )
        all_cells.update({cell["key"]: cell for cell in cells})
    return all_cells


def queue_patch(item: dict, status: str) -> dict:
    return {**item, "status": status, "routing_reason": "targeted_recapture"}


def build_composite_manifest(base_path: Path, recapture_path: Path) -> dict:
    base = read_json(base_path)
    recapture = read_json(recapture_path)
    files = dict(base["files"])
    for item in recapture["files"]:
        path, digest = item["path"], item["sha256"]
        if path in files and files[path] != digest:
            raise ValueError(f"manifest source collision: {path}")
        files[path] = digest
    return {
        "contract_version": "legacy-evidence-composite-manifest-v1",
        "status": "complete",
        "files": files,
        "source_manifests": [
            {"role": "base", "path": str(base_path), "sha256": sha256(base_path)},
            {"role": "targeted_recapture", "path": str(recapture_path), "sha256": sha256(recapture_path)},
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Overlay v15 targeted recaptures on the frozen v14 review artifacts")
    parser.add_argument("--base-manifest", required=True)
    parser.add_argument("--recapture-manifest", required=True)
    parser.add_argument("--base-review-root", required=True)
    parser.add_argument("--base-context-root", required=True)
    parser.add_argument("--base-review-queue", required=True)
    parser.add_argument("--base-context-queue", required=True)
    parser.add_argument("--review-patches", required=True)
    parser.add_argument("--context-patches", required=True)
    parser.add_argument("--review-results", required=True)
    parser.add_argument("--context-results", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = Path(args.out)

    review_cells = overlay_matrices(Path(args.base_review_root), Path(args.review_results), out / "review", REVIEW_GAP_KEYS | CONTENT_KEYS, True)
    overlay_matrices(Path(args.base_context_root), Path(args.context_results), out / "context", {f"{key}|CTX" for key in CONTEXT_KEYS}, False)

    review_patch_items = {item["key"]: item for item in read_jsonl(Path(args.review_patches))}
    review_queue = {item["key"]: item for item in read_jsonl(Path(args.base_review_queue))}
    for key in REVIEW_GAP_KEYS | CONTENT_KEYS:
        if review_cells[key].get("status") == "review":
            review_queue[key] = queue_patch(review_patch_items[key], "review")
        else:
            review_queue.pop(key, None)
    sheet_order = {sheet: index for index, sheet in enumerate(SHEETS)}
    review_rows = sorted(review_queue.values(), key=lambda item: (sheet_order[item["worksheet"]], item["row"], item["column"]))
    write_jsonl(out / "queues" / "review-queue.jsonl", review_rows)

    old_gap_path = Path(args.base_review_queue).parent / "capture-gaps.json"
    old_gaps = read_json(old_gap_path) if old_gap_path.exists() else []
    remaining_review_gaps = [item for item in old_gaps if item["key"] not in REVIEW_GAP_KEYS]
    write_json(out / "queues" / "capture-gaps.json", remaining_review_gaps)

    context_patch_items = {item["key"]: item for item in read_jsonl(Path(args.context_patches))}
    context_queue = {item["key"]: item for item in read_jsonl(Path(args.base_context_queue))}
    for key in CONTEXT_KEYS:
        context_queue[key] = queue_patch(context_patch_items[key], "review")
    context_rows = sorted(context_queue.values(), key=lambda item: (sheet_order[item["worksheet"]], item["row"]))
    write_jsonl(out / "queues" / "context-queue.jsonl", context_rows)

    composite = build_composite_manifest(Path(args.base_manifest), Path(args.recapture_manifest))
    write_json(out / "lineage-manifest.json", composite)
    review_blanks = sum(review_cells[key].get("status") == "blank" for key in REVIEW_GAP_KEYS)
    summary = {
        "review_targets": len(REVIEW_GAP_KEYS | CONTENT_KEYS),
        "review_gap_targets": len(REVIEW_GAP_KEYS),
        "review_gap_confirmed_blank": review_blanks,
        "review_gap_routed": len(REVIEW_GAP_KEYS) - review_blanks,
        "content_targets": len(CONTENT_KEYS),
        "context_targets": len(CONTEXT_KEYS),
        "remaining_review_capture_gaps": len(remaining_review_gaps),
        "review_queue_rows": len(review_rows),
        "context_queue_rows": len(context_rows),
        "lineage_manifest_sha256": sha256(out / "lineage-manifest.json"),
    }
    write_json(out / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
