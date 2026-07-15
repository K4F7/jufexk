from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

from pipeline import PREVIEW_FIELDS


REVIEW_FIELDS = PREVIEW_FIELDS + [
    "decision", "approved_course_id", "approved_teacher_id", "approved_offering_id",
    "duplicate_action", "review_note",
]
APPROVED_FIELDS = [
    "course_id", "teacher_id", "offering_id", "category", "comment", "term",
    "source_type", "source_label", "source_file", "sheet_name", "source_row",
    "raw_ocr_text", "ocr_confidence", "ocr_tokens_json", "inherited_from",
    "ocr_course_name", "ocr_teacher_name", "duplicate_group", "review_note",
]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, object]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader(); writer.writerows(rows)


def prepare(preview: Path, output: Path) -> None:
    rows = read_csv(preview)
    for row in rows:
        row.update({"decision": "", "approved_course_id": row.get("matched_course_id", ""), "approved_teacher_id": row.get("matched_teacher_id", ""), "approved_offering_id": row.get("matched_offering_id", ""), "duplicate_action": "", "review_note": ""})
    write_csv(output, rows, REVIEW_FIELDS)


def finalize(queue: Path, reference_path: Path, approved_path: Path, errors_path: Path, payload_dir: Path) -> int:
    rows = read_csv(queue)
    reference = json.loads(reference_path.read_text(encoding="utf-8-sig"))
    courses = {str(row["id"]): row for row in reference["courses"]}
    teachers = {str(row["id"]): row for row in reference["teachers"]}
    relations = {(str(row["course_id"]), str(row["teacher_id"])) for row in reference["course_teachers"]}
    offerings = {str(row["id"]): row for row in reference["offerings"]}
    offering_teachers = {(str(row["offering_id"]), str(row["teacher_id"])) for row in reference["offering_teachers"]}
    approved: list[dict[str, object]] = []; errors: list[dict[str, object]] = []
    for index, row in enumerate(rows, start=2):
        decision = row.get("decision", "").strip().lower()
        if decision in {"", "skip", "reject"}: continue
        if decision != "approve":
            errors.append({"row": index, "source_file": row.get("source_file", ""), "source_row": row.get("source_row", ""), "error": "decision 必须为 approve、reject、skip 或留空"}); continue
        course_id = row.get("approved_course_id", "").strip(); teacher_id = row.get("approved_teacher_id", "").strip(); offering_id = row.get("approved_offering_id", "").strip()
        reasons: list[str] = []
        if course_id not in courses: reasons.append("approved_course_id 不存在")
        if teacher_id not in teachers: reasons.append("approved_teacher_id 不存在")
        if course_id in courses and teacher_id in teachers and (course_id, teacher_id) not in relations: reasons.append("教师不在课程已有任课关系中")
        if offering_id:
            offering = offerings.get(offering_id)
            if not offering: reasons.append("approved_offering_id 不存在")
            elif str(offering["course_id"]) != course_id or (offering_id, teacher_id) not in offering_teachers: reasons.append("开课班与课程、教师不一致")
            if not row.get("term", "").strip(): reasons.append("学期为空时不得指定开课班")
        if row.get("duplicate_group") and row.get("duplicate_action", "").strip().lower() != "keep": reasons.append("疑似重复记录必须明确填写 duplicate_action=keep，或将 decision 设为 skip")
        if not row.get("review_note", "").strip(): reasons.append("批准记录必须填写 review_note")
        if not row.get("comment", "").strip(): reasons.append("comment 不能为空")
        if not row.get("raw_ocr_text", "").strip(): reasons.append("raw_ocr_text 不能为空")
        try:
            confidence = float(row.get("ocr_confidence", ""))
            if not 0 <= confidence <= 1: raise ValueError
            if not isinstance(json.loads(row.get("ocr_tokens_json", "[]")), list): raise ValueError
        except (ValueError, json.JSONDecodeError): reasons.append("OCR 置信度或 token JSON 无效")
        if reasons:
            errors.append({"row": index, "source_file": row.get("source_file", ""), "source_row": row.get("source_row", ""), "error": ";".join(reasons)}); continue
        approved.append({
            "course_id": course_id, "teacher_id": teacher_id, "offering_id": offering_id,
            "category": courses[course_id]["category"], "comment": row["comment"], "term": row.get("term", ""),
            "source_type": "legacy_ocr", "source_label": "腾讯表格历史资料",
            "source_file": row["source_file"], "sheet_name": row.get("sheet_name", ""), "source_row": row["source_row"],
            "raw_ocr_text": row["raw_ocr_text"], "ocr_confidence": row["ocr_confidence"], "ocr_tokens_json": row.get("ocr_tokens_json", "[]"),
            "inherited_from": row.get("inherited_from", ""), "ocr_course_name": row.get("ocr_course_name", ""), "ocr_teacher_name": row.get("ocr_teacher_name", ""),
            "duplicate_group": row.get("duplicate_group", ""), "review_note": row["review_note"],
        })
    write_csv(errors_path, errors, ["row", "source_file", "source_row", "error"])
    if errors:
        if approved_path.exists(): approved_path.unlink()
        return 2
    write_csv(approved_path, approved, APPROVED_FIELDS)
    payload_dir.mkdir(parents=True, exist_ok=True)
    for old in payload_dir.glob("legacy_import_payload_*.json"): old.unlink()
    for offset in range(0, len(approved), 40):
        part = offset // 40 + 1; payload_rows = approved[offset:offset + 40]
        canonical = json.dumps(payload_rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        payload = {"idempotencyKey": hashlib.sha256(canonical.encode()).hexdigest(), "manifest": {"source": approved_path.name, "part": part, "totalRows": len(approved)}, "rows": payload_rows}
        (payload_dir / f"legacy_import_payload_{part:03d}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="历史 OCR 人工确认与批准文件生成")
    sub = parser.add_subparsers(dest="command", required=True)
    prepare_parser = sub.add_parser("prepare"); prepare_parser.add_argument("--preview", required=True); prepare_parser.add_argument("--out", required=True)
    final_parser = sub.add_parser("finalize"); final_parser.add_argument("--queue", required=True); final_parser.add_argument("--reference", required=True); final_parser.add_argument("--approved", required=True); final_parser.add_argument("--errors", required=True); final_parser.add_argument("--payload-dir", required=True)
    args = parser.parse_args()
    if args.command == "prepare": prepare(Path(args.preview), Path(args.out)); return 0
    return finalize(Path(args.queue), Path(args.reference), Path(args.approved), Path(args.errors), Path(args.payload_dir))


if __name__ == "__main__": raise SystemExit(main())
