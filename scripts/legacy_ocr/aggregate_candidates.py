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
    if re.search(r"[！？!?]", compact):
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


def write(path: Path, rows: list[dict[str, object]]) -> None:
    fields = ["original_name", "normalized_name", "occurrence_count", "independent_source_count", "average_ocr_confidence", "sheets", "source_examples", "likely_entity", "needs_review", "review_reason"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader(); writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="聚合 OCR 实体候选，仅供人工确认，不创建数据库记录")
    parser.add_argument("--preview", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    with Path(args.preview).open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    write(out / "teacher_candidates_review.csv", aggregate(rows, "ocr_teacher_name", person=True))
    write(out / "course_candidates_review.csv", aggregate(rows, "ocr_course_name", person=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
