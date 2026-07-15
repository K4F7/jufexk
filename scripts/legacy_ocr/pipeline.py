from __future__ import annotations

import argparse
import bisect
import csv
import hashlib
import json
import re
import statistics
import time
import unicodedata
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

COURSE_THRESHOLD = 0.92
TEACHER_THRESHOLD = 0.95
OCR_THRESHOLD = 0.85
PREVIEW_FIELDS = [
    "source_file", "sheet_name", "source_row", "raw_ocr_text",
    "ocr_course_name", "matched_course_id", "matched_course_name", "course_match_score",
    "ocr_teacher_name", "matched_teacher_id", "matched_teacher_name", "teacher_match_score",
    "comment", "term", "matched_offering_id", "needs_review", "review_reason", "duplicate_group",
    "ocr_confidence", "ocr_tokens_json", "inherited_from",
]
HEADER_ALIASES = {
    "course": ("课程", "课程名称", "科目", "课名"),
    "teacher": ("教师", "老师", "任课教师", "授课教师"),
    "comment": ("评价", "学生评价", "评语", "评价内容", "评论"),
    "term": ("学期", "开课学期", "时间"),
    "code": ("课程号", "课程代码", "课号"),
}


@dataclass
class Token:
    text: str
    confidence: float
    box: list[list[float]]

    @property
    def cx(self) -> float:
        return sum(p[0] for p in self.box) / len(self.box)

    @property
    def cy(self) -> float:
        return sum(p[1] for p in self.box) / len(self.box)

    @property
    def height(self) -> float:
        return max(p[1] for p in self.box) - min(p[1] for p in self.box)


@dataclass
class Candidate:
    id: int
    name: str
    score: float
    method: str


@dataclass
class PreviewRow:
    source_file: str
    sheet_name: str
    source_row: str
    raw_ocr_text: str
    ocr_course_name: str = ""
    matched_course_id: int | str = ""
    matched_course_name: str = ""
    course_match_score: float | str = ""
    ocr_teacher_name: str = ""
    matched_teacher_id: int | str = ""
    matched_teacher_name: str = ""
    teacher_match_score: float | str = ""
    comment: str = ""
    term: str = ""
    matched_offering_id: int | str = ""
    needs_review: bool = True
    review_reason: str = ""
    duplicate_group: str = ""
    ocr_confidence: float = 0
    ocr_tokens_json: str = "[]"
    inherited_from: str = ""
    _course_candidates: list[Candidate] = field(default_factory=list, repr=False)
    _teacher_candidates: list[Candidate] = field(default_factory=list, repr=False)


def normalize(value: str, *, person: bool = False) -> str:
    value = unicodedata.normalize("NFKC", value or "").strip().lower()
    value = re.sub(r"[\s\n\r\t，。；：、·,.;:!?！？]", "", value)
    if person:
        value = re.sub(r"(?:老师|教师|教授|副教授|讲师)$", "", value)
        value = re.sub(r"[（(][^）)]{0,20}[）)]$", "", value)
    return value


def similarity(left: str, right: str, *, person: bool = False) -> float:
    a, b = normalize(left, person=person), normalize(right, person=person)
    return 0.0 if not a or not b else SequenceMatcher(None, a, b).ratio()


def cluster_rows(tokens: list[Token]) -> list[list[Token]]:
    if not tokens:
        return []
    threshold = max(8.0, statistics.median(max(t.height, 1) for t in tokens) * 0.55)
    rows: list[list[Token]] = []
    for token in sorted(tokens, key=lambda t: (t.cy, t.cx)):
        target = next((r for r in rows if abs(statistics.mean(x.cy for x in r) - token.cy) <= threshold), None)
        (target if target is not None else rows.append([]) or rows[-1]).append(token)
    return [sorted(row, key=lambda t: t.cx) for row in rows]


def identify_columns(header: list[Token]) -> dict[str, float]:
    found: dict[str, float] = {}
    for token in header:
        text = normalize(token.text)
        for field_name, aliases in HEADER_ALIASES.items():
            if any(normalize(alias) in text for alias in aliases):
                found[field_name] = token.cx
    return found


def cells_for_row(tokens: list[Token], columns: dict[str, float]) -> dict[str, list[Token]]:
    cells = {name: [] for name in columns}
    anchors = sorted(columns.items(), key=lambda item: item[1])
    for token in tokens:
        name = min(anchors, key=lambda item: abs(item[1] - token.cx))[0]
        cells[name].append(token)
    return cells


def cell_text(tokens: Iterable[Token]) -> str:
    return " ".join(t.text.strip() for t in tokens if t.text.strip()).strip()


def _line_positions(mask: Any, axis: int, minimum: int) -> list[int]:
    import numpy as np
    projection = np.count_nonzero(mask, axis=axis)
    indexes = np.where(projection >= minimum)[0].tolist()
    groups: list[list[int]] = []
    for value in indexes:
        if not groups or value > groups[-1][-1] + 1:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [round(statistics.mean(group)) for group in groups]


def detect_grid(image: Path) -> tuple[list[int], list[int]]:
    import cv2
    import numpy as np
    # cv2.imread cannot reliably open non-ASCII Windows paths.
    frame = cv2.imdecode(np.fromfile(image, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if frame is None:
        return [], []
    height, width = frame.shape
    _, binary = cv2.threshold(frame, 210, 255, cv2.THRESH_BINARY_INV)
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(40, height // 12))))
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(50, width // 30), 1)))
    xs = _line_positions(vertical, 0, max(20, height // 5))
    ys = _line_positions(horizontal, 1, max(50, width // 10))
    if not xs or xs[0] > 3: xs.insert(0, 0)
    if xs[-1] < width - 3: xs.append(width)
    if not ys or ys[0] > 3: ys.insert(0, 0)
    if ys[-1] < height - 3: ys.append(height)
    return xs, ys


def apply_matches(preview: PreviewRow, reference: dict[str, list[dict[str, Any]]], inherited: list[str]) -> None:
    preview._course_candidates = candidates(preview.ocr_course_name, reference["courses"])
    course = unique_match(preview._course_candidates, COURSE_THRESHOLD)
    teacher_pool = reference["teachers"]
    if course:
        linked_ids = {int(x["teacher_id"]) for x in reference["course_teachers"] if int(x["course_id"]) == course.id}
        linked = [teacher for teacher in teacher_pool if int(teacher["id"]) in linked_ids]
        if linked: teacher_pool = linked
    preview._teacher_candidates = candidates(preview.ocr_teacher_name, teacher_pool, person=True)
    teacher = unique_match(preview._teacher_candidates, TEACHER_THRESHOLD)
    reasons: list[str] = []
    if preview.ocr_confidence < OCR_THRESHOLD: reasons.append("low_ocr_confidence")
    if inherited: reasons.append("inherited_" + "_and_".join(inherited))
    if not course: reasons.append("course_unmatched_or_ambiguous")
    if not teacher: reasons.append("teacher_unmatched_or_ambiguous")
    if course:
        preview.matched_course_id, preview.matched_course_name, preview.course_match_score = course.id, course.name, course.score
    if teacher:
        preview.matched_teacher_id, preview.matched_teacher_name, preview.teacher_match_score = teacher.id, teacher.name, teacher.score
    if course and teacher:
        linked = any(int(x["course_id"]) == course.id and int(x["teacher_id"]) == teacher.id for x in reference["course_teachers"])
        if not linked: reasons.append("teacher_not_linked_to_course")
        offering_ids = {int(x["offering_id"]) for x in reference["offering_teachers"] if int(x["teacher_id"]) == teacher.id}
        matches = [x for x in reference["offerings"] if preview.term and int(x["course_id"]) == course.id and int(x["id"]) in offering_ids and normalize(str(x.get("term", ""))) == normalize(preview.term)]
        if len(matches) == 1: preview.matched_offering_id = int(matches[0]["id"])
        else: reasons.append("offering_unmatched_or_ambiguous" if preview.term else "term_or_offering_unconfirmed")
    preview.needs_review = bool(reasons)
    preview.review_reason = ";".join(reasons)


def grid_preview_rows(tokens: list[Token], source: Path, sheet: str, reference: dict[str, list[dict[str, Any]]]) -> tuple[list[PreviewRow], list[str]]:
    xs, ys = detect_grid(source)
    if len(xs) < 5 or len(ys) < 3:
        return [], ["未检测到稳定表格网格"]
    cells: dict[tuple[int, int], list[Token]] = defaultdict(list)
    for token in tokens:
        col = bisect.bisect_right(xs, token.cx) - 1
        row = bisect.bisect_right(ys, token.cy) - 1
        if 0 <= col < len(xs) - 1 and 0 <= row < len(ys) - 1:
            cells[(row, col)].append(token)
    header_row = -1; course_col = -1; teacher_col = -1; comment_cols: list[int] = []
    for row in range(min(4, len(ys) - 1)):
        texts = {col: cell_text(cells.get((row, col), [])) for col in range(len(xs) - 1)}
        comments = [col for col, text_value in texts.items() if "学生评" in normalize(text_value)]
        course = next((col for col, text_value in texts.items() if normalize(text_value) in {"课程", "课程名称", "课名"}), -1)
        teacher = next((col for col, text_value in texts.items() if any(word in normalize(text_value) for word in ("老师", "教师", "中文名"))), -1)
        if comments and course >= 0 and teacher >= 0:
            header_row, course_col, teacher_col, comment_cols = row, course, teacher, comments
            break
    if header_row < 0:
        return [], ["网格存在，但无法可靠定位课程、教师和学生评价表头"]
    previous = {"course": "", "teacher": ""}; previous_row = {"course": "", "teacher": ""}; output: list[PreviewRow] = []
    for row in range(header_row + 1, len(ys) - 1):
        course_text = cell_text(cells.get((row, course_col), [])); teacher_text = cell_text(cells.get((row, teacher_col), []))
        inherited: list[str] = []
        values = {"course": course_text, "teacher": teacher_text}
        for name in ("course", "teacher"):
            if values[name]: previous[name], previous_row[name] = values[name], str(row + 1)
            elif previous[name]: values[name] = previous[name]; inherited.append(name)
        for ordinal, col in enumerate(comment_cols, start=1):
            comment_tokens = cells.get((row, col), []); comment = cell_text(comment_tokens)
            if not comment: continue
            confidence = statistics.mean(t.confidence for t in comment_tokens)
            preview = PreviewRow(source.name, sheet, f"{row + 1}:评价{ordinal}", cell_text(cells.get((row, course_col), []) + cells.get((row, teacher_col), []) + comment_tokens), ocr_course_name=values["course"], ocr_teacher_name=values["teacher"], comment=comment, ocr_confidence=round(confidence, 4), ocr_tokens_json=json.dumps([asdict(token) for token in comment_tokens], ensure_ascii=False), inherited_from=";".join(f"{name}:{previous_row[name]}" for name in inherited))
            apply_matches(preview, reference, inherited)
            output.append(preview)
    return output, []


COURSE_HINTS = ("管理", "数学", "英语", "概论", "基础", "原理", "经济", "金融", "统计", "会计", "法律", "体育", "鉴赏", "理论", "实践", "mooc", "MOOC")


def looks_like_course(value: str) -> bool:
    compact = normalize(value)
    return len(compact) >= 4 and any(normalize(hint) in compact for hint in COURSE_HINTS)


def infer_comment_start(header: list[str], first_explicit: int) -> int:
    number_match = re.search(r"学生评价?(\d+)", header[first_explicit])
    first_number = int(number_match.group(1)) if number_match else 1
    return max(0, first_explicit - first_number + 1)


def tokens_in_bbox(tokens: list[Token], bbox: Any) -> list[Token]:
    return [token for token in tokens if float(bbox.x1) <= token.cx <= float(bbox.x2) and float(bbox.y1) <= token.cy <= float(bbox.y2)]


def img2table_preview_rows(tokens: list[Token], source: Path, sheet: str, reference: dict[str, list[dict[str, Any]]]) -> tuple[list[PreviewRow], list[str]]:
    try:
        from img2table.document import Image
        from img2table.ocr import RapidOCR as TableOCR
        tables = Image(src=source).extract_tables(ocr=TableOCR(), implicit_rows=True, implicit_columns=True, borderless_tables=False, min_confidence=40)
    except Exception as exc:
        return [], [f"img2table失败: {exc}"]
    if not tables:
        return [], ["img2table未恢复出表格"]
    output: list[PreviewRow] = []
    for table_index, table in enumerate(tables, start=1):
        rows = list(table.content.values())
        if len(rows) < 2: continue
        header = [normalize(str(cell.value or "")) for cell in rows[0]]
        explicit_comments = [index for index, text_value in enumerate(header) if "学生评" in text_value]
        if not explicit_comments: continue
        first_explicit = min(explicit_comments)
        comment_start = infer_comment_start(header, first_explicit)
        teacher_col = next((index for index, text_value in enumerate(header) if "老师" in text_value or "教师" in text_value or "中文名" in text_value), comment_start - 1)
        course_col = next((index for index, text_value in enumerate(header) if text_value in {"课程", "课程名称", "课名"}), -1)
        entity_col = teacher_col if teacher_col >= 0 else max(0, comment_start - 1)
        current_course = ""; current_teacher = ""; course_row = ""; teacher_row = ""
        for row_index, row in enumerate(rows[1:], start=2):
            entity = str(row[entity_col].value or "").strip() if entity_col < len(row) else ""
            explicit_course = str(row[course_col].value or "").strip() if 0 <= course_col < len(row) else ""
            if explicit_course:
                current_course, course_row = explicit_course, str(row_index)
            if entity:
                if looks_like_course(entity) and not explicit_course:
                    current_course, course_row, current_teacher = entity, str(row_index), ""
                else:
                    current_teacher, teacher_row = entity, str(row_index)
            inherited = []
            if current_course and not explicit_course: inherited.append("course")
            if current_teacher and not entity: inherited.append("teacher")
            for col in range(comment_start, len(row)):
                value = str(row[col].value or "").strip()
                if not value: continue
                cell_tokens = tokens_in_bbox(tokens, row[col].bbox)
                confidence = statistics.mean(token.confidence for token in cell_tokens) if cell_tokens else 0
                preview = PreviewRow(source.name, sheet, f"T{table_index}R{row_index}C{col + 1}", " | ".join(filter(None, [explicit_course, entity, value])), ocr_course_name=current_course, ocr_teacher_name=current_teacher, comment=value, ocr_confidence=round(confidence, 4), ocr_tokens_json=json.dumps([asdict(token) for token in cell_tokens], ensure_ascii=False), inherited_from=";".join(filter(None, [f"course:{course_row}" if current_course and not explicit_course else "", f"teacher:{teacher_row}" if current_teacher and not entity else ""])))
                apply_matches(preview, reference, inherited)
                if not current_course:
                    preview.needs_review = True; preview.review_reason = ";".join(filter(None, [preview.review_reason, "course_context_missing_at_screenshot_start"]))
                if not current_teacher:
                    preview.needs_review = True; preview.review_reason = ";".join(filter(None, [preview.review_reason, "teacher_unresolved_section_row"]))
                output.append(preview)
    return (output, []) if output else ([], ["img2table表格中未找到可拆分的学生评价"])


def candidates(value: str, records: list[dict[str, Any]], *, person: bool = False, code: str = "") -> list[Candidate]:
    scored: list[Candidate] = []
    for record in records:
        if code and normalize(code) == normalize(str(record.get("code", ""))):
            score, method = 1.0, "code_exact"
        elif normalize(value, person=person) == normalize(str(record["name"]), person=person):
            score, method = 1.0, "normalized_exact"
        else:
            score, method = similarity(value, str(record["name"]), person=person), "fuzzy"
        if score >= 0.65:
            scored.append(Candidate(int(record["id"]), str(record["name"]), round(score, 4), method))
    return sorted(scored, key=lambda item: (-item.score, item.id))[:5]


def unique_match(items: list[Candidate], threshold: float) -> Candidate | None:
    if not items or items[0].score < threshold:
        return None
    if len(items) > 1 and items[1].score >= threshold and abs(items[0].score - items[1].score) < 0.03:
        return None
    return items[0]


def parse_ocr_result(result: Any) -> list[Token]:
    rows = result[0] if isinstance(result, tuple) else result
    return [Token(str(item[1]), float(item[2]), [[float(x), float(y)] for x, y in item[0]]) for item in (rows or [])]


def run_ocr(image: Path, use_cuda: bool) -> tuple[list[Token], str]:
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as exc:
        raise RuntimeError("RapidOCR 未安装；先按 README 创建 Python 3.12 环境") from exc
    kwargs = {"det_use_cuda": use_cuda, "cls_use_cuda": use_cuda, "rec_use_cuda": use_cuda}
    engine = RapidOCR(**kwargs)
    return parse_ocr_result(engine(str(image))), f"rapidocr-onnxruntime 1.4.4 ({'CUDA' if use_cuda else 'CPU'})"


def load_reference(path: Path) -> dict[str, list[dict[str, Any]]]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    required = {"courses", "teachers", "course_teachers", "offerings", "offering_teachers"}
    missing = sorted(required - data.keys())
    if missing:
        raise ValueError(f"数据库快照缺少: {', '.join(missing)}")
    return data


def match_rows(tokens: list[Token], source: Path, sheet: str, reference: dict[str, list[dict[str, Any]]]) -> tuple[list[PreviewRow], list[str]]:
    grid = cluster_rows(tokens)
    errors: list[str] = []
    header_index, columns = -1, {}
    for index, row in enumerate(grid[:12]):
        candidate_columns = identify_columns(row)
        if {"course", "teacher", "comment"}.issubset(candidate_columns):
            header_index, columns = index, candidate_columns
            break
    if header_index < 0:
        return [], ["未找到同时包含课程、教师、评价的表头"]
    previous = {"course": "", "teacher": ""}
    previous_row = {"course": "", "teacher": ""}
    output: list[PreviewRow] = []
    for grid_index, row_tokens in enumerate(grid[header_index + 1 :], start=header_index + 2):
        cells = cells_for_row(row_tokens, columns)
        values = {name: cell_text(cell) for name, cell in cells.items()}
        if not values.get("comment"):
            continue
        inherited: list[str] = []
        for name in ("course", "teacher"):
            if values.get(name):
                previous[name] = values[name]
                previous_row[name] = str(grid_index)
            elif previous[name]:
                values[name] = previous[name]
                inherited.append(name)
        confidence = statistics.mean(t.confidence for t in row_tokens)
        preview = PreviewRow(
            source.name, sheet, str(grid_index), cell_text(row_tokens),
            ocr_course_name=values.get("course", ""), ocr_teacher_name=values.get("teacher", ""),
            comment=values.get("comment", ""), term=values.get("term", ""),
            ocr_confidence=round(confidence, 4),
            ocr_tokens_json=json.dumps([asdict(token) for token in row_tokens], ensure_ascii=False),
            inherited_from=";".join(f"{name}:{previous_row[name]}" for name in inherited),
        )
        preview._course_candidates = candidates(preview.ocr_course_name, reference["courses"], code=values.get("code", ""))
        course = unique_match(preview._course_candidates, COURSE_THRESHOLD)
        teacher_pool = reference["teachers"]
        if course:
            linked_ids = {int(x["teacher_id"]) for x in reference["course_teachers"] if int(x["course_id"]) == course.id}
            linked = [teacher for teacher in teacher_pool if int(teacher["id"]) in linked_ids]
            if linked:
                teacher_pool = linked
        preview._teacher_candidates = candidates(preview.ocr_teacher_name, teacher_pool, person=True)
        teacher = unique_match(preview._teacher_candidates, TEACHER_THRESHOLD)
        reasons: list[str] = []
        if confidence < OCR_THRESHOLD: reasons.append("low_ocr_confidence")
        if inherited: reasons.append("inherited_" + "_and_".join(inherited))
        if not course: reasons.append("course_unmatched_or_ambiguous")
        if not teacher: reasons.append("teacher_unmatched_or_ambiguous")
        if course:
            preview.matched_course_id, preview.matched_course_name, preview.course_match_score = course.id, course.name, course.score
        if teacher:
            preview.matched_teacher_id, preview.matched_teacher_name, preview.teacher_match_score = teacher.id, teacher.name, teacher.score
        if course and teacher:
            linked = any(int(x["course_id"]) == course.id and int(x["teacher_id"]) == teacher.id for x in reference["course_teachers"])
            if not linked: reasons.append("teacher_not_linked_to_course")
            matching_offerings = []
            if preview.term:
                offering_ids = {int(x["offering_id"]) for x in reference["offering_teachers"] if int(x["teacher_id"]) == teacher.id}
                matching_offerings = [x for x in reference["offerings"] if int(x["course_id"]) == course.id and int(x["id"]) in offering_ids and normalize(str(x.get("term", ""))) == normalize(preview.term)]
            if len(matching_offerings) == 1:
                preview.matched_offering_id = int(matching_offerings[0]["id"])
            elif preview.term:
                reasons.append("offering_unmatched_or_ambiguous")
            else:
                reasons.append("term_or_offering_unconfirmed")
        preview.needs_review = bool(reasons)
        preview.review_reason = ";".join(reasons)
        output.append(preview)
    return output, errors


def mark_duplicates(output: list[PreviewRow]) -> None:
    groups: dict[str, list[PreviewRow]] = defaultdict(list)
    for row in output:
        if row.matched_course_id and row.matched_teacher_id and normalize(row.comment):
            key = f"{row.matched_course_id}|{row.matched_teacher_id}|{normalize(row.comment)}"
            groups[hashlib.sha256(key.encode()).hexdigest()[:12]].append(row)
    for group, rows in groups.items():
        if len(rows) > 1:
            for row in rows:
                row.duplicate_group = group
                row.needs_review = True
                row.review_reason = ";".join(filter(None, [row.review_reason, "suspected_duplicate"]))


def write_csv(path: Path, rows: Iterable[dict[str, Any]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader(); writer.writerows(rows)


def serialise(row: PreviewRow) -> dict[str, Any]:
    return {name: getattr(row, name) for name in PREVIEW_FIELDS}


def run(args: argparse.Namespace) -> int:
    started = time.time(); out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    reference = load_reference(Path(args.reference)); images = sorted(Path(args.input).glob("*.png"))
    previews: list[PreviewRow] = []; errors: list[dict[str, str]] = []; warnings: list[dict[str, str]] = []; box_count = 0; confidences: list[float] = []; model = ""; raw_pages: list[dict[str, Any]] = []
    for image in images:
        sheet = image.stem.rsplit("_", 1)[0]
        try:
            tokens, model = run_ocr(image, args.cuda)
            box_count += len(tokens); confidences.extend(token.confidence for token in tokens)
            raw_pages.append({"source_file": image.name, "sheet_name": sheet, "tokens": [asdict(token) for token in tokens]})
            rows, row_errors = img2table_preview_rows(tokens, image, sheet, reference)
            if not rows:
                grid_rows, grid_errors = grid_preview_rows(tokens, image, sheet, reference)
                rows = grid_rows
                row_errors.extend(grid_errors)
            if not rows:
                fallback_rows, fallback_errors = match_rows(tokens, image, sheet, reference)
                rows = fallback_rows
                row_errors.extend(fallback_errors)
            previews.extend(rows)
            errors.extend({"source_file": image.name, "message": message} for message in row_errors)
        except Exception as exc:
            errors.append({"source_file": image.name, "message": str(exc)})
    detected_review_count = len(previews)
    if len(previews) > args.max_rows:
        warnings.append({"source_file": "*", "message": f"试验样本限制为 {args.max_rows} 行；检测到 {len(previews)} 行，其余记录留待批量阶段"})
        previews = previews[: args.max_rows]
    mark_duplicates(previews)
    with (out / "raw_ocr_tokens.jsonl").open("w", encoding="utf-8") as handle:
        for page in raw_pages: handle.write(json.dumps(page, ensure_ascii=False) + "\n")
    records = [serialise(row) for row in previews]
    write_csv(out / "legacy_reviews_preview.csv", records, PREVIEW_FIELDS)
    write_csv(out / "unmatched_courses.csv", [r for r in records if not r["matched_course_id"]], PREVIEW_FIELDS)
    write_csv(out / "unmatched_teachers.csv", [r for r in records if not r["matched_teacher_id"]], PREVIEW_FIELDS)
    ambiguous = []
    for row in previews:
        course_tie = len(row._course_candidates) > 1 and abs(row._course_candidates[0].score - row._course_candidates[1].score) < .03
        teacher_tie = len(row._teacher_candidates) > 1 and abs(row._teacher_candidates[0].score - row._teacher_candidates[1].score) < .03
        if course_tie or teacher_tie:
            ambiguous.append({**serialise(row), "course_candidates": json.dumps([asdict(x) for x in row._course_candidates], ensure_ascii=False), "teacher_candidates": json.dumps([asdict(x) for x in row._teacher_candidates], ensure_ascii=False)})
    write_csv(out / "ambiguous_matches.csv", ambiguous, PREVIEW_FIELDS + ["course_candidates", "teacher_candidates"])
    write_csv(out / "duplicates.csv", [r for r in records if r["duplicate_group"]], PREVIEW_FIELDS)
    per_sheet: dict[str, dict[str, int]] = defaultdict(lambda: {"reviews": 0, "matched": 0, "needs_review": 0})
    for row in previews:
        stat = per_sheet[row.sheet_name]; stat["reviews"] += 1; stat["matched"] += int(not row.needs_review); stat["needs_review"] += int(row.needs_review)
    report = {"screenshot_count": len(images), "ocr_box_count": box_count, "detected_review_count": detected_review_count, "raw_review_count": len(previews), "matched_count": sum(bool(r.matched_course_id and r.matched_teacher_id) for r in previews), "confirmed_without_review_count": sum(not r.needs_review for r in previews), "needs_review_count": sum(r.needs_review for r in previews), "unmatched_course_count": sum(not r.matched_course_id for r in previews), "unmatched_teacher_count": sum(not r.matched_teacher_id for r in previews), "average_ocr_confidence": round(statistics.mean(confidences), 4) if confidences else 0, "sheets": per_sheet, "ocr_model": model, "processing_seconds": round(time.time() - started, 3), "errors": errors, "warnings": warnings, "thresholds": {"course": COURSE_THRESHOLD, "teacher": TEACHER_THRESHOLD, "ocr": OCR_THRESHOLD}}
    (out / "ocr_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if not errors else 2


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="腾讯表格历史评价 OCR 预览（绝不写 D1）")
    p.add_argument("--input", required=True, help="按 工作表_页码.png 命名的截图目录")
    p.add_argument("--reference", required=True, help="D1 只读快照 JSON")
    p.add_argument("--out", required=True); p.add_argument("--max-rows", type=int, default=30)
    p.add_argument("--cuda", action="store_true", help="仅在 CUDAExecutionProvider 已验证后启用")
    return p


if __name__ == "__main__":
    raise SystemExit(run(parser().parse_args()))
