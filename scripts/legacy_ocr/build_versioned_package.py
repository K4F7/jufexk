from __future__ import annotations

import argparse
import csv
import hashlib
import json
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SHEETS = ["主要课程", "数学课", "美育", "大英和视听说", "思政课", "外教", "MOOC", "体育课"]
PLACEHOLDERS = {"", "[blank]", "[unclear]", "[pending]"}
CAPTURE_GAP_STATUSES = {"capture_gap", "context_gap"}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def selected_text(cell: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    selected = cell.get("selected")
    if selected not in {"analysis_a", "analysis_b"}:
        return "", {}
    analysis = cell.get(selected) or {}
    return analysis.get("raw_transcription", ""), analysis


def parse_context(value: str) -> tuple[str, str]:
    if not value.startswith("course=") or "\nteacher=" not in value:
        raise ValueError(f"invalid selected context transcription: {value!r}")
    course, separator, teacher = value[7:].rpartition("\nteacher=")
    if not separator:
        raise ValueError(f"invalid selected context transcription: {value!r}")
    normalize = lambda field: "".join(line.strip() for line in field.splitlines())
    return normalize(course), normalize(teacher)


def stable_id(kind: str, *parts: str) -> str:
    canonical = "\0".join([kind, *[unicodedata.normalize("NFC", part.strip()) for part in parts]])
    return f"{kind}-{hashlib.sha256(canonical.encode()).hexdigest()[:32]}"


def unique_index(rows: list[dict[str, Any]], key_fn, label: str) -> dict[Any, dict[str, Any]]:
    result = {}
    for row in rows:
        key = key_fn(row)
        if key in result:
            raise ValueError(f"duplicate {label} key: {key}")
        result[key] = row
    return result


def is_capture_gap(item: dict[str, Any]) -> bool:
    return item.get("status") in CAPTURE_GAP_STATUSES


def validate_queue_sources(
    rows, label: str, manifest: dict[str, Any], manifest_sha256: str,
) -> None:
    for item in rows:
        if is_capture_gap(item):
            if item.get("manifest_sha256") != manifest_sha256:
                raise ValueError(f"{label} capture gap is not linked to capture manifest")
            continue
        if manifest["files"].get(item.get("source_file")) != item.get("source_sha256"):
            raise ValueError(f"{label} source hash is not linked to capture manifest: {item.get('source_file')}")


def capture_source(item: dict[str, Any]) -> dict[str, Any]:
    if is_capture_gap(item):
        return {"source_file": None, "source_sha256": None, "crop_sha256": None, "bbox": None}
    return {name: item[name] for name in ("source_file", "source_sha256", "crop_sha256", "bbox")}


def manual_review_reasons(
    *, course_id, teacher_id, comment: str, review_conclusion, review_markers,
    context_markers, context_capture_gap: bool,
) -> list[str]:
    reasons = []
    if review_conclusion == "unresolved": reasons.append("content_unresolved")
    if review_markers: reasons.append("review_uncertain")
    if context_markers: reasons.append("context_uncertain")
    if context_capture_gap: reasons.append("context_capture_gap")
    if not course_id: reasons.append("course_unclear")
    if not teacher_id: reasons.append("teacher_unclear")
    if not comment.strip(): reasons.append("comment_blank")
    return reasons


def load_selected_context(root: Path) -> dict[tuple[str, int], dict[str, Any]]:
    result = {}
    for sheet in SHEETS:
        matrix = read_json(root / sheet / "matrix.json")
        carry_course = ""
        carry_row = None
        for cell in sorted(matrix["cells"], key=lambda item: item["row"]):
            if cell.get("status") != "review":
                if is_capture_gap(cell):
                    carry_course = ""
                    carry_row = None
                continue
            raw, analysis = selected_text(cell)
            course, teacher = parse_context(raw)
            inherited_from = None
            if course == "[blank]":
                course = carry_course
                inherited_from = carry_row if course else None
            elif course == "[unclear]":
                carry_course = ""; carry_row = None
            elif course:
                carry_course = course; carry_row = cell["row"]
            result[(sheet, cell["row"])] = {
                "course": course, "teacher": teacher, "raw": raw,
                "inherited_from": inherited_from,
                "uncertainty_markers": analysis.get("uncertainty_markers", []),
                "conclusion": cell.get("conclusion"),
            }
    return result


def build_package(
    version: str, manifest_path: Path, review_queue_path: Path, context_queue_path: Path,
    review_root: Path, context_root: Path,
) -> dict[str, list[dict[str, Any]]]:
    manifest = read_json(manifest_path)
    if manifest.get("status") != "complete" or not isinstance(manifest.get("files"), dict):
        raise ValueError("capture manifest is not complete")
    manifest_sha256 = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    reviews = unique_index(read_jsonl(review_queue_path), lambda item: item["key"], "review")
    contexts = unique_index(read_jsonl(context_queue_path), lambda item: (item["worksheet"], item["row"]), "context")
    review_gap_path = review_queue_path.parent / "capture-gaps.json"
    review_gaps = read_json(review_gap_path) if review_gap_path.exists() else []
    for item in review_gaps:
        if item.get("manifest_sha256") != manifest_sha256:
            raise ValueError("review capture gap is not linked to capture manifest")
    validate_queue_sources(reviews.values(), "review", manifest, manifest_sha256)
    validate_queue_sources(contexts.values(), "context", manifest, manifest_sha256)
    selected_context = load_selected_context(context_root)
    course_sources: dict[str, list[dict[str, Any]]] = defaultdict(list)
    teacher_sources: dict[str, list[dict[str, Any]]] = defaultdict(list)
    relation_sources: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    evaluations = []
    for sheet in SHEETS:
        matrix = read_json(review_root / sheet / "matrix.json")
        for cell in matrix["cells"]:
            if cell.get("status") != "review":
                continue
            source = reviews[cell["key"]]
            if is_capture_gap(source):
                raise ValueError(f"review matrix references capture gap: {cell['key']}")
            review_capture = capture_source(source)
            comment, analysis = selected_text(cell)
            context = selected_context.get((sheet, cell["row"]), {"course": "", "teacher": "", "raw": "", "uncertainty_markers": ["missing context"], "conclusion": "missing"})
            course_name = context["course"] if context["course"] not in PLACEHOLDERS else ""
            teacher_name = context["teacher"] if context["teacher"] not in PLACEHOLDERS else ""
            course_id = stable_id("course", course_name) if course_name else None
            teacher_id = stable_id("teacher", teacher_name) if teacher_name else None
            context_source = contexts[(sheet, cell["row"])]
            context_capture = capture_source(context_source)
            evaluation_id = stable_id("evaluation", manifest_sha256, cell["key"])
            provenance = {
                "evaluation_id": evaluation_id, "worksheet": sheet, "row": cell["row"], "review_key": cell["key"],
                "review_source_file": review_capture["source_file"], "review_source_sha256": review_capture["source_sha256"], "review_crop_sha256": review_capture["crop_sha256"],
                "context_source_file": context_capture["source_file"], "context_source_sha256": context_capture["source_sha256"], "context_crop_sha256": context_capture["crop_sha256"],
            }
            if course_id:
                course_sources[course_id].append(provenance)
            if teacher_id:
                teacher_sources[teacher_id].append(provenance)
            if course_id and teacher_id:
                relation_sources[(course_id, teacher_id)].append(provenance)
            review_reasons = manual_review_reasons(
                course_id=course_id, teacher_id=teacher_id, comment=comment,
                review_conclusion=cell.get("conclusion"), review_markers=analysis.get("uncertainty_markers", []),
                context_markers=context.get("uncertainty_markers", []), context_capture_gap=is_capture_gap(context_source),
            )
            evaluations.append({
                "schema_version": "historical-evaluation-v1", "dataset_version": version,
                "evaluation_id": evaluation_id,
                "review_status": "needs_review" if review_reasons else "candidate",
                "manual_review_reasons": review_reasons,
                "worksheet": sheet, "source_row": cell["row"], "source_column": cell["source_column"],
                "course_id": course_id, "course_name": course_name or "[unclear]",
                "teacher_id": teacher_id, "teacher_name": teacher_name or "[unclear]",
                "comment": comment, "context_inherited_from_row": context.get("inherited_from"),
                "review_conclusion": cell.get("conclusion"), "review_selected": cell.get("selected"),
                "review_uncertainty_markers": analysis.get("uncertainty_markers", []),
                "context_uncertainty_markers": context.get("uncertainty_markers", []),
                "context_raw": context.get("raw", ""), "context_conclusion": context.get("conclusion"),
                "source": {
                    "capture_manifest_sha256": manifest_sha256,
                    "review_source_file": review_capture["source_file"], "review_source_sha256": review_capture["source_sha256"],
                    "review_bbox": review_capture["bbox"], "review_crop_sha256": review_capture["crop_sha256"],
                    "ocr_text": source.get("text", ""), "ocr_confidence": source.get("confidence"), "ocr_tokens": source.get("tokens", []),
                    "context_source_file": context_capture["source_file"], "context_source_sha256": context_capture["source_sha256"],
                    "context_bbox": context_capture["bbox"], "context_crop_sha256": context_capture["crop_sha256"],
                },
            })
    courses = [
        {"schema_version": "course-candidate-v1", "dataset_version": version, "course_id": course_id,
         "name": next(item["course_name"] for item in evaluations if item["course_id"] == course_id),
         "review_status": "candidate", "provenance": sources}
        for course_id, sources in sorted(course_sources.items())
    ]
    teachers = [
        {"schema_version": "teacher-candidate-v1", "dataset_version": version, "teacher_id": teacher_id,
         "name": next(item["teacher_name"] for item in evaluations if item["teacher_id"] == teacher_id),
         "review_status": "candidate", "provenance": sources}
        for teacher_id, sources in sorted(teacher_sources.items())
    ]
    relations = [
        {"schema_version": "course-teacher-candidate-v1", "dataset_version": version,
         "relation_id": stable_id("relation", course_id, teacher_id), "course_id": course_id, "teacher_id": teacher_id,
         "review_status": "candidate", "provenance": sources}
        for (course_id, teacher_id), sources in sorted(relation_sources.items())
    ]
    capture_gaps = [
        {
            "schema_version": "capture-gap-v1", "dataset_version": version,
            "kind": "review_cell" if item.get("status") == "capture_gap" else "context_row",
            "key": item["key"], "worksheet": item["worksheet"], "row": item["row"],
            "column": item.get("column"), "reason": item.get("reason"),
            "recovery_condition": item.get("recovery_condition"), "capture_manifest_sha256": item.get("manifest_sha256"),
        }
        for item in [
            *[{**gap, "status": "capture_gap"} for gap in review_gaps],
            *[context for context in contexts.values() if is_capture_gap(context)],
        ]
    ]
    return {"courses": courses, "teachers": teachers, "course_teachers": relations, "historical_evaluations": evaluations, "capture_gaps": capture_gaps}


def write_outputs(out: Path, version: str, package: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, rows in package.items():
        path = out / f"{name}.{version}.jsonl"
        path.write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
        files[path.name] = {"rows": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    review_path = out / f"human_review_queue.{version}.csv"
    fields = [
        "evaluation_id", "review_status", "worksheet", "source_row", "source_column", "course_id", "course_name", "teacher_id", "teacher_name", "comment",
        "review_source_file", "review_source_sha256", "review_crop_sha256", "review_bbox_json",
        "context_source_file", "context_source_sha256", "context_crop_sha256", "context_bbox_json", "context_raw",
        "manual_review_reasons_json", "context_uncertainty_markers_json",
        "decision", "approved_course_name", "approved_teacher_name", "review_note",
    ]
    review_exports = [
        (review_path, package["historical_evaluations"]),
        (out / f"manual_review_required.{version}.csv", [row for row in package["historical_evaluations"] if row["review_status"] == "needs_review"]),
    ]
    for export_path, export_rows in review_exports:
        with export_path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore"); writer.writeheader()
            for row in export_rows:
                source = row["source"]
                writer.writerow({
                    **row,
                    "review_source_file": source["review_source_file"], "review_source_sha256": source["review_source_sha256"], "review_crop_sha256": source["review_crop_sha256"], "review_bbox_json": json.dumps(source["review_bbox"]),
                    "context_source_file": source["context_source_file"], "context_source_sha256": source["context_source_sha256"], "context_crop_sha256": source["context_crop_sha256"], "context_bbox_json": json.dumps(source["context_bbox"]),
                    "manual_review_reasons_json": json.dumps(row["manual_review_reasons"], ensure_ascii=False),
                    "context_uncertainty_markers_json": json.dumps(row["context_uncertainty_markers"], ensure_ascii=False),
                    "decision": "", "approved_course_name": row["course_name"], "approved_teacher_name": row["teacher_name"], "review_note": "",
                })
        files[export_path.name] = {"rows": len(export_rows), "sha256": hashlib.sha256(export_path.read_bytes()).hexdigest()}
    manifest = {"contract_version": "legacy-review-package-v1", "dataset_version": version, "generated_at": datetime.now(timezone.utc).isoformat(), "files": files}
    manifest_path = out / "package-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Build traceable versioned legacy review JSONL and human review CSV")
    parser.add_argument("--version", required=True); parser.add_argument("--manifest", required=True)
    parser.add_argument("--review-queue", required=True); parser.add_argument("--context-queue", required=True)
    parser.add_argument("--review-root", required=True); parser.add_argument("--context-root", required=True); parser.add_argument("--out", required=True)
    args = parser.parse_args()
    package = build_package(args.version, Path(args.manifest), Path(args.review_queue), Path(args.context_queue), Path(args.review_root), Path(args.context_root))
    manifest = write_outputs(Path(args.out), args.version, package)
    print(json.dumps({name: item["rows"] for name, item in manifest["files"].items()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
