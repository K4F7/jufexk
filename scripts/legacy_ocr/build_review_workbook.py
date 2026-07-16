from __future__ import annotations

import argparse
import csv
from difflib import SequenceMatcher
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import pandas as pd


COURSE_FIELDS = ["code", "name", "category", "department", "credits", "description"]
TEACHER_FIELDS = ["name", "department", "title", "bio"]
RELATION_FIELDS = ["course_code", "course_name", "teacher_name", "teacher_department"]
OFFERING_FIELDS = [
    "course_code", "course_name", "teacher_name", "teacher_department",
    "term", "section", "campus", "schedule", "status",
]


def normalize_schedule(course_name: str, schedule: str) -> tuple[str, str]:
    missing_period = bool(re.search(r"周[一二三四五六日天]\(\s*节\)", schedule))
    if not missing_period:
        return schedule, "complete"
    if "MOOC" in course_name.upper() or "慕课" in course_name:
        return "线上课程，具体时间见教务系统", "normalized_online_placeholder"
    return "具体时间地点待定", "normalized_flexible_placeholder"


class CourseTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_body = False
        self.row: dict[str, str] | None = None
        self.cell_name = ""
        self.cell_parts: list[str] = []
        self.rows: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if tag == "tbody" and attr.get("id") == "sdTable_tbody":
            self.in_body = True
        elif self.in_body and tag == "tr" and re.fullmatch(r"tr\d+", attr.get("id", "")):
            self.row = {}
        elif self.row is not None and tag == "td":
            self.cell_name = attr.get("name", "") or ""
            self.cell_parts = []

    def handle_data(self, data: str) -> None:
        if self.row is not None and self.cell_name:
            self.cell_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self.row is not None and self.cell_name:
            self.row[self.cell_name] = " ".join("".join(self.cell_parts).split())
            self.cell_name = ""
            self.cell_parts = []
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        elif tag == "tbody" and self.in_body:
            self.in_body = False


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def truthy(value: str) -> bool:
    return value.strip().lower() == "true"


def parse_catalog_snapshots(paths: list[Path]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    current: dict[str, str] = {}
    expanded: list[dict[str, str]] = []
    for path in paths:
        parser = CourseTableParser()
        parser.feed(path.read_text(encoding="gb18030", errors="replace"))
        source = f"{path.parent.name}/{path.name}"
        for raw in parser.rows:
            if raw.get("kc"):
                current = raw.copy()
            else:
                current = {**current, **{key: value for key, value in raw.items() if value}}
            if not current.get("kc") or not current.get("skbjdm"):
                continue
            match = re.match(r"^\[([^]]+)](.*)$", current["kc"])
            expanded.append({
                **current,
                "course_code": match.group(1).strip() if match else "",
                "course_name": match.group(2).strip() if match else current["kc"].strip(),
                "source": source,
            })

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in expanded:
        key = (row["course_code"], row.get("skbjdm", ""))
        item = grouped.setdefault(key, {**row, "meetings": []})
        meeting = " ".join(filter(None, [row.get("qsz", ""), row.get("sksj", ""), row.get("skdd", "")]))
        if meeting and meeting not in item["meetings"]:
            item["meetings"].append(meeting)

    offerings: list[dict[str, str]] = []
    for item in grouped.values():
        raw_schedule = "; ".join(item["meetings"])
        schedule, data_quality = normalize_schedule(item["course_name"], raw_schedule)
        offerings.append({
            "course_code": item["course_code"],
            "course_name": item["course_name"],
            "teacher_name": item.get("rkjs", "").strip(),
            "teacher_department": item.get("cddw", "").strip(),
            "term": "2026-2027学年第一学期",
            "section": item.get("skbjdm", ""),
            "campus": item.get("xqmc", ""),
            "schedule": schedule,
            "status": "active",
            "source": item["source"],
            "confidence": "authoritative_snapshot",
            "source_schedule": raw_schedule,
            "data_quality": data_quality,
            "review_status": "待人工核对" if data_quality == "complete" else "待人工核对（已规范占位时间）",
        })
    return expanded, offerings


def parse_catalog_snapshot(path: Path) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    return parse_catalog_snapshots([path])


def unique_rows(rows: list[dict[str, str]], fields: list[str]) -> list[dict[str, str]]:
    seen: set[tuple[str, ...]] = set()
    result = []
    for row in rows:
        key = tuple(row.get(field, "").strip() for field in fields)
        if not any(key) or key in seen:
            continue
        seen.add(key)
        result.append({field: row.get(field, "").strip() for field in fields})
    return result


def course_category(row: dict[str, str]) -> str:
    text = f"{row.get('course_name', '')} {row.get('kclb', '')}"
    if "体育" in text:
        return "pe"
    if "公共课" in text or "通识" in text:
        return "general"
    return "major"


def write_import_csv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def validate_import_samples(
    courses: list[dict[str, str]],
    teachers: list[dict[str, str]],
    relations: list[dict[str, str]],
    offerings: list[dict[str, str]],
) -> None:
    course_keys = {(row["code"], row["name"]) for row in courses}
    teacher_keys = {(row["name"], row["department"]) for row in teachers}
    offering_keys = {(row["course_code"], row["term"], row["section"]) for row in offerings}
    if len(course_keys) != len(courses):
        raise ValueError("duplicate course code/name in import sample")
    if len(teacher_keys) != len(teachers):
        raise ValueError("duplicate teacher name/department in import sample")
    if len(offering_keys) != len(offerings):
        raise ValueError("duplicate course/term/section in offering import sample")
    for row in courses:
        if not row["name"] or row["category"] not in {"major", "pe", "general"}:
            raise ValueError(f"invalid course row: {row}")
        if len(row["code"]) > 40 or len(row["name"]) > 120 or len(row["department"]) > 80:
            raise ValueError(f"course field exceeds API limit: {row}")
    for row in teachers:
        if not row["name"] or len(row["name"]) > 120 or len(row["department"]) > 80:
            raise ValueError(f"invalid teacher row: {row}")
    for kind, rows in (("relation", relations), ("offering", offerings)):
        for row in rows:
            course_key = (row["course_code"], row["course_name"])
            teacher_key = (row["teacher_name"], row["teacher_department"])
            if course_key not in course_keys or teacher_key not in teacher_keys:
                raise ValueError(f"{kind} references a missing course or teacher: {row}")
            if kind == "offering":
                if not row["section"] or row["status"] not in {"active", "archived"}:
                    raise ValueError(f"invalid offering row: {row}")
                limits = {"term": 30, "section": 80, "campus": 80, "schedule": 160}
                if any(len(row[field]) > limit for field, limit in limits.items()):
                    raise ValueError(f"offering field exceeds API limit: {row}")


def write_reference_snapshot(
    path: Path,
    courses: list[dict[str, str]],
    teachers: list[dict[str, str]],
    relations: list[dict[str, str]],
    offerings: list[dict[str, str]],
) -> None:
    course_ids = {(row["code"], row["name"]): index for index, row in enumerate(courses, 1)}
    teacher_ids = {(row["name"], row["department"]): index for index, row in enumerate(teachers, 1)}
    offering_ids = {
        (row["course_code"], row["term"], row["section"]): index
        for index, row in enumerate(offerings, 1)
    }
    payload = {
        "source": "saved course catalog pages; local matching snapshot only",
        "courses": [{"id": course_ids[(row["code"], row["name"])], **row} for row in courses],
        "teachers": [{"id": teacher_ids[(row["name"], row["department"])], **row} for row in teachers],
        "course_teachers": [
            {
                "course_id": course_ids[(row["course_code"], row["course_name"])],
                "teacher_id": teacher_ids[(row["teacher_name"], row["teacher_department"])],
            }
            for row in relations
        ],
        "offerings": [
            {
                "id": offering_ids[(row["course_code"], row["term"], row["section"])],
                "course_id": course_ids[(row["course_code"], row["course_name"])],
                "term": row["term"],
                "section": row["section"],
                "campus": row["campus"],
                "schedule": row["schedule"],
                "status": row["status"],
            }
            for row in offerings
        ],
        "offering_teachers": [
            {
                "offering_id": offering_ids[(row["course_code"], row["term"], row["section"])],
                "teacher_id": teacher_ids[(row["teacher_name"], row["teacher_department"])],
            }
            for row in offerings
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def high_confidence_candidate(row: dict[str, str], kind: str) -> bool:
    name = row.get("original_name", "").strip()
    sources = int(row.get("independent_source_count") or 0)
    confidence = float(row.get("average_ocr_confidence") or 0)
    if not truthy(row.get("likely_entity", "")) or sources < 2 or confidence < 0.97:
        return False
    if kind == "course":
        malformed = (
            len(name) < 3
            or name.count("(") != name.count(")")
            or name.count("（") != name.count("）")
            or name in {"维性代数"}  # Stable OCR errors can still have very high confidence.
        )
        if malformed:
            return False
    return bool(name)


def alias_review_rows(
    candidates: list[dict[str, str]], courses: list[dict[str, str]]
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for candidate in candidates:
        if not truthy(candidate.get("likely_entity", "")):
            continue
        source = candidate["original_name"].strip()
        ranked = sorted(
            courses,
            key=lambda row: SequenceMatcher(None, source, row["name"]).ratio(),
            reverse=True,
        )[:3]
        for rank, course in enumerate(ranked, 1):
            output.append({
                "ocr_course_name": source,
                "candidate_rank": rank,
                "candidate_code": course["code"],
                "candidate_name": course["name"],
                "similarity": round(SequenceMatcher(None, source, course["name"]).ratio(), 4),
                "ocr_occurrences": candidate.get("occurrence_count", ""),
                "independent_sources": candidate.get("independent_source_count", ""),
                "average_ocr_confidence": candidate.get("average_ocr_confidence", ""),
                "decision": "",
                "review_note": "仅为字符串候选，不代表同一课程",
            })
    return output


def dataframe(rows: list[dict[str, Any]], columns: list[str] | None = None) -> pd.DataFrame:
    frame = pd.DataFrame(rows)
    if columns:
        for column in columns:
            if column not in frame:
                frame[column] = ""
        frame = frame[columns]
    return frame.fillna("")


def write_workbook(output: Path, sheets: list[tuple[str, pd.DataFrame]], summary: list[list[Any]]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output, engine="xlsxwriter") as writer:
        workbook = writer.book
        header = workbook.add_format({"bold": True, "font_color": "white", "bg_color": "#1F4E78", "border": 1, "text_wrap": True})
        note = workbook.add_format({"bg_color": "#FFF2CC", "text_wrap": True, "valign": "top"})
        trusted = workbook.add_format({"bg_color": "#E2F0D9"})
        pending = workbook.add_format({"bg_color": "#FFF2CC"})
        wrap = workbook.add_format({"text_wrap": True, "valign": "top"})

        intro = workbook.add_worksheet("说明")
        intro.hide_gridlines(2)
        intro.set_column("A:A", 24)
        intro.set_column("B:B", 88)
        for row_index, values in enumerate(summary):
            intro.write_row(row_index, 0, values, header if row_index == 0 else note)

        for sheet_name, frame in sheets:
            frame.to_excel(writer, sheet_name=sheet_name, index=False, startrow=1)
            worksheet = writer.sheets[sheet_name]
            worksheet.hide_gridlines(2)
            worksheet.freeze_panes(2, 0)
            worksheet.autofilter(1, 0, len(frame) + 1, max(0, len(frame.columns) - 1))
            sheet_note = f"记录数: {len(frame)}。黄色为待人工审核；绿色仅表示来源/规则较可信，不等于已批准导入。"
            worksheet.merge_range(0, 0, 0, max(0, len(frame.columns) - 1), sheet_note, note)
            for column_index, column in enumerate(frame.columns):
                worksheet.write(1, column_index, column, header)
                sample = [str(column)] + [str(value) for value in frame[column].head(200)]
                width = min(55, max(11, max(map(len, sample)) + 2))
                worksheet.set_column(column_index, column_index, width, wrap)
            if "confidence" in frame.columns:
                col = frame.columns.get_loc("confidence")
                worksheet.conditional_format(2, col, len(frame) + 1, col, {"type": "text", "criteria": "containing", "value": "authoritative", "format": trusted})
            if "review_status" in frame.columns:
                col = frame.columns.get_loc("review_status")
                worksheet.data_validation(2, col, max(2, len(frame) + 1), col, {"validate": "list", "source": ["待人工核对", "通过", "驳回", "跳过", "待人工核对（仅第1/3页）"]})
                worksheet.conditional_format(2, col, len(frame) + 1, col, {"type": "text", "criteria": "containing", "value": "待人工", "format": pending})
            if "decision" in frame.columns:
                col = frame.columns.get_loc("decision")
                worksheet.data_validation(2, col, max(2, len(frame) + 1), col, {"validate": "list", "source": ["approve", "reject", "skip"]})


def main() -> int:
    parser = argparse.ArgumentParser(description="生成课程目录与 OCR 人工校对工作簿")
    parser.add_argument("--ocr-output", default="scripts/legacy_ocr/output")
    parser.add_argument("--catalog-html", required=True, action="append")
    parser.add_argument("--out", default="scripts/legacy_ocr/output/course_overview_review.xlsx")
    parser.add_argument("--csv-dir", default="scripts/legacy_ocr/output/import_samples")
    parser.add_argument("--rematched-preview", default="scripts/legacy_ocr/output/rematched/legacy_reviews_preview.csv")
    args = parser.parse_args()

    ocr = Path(args.ocr_output)
    catalog_paths = [Path(value) for value in args.catalog_html]
    raw_catalog, offerings = parse_catalog_snapshots(catalog_paths)
    course_candidates = read_csv(ocr / "course_candidates_review.csv")
    teacher_candidates = read_csv(ocr / "teacher_candidates_review.csv")
    relation_candidates = read_csv(ocr / "relation_candidates_review.csv")
    review_queue = read_csv(ocr / "legacy_reviews_review_queue.csv")

    high_courses = [row for row in course_candidates if high_confidence_candidate(row, "course")]
    high_teachers = [row for row in teacher_candidates if high_confidence_candidate(row, "teacher")]
    for rows in (course_candidates, teacher_candidates, relation_candidates, review_queue):
        for row in rows:
            row.setdefault("review_status", "待人工核对")

    course_import = unique_rows([
        {"code": row["course_code"], "name": row["course_name"], "category": course_category(row), "department": row.get("cddw", ""), "credits": row.get("xf", ""), "description": ""}
        for row in raw_catalog
    ], COURSE_FIELDS)
    teacher_import = unique_rows([
        {"name": row["teacher_name"], "department": row["teacher_department"], "title": "", "bio": ""}
        for row in offerings if row["teacher_name"]
    ], TEACHER_FIELDS)
    relation_import = unique_rows([
        {"course_code": row["course_code"], "course_name": row["course_name"], "teacher_name": row["teacher_name"], "teacher_department": row["teacher_department"]}
        for row in offerings if row["teacher_name"]
    ], RELATION_FIELDS)
    offering_import = [
        {field: row.get(field, "") for field in OFFERING_FIELDS}
        for row in offerings
    ]
    validate_import_samples(course_import, teacher_import, relation_import, offering_import)
    alias_rows = alias_review_rows(course_candidates, course_import)
    rematched_path = Path(args.rematched_preview)
    rematched_reviews = read_csv(rematched_path) if rematched_path.exists() else []

    csv_dir = Path(args.csv_dir)
    write_import_csv(csv_dir / "01_courses.csv", course_import, COURSE_FIELDS)
    write_import_csv(csv_dir / "02_teachers.csv", teacher_import, TEACHER_FIELDS)
    write_import_csv(csv_dir / "03_relations.csv", relation_import, RELATION_FIELDS)
    write_import_csv(csv_dir / "04_offerings.csv", offering_import, OFFERING_FIELDS)
    write_import_csv(csv_dir / "ocr_high_confidence_courses_review.csv", high_courses, list(high_courses[0]) if high_courses else [])
    write_import_csv(csv_dir / "ocr_high_confidence_teachers_review.csv", high_teachers, list(high_teachers[0]) if high_teachers else [])
    write_reference_snapshot(csv_dir / "catalog_reference_sample.json", course_import, teacher_import, relation_import, offering_import)

    sheets = [
        ("教务课程样本", dataframe(course_import, COURSE_FIELDS)),
        ("教务教师样本", dataframe(teacher_import, TEACHER_FIELDS)),
        ("教务任课关系样本", dataframe(relation_import, RELATION_FIELDS)),
        ("教务开课班样本", dataframe(offerings, OFFERING_FIELDS + ["source_schedule", "data_quality", "source", "confidence", "review_status"])),
        ("OCR高可信课程", dataframe(high_courses)),
        ("OCR高可信教师", dataframe(high_teachers)),
        ("OCR课程别名核对", dataframe(alias_rows)),
        ("OCR重匹配评价", dataframe(rematched_reviews)),
        ("OCR全部课程候选", dataframe(course_candidates)),
        ("OCR全部教师候选", dataframe(teacher_candidates)),
        ("OCR任课关系候选", dataframe(relation_candidates)),
        ("历史评价校对", dataframe(review_queue)),
    ]
    summary = [
        ["项目", "说明"],
        ["用途", "先在本工作簿中人工核对，再将对应样本页另存为 CSV 交给后台预览/导入。"],
        ["教务系统快照", f"已合并 {len(catalog_paths)} 个分页快照，共解析 {len(raw_catalog)} 个时间行、聚合为 {len(offerings)} 个开课班。仅当三个分页均提供时才是本次查询的完整结果。"],
        ["OCR 高可信", f"规则为 likely_entity=true、至少 2 个独立截图来源、平均 OCR 置信度 >= 0.97；另排除明显截断的课程名。得到课程 {len(high_courses)} 条、教师 {len(high_teachers)} 条。仍需人工确认。"],
        ["OCR 重匹配", f"已载入 {len(rematched_reviews)} 条重新匹配评价；课程别名页仅给出字符串前三候选，必须人工决定。"],
        ["导入顺序", "教务课程样本 -> 教务教师样本 -> 教务任课关系样本 -> 教务开课班样本。每一步都先使用后台预览。"],
        ["审核要求", "不要把绿色理解为已批准；在 review_status 中明确选择“通过”后，才能进入正式导入文件。"],
        ["隐私", "历史评价页可能含 OCR 原文；工作簿位于 gitignored output 目录，不要提交到公开仓库。"],
    ]
    write_workbook(Path(args.out), sheets, summary)
    print(f"written {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
