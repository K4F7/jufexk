from __future__ import annotations

import argparse
import csv
import re
import statistics
import unicodedata
from collections import defaultdict
from pathlib import Path


COMMENT_WORDS = (
    "作业", "考试", "期末", "分数", "给分", "完成", "任务", "签到", "点名",
    "水课", "选课", "推荐", "不选", "很好", "可以", "容易", "难", "学生评价",
    "老师", "我们", "学期", "讲解", "疫情", "轻松", "喜欢", "平时",
)


def normalize_name(value: str, *, person: bool = False) -> str:
    value = unicodedata.normalize("NFKC", value or "").strip()
    value = re.sub(r"\s+", "", value)
    if person:
        value = re.sub(r"(?:老师|教师|教授|副教授|讲师)$", "", value)
        value = re.sub(r"[（(][^）)]{0,20}[）)]$", "", value)
    return value


def assess_teacher(value: str) -> tuple[bool, str]:
    compact = normalize_name(value, person=True)
    reasons: list[str] = []
    if not compact:
        reasons.append("empty_after_normalization")
    if any(word in compact for word in COMMENT_WORDS):
        reasons.append("contains_review_language")
    if re.search(r"[\d，。；：！？!?;,/:]", compact):
        reasons.append("contains_non_name_punctuation_or_digits")
    chinese_name = bool(re.fullmatch(r"[\u3400-\u9fff·]{2,6}", compact))
    foreign_name = bool(re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,49}", compact))
    if not chinese_name and not foreign_name:
        reasons.append("name_shape_unconfirmed")
    return not reasons, ";".join(reasons)


def assess_course(value: str) -> tuple[bool, str]:
    compact = normalize_name(value)
    reasons: list[str] = []
    if len(compact) < 2 or len(compact) > 30:
        reasons.append("course_length_unconfirmed")
    if any(word in compact for word in COMMENT_WORDS):
        reasons.append("contains_review_language")
    if re.search(r"[，。；：、！？,.;:!?]", compact):
        reasons.append("contains_review_punctuation")
    return not reasons, ";".join(reasons)


def aggregate(rows: list[dict[str, str]], field: str, *, person: bool) -> list[dict[str, object]]:
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        original = (row.get(field) or "").strip()
        normalized = normalize_name(original, person=person)
        if normalized:
            groups[normalized].append(row)
    output: list[dict[str, object]] = []
    assessor = assess_teacher if person else assess_course
    for normalized, members in groups.items():
        originals: list[str] = []
        for member in members:
            original = (member.get(field) or "").strip()
            if original not in originals:
                originals.append(original)
        likely, reason = assessor(originals[0])
        confidences = [float(row["ocr_confidence"]) for row in members if row.get("ocr_confidence")]
        examples = list(dict.fromkeys(f"{row['source_file']}:{row['source_row']}" for row in members))[:5]
        sheets = sorted({row.get("sheet_name", "") for row in members if row.get("sheet_name")})
        files = {row.get("source_file", "") for row in members if row.get("source_file")}
        output.append({
            "original_name": " | ".join(originals),
            "normalized_name": normalized,
            "occurrence_count": len(members),
            "independent_source_count": len(files),
            "average_ocr_confidence": round(statistics.mean(confidences), 4) if confidences else "",
            "sheets": ";".join(sheets),
            "source_examples": ";".join(examples),
            "likely_entity": str(likely).lower(),
            "needs_review": "true",
            "review_reason": reason or "requires_human_confirmation",
        })
    return sorted(output, key=lambda row: (row["likely_entity"] != "true", -int(row["occurrence_count"]), str(row["normalized_name"])))


def aggregate_relations(rows: list[dict[str, str]]) -> list[dict[str, object]]:
    groups: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        course = (row.get("ocr_course_name") or "").strip()
        teacher = (row.get("ocr_teacher_name") or "").strip()
        course_key, teacher_key = normalize_name(course), normalize_name(teacher, person=True)
        if not course_key or not teacher_key:
            continue
        course_ok, _ = assess_course(course)
        teacher_ok, _ = assess_teacher(teacher)
        if course_ok and teacher_ok:
            groups[(course_key, teacher_key)].append(row)
    output: list[dict[str, object]] = []
    for (course_key, teacher_key), members in groups.items():
        course_originals = list(dict.fromkeys((row.get("ocr_course_name") or "").strip() for row in members))
        teacher_originals = list(dict.fromkeys((row.get("ocr_teacher_name") or "").strip() for row in members))
        files = {row.get("source_file", "") for row in members if row.get("source_file")}
        inherited_count = sum(bool(row.get("inherited_from")) for row in members)
        dangerous_count = sum(any(reason in (row.get("review_reason") or "") for reason in ("multiple_teacher_rows_in_band", "teacher_unresolved_section_row", "cross_screenshot_inheritance")) for row in members)
        likely = len(files) >= 2 and len(members) >= 2 and dangerous_count == 0
        reasons = []
        if len(files) < 2: reasons.append("single_source_only")
        if inherited_count: reasons.append("contains_inherited_entity")
        if dangerous_count: reasons.append("contains_ambiguous_teacher_context")
        reasons.append("requires_human_relation_confirmation")
        confidences = [float(row["ocr_confidence"]) for row in members if row.get("ocr_confidence")]
        output.append({
            "ocr_course_name": " | ".join(course_originals), "normalized_course_name": course_key,
            "ocr_teacher_name": " | ".join(teacher_originals), "normalized_teacher_name": teacher_key,
            "evaluation_row_count": len(members), "independent_source_count": len(files),
            "inherited_evidence_count": inherited_count, "ambiguous_context_count": dangerous_count,
            "average_ocr_confidence": round(statistics.mean(confidences), 4) if confidences else "",
            "sheets": ";".join(sorted({row.get("sheet_name", "") for row in members if row.get("sheet_name")})),
            "source_examples": ";".join(list(dict.fromkeys(f"{row['source_file']}:{row['source_row']}" for row in members))[:5]),
            "likely_relation": str(likely).lower(), "needs_review": "true", "review_reason": ";".join(reasons),
        })
    return sorted(output, key=lambda row: (row["likely_relation"] != "true", -int(row["independent_source_count"]), -int(row["evaluation_row_count"]), str(row["normalized_course_name"]), str(row["normalized_teacher_name"])))


def write(path: Path, rows: list[dict[str, object]]) -> None:
    fields = ["original_name", "normalized_name", "occurrence_count", "independent_source_count", "average_ocr_confidence", "sheets", "source_examples", "likely_entity", "needs_review", "review_reason"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader(); writer.writerows(rows)


def write_review_queue(path: Path, rows: list[dict[str, object]], extra_fields: list[str]) -> None:
    base_fields = list(rows[0].keys()) if rows else []
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=base_fields + extra_fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({**row, **{field: "" for field in extra_fields}})


def main() -> int:
    parser = argparse.ArgumentParser(description="聚合 OCR 实体候选，仅供人工确认，不创建数据库记录")
    parser.add_argument("--preview", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    with Path(args.preview).open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    teacher_candidates = aggregate(rows, "ocr_teacher_name", person=True)
    course_candidates = aggregate(rows, "ocr_course_name", person=False)
    write(out / "teacher_candidates_review.csv", teacher_candidates)
    write(out / "course_candidates_review.csv", course_candidates)
    write_review_queue(out / "teacher_catalog_review_queue.csv", teacher_candidates, ["decision", "existing_teacher_id", "approved_name", "department", "title", "review_note"])
    write_review_queue(out / "course_catalog_review_queue.csv", course_candidates, ["decision", "existing_course_id", "code", "approved_name", "category", "department", "review_note"])
    relation_fields = ["ocr_course_name", "normalized_course_name", "ocr_teacher_name", "normalized_teacher_name", "evaluation_row_count", "independent_source_count", "inherited_evidence_count", "ambiguous_context_count", "average_ocr_confidence", "sheets", "source_examples", "likely_relation", "needs_review", "review_reason"]
    relation_candidates = aggregate_relations(rows)
    relation_path = out / "relation_candidates_review.csv"
    with relation_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=relation_fields); writer.writeheader(); writer.writerows(relation_candidates)
    write_review_queue(out / "relation_catalog_review_queue.csv", relation_candidates, ["decision", "approved_course_id", "approved_teacher_id", "review_note"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
