import tempfile
import unittest
from pathlib import Path

from build_review_workbook import (
    alias_review_rows,
    course_category,
    normalize_schedule,
    parse_catalog_snapshots,
    validate_import_samples,
)


def table(row: str) -> str:
    return f'<html><body><table><tbody id="sdTable_tbody">{row}</tbody></table></body></html>'


def cell(name: str, value: str) -> str:
    return f'<td name="{name}">{value}</td>'


class BuildReviewWorkbookTests(unittest.TestCase):
    def test_continuation_row_inherits_course_across_saved_pages(self):
        first = (
            '<tr id="tr0">'
            + cell("kc", "[C001]测试课程")
            + cell("xf", "2")
            + cell("cddw", "测试学院")
            + cell("skbjdm", "S01")
            + cell("rkjs", "张三")
            + cell("qsz", "1-8")
            + cell("sksj", "周一(1-2节)")
            + "</tr>"
        )
        second = (
            '<tr id="tr0">'
            + cell("skbjdm", "S01")
            + cell("rkjs", "张三")
            + cell("qsz", "1-8")
            + cell("sksj", "周三(3-4节)")
            + "</tr>"
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page1, page2 = root / "page1.html", root / "page2.html"
            page1.write_text(table(first), encoding="gb18030")
            page2.write_text(table(second), encoding="gb18030")
            raw, offerings = parse_catalog_snapshots([page1, page2])
        self.assertEqual(len(raw), 2)
        self.assertEqual(len(offerings), 1)
        self.assertIn("周一(1-2节)", offerings[0]["schedule"])
        self.assertIn("周三(3-4节)", offerings[0]["schedule"])

    def test_categories_and_import_constraints_match_api(self):
        self.assertEqual(course_category({"course_name": "大学体育", "kclb": "公共课"}), "pe")
        self.assertEqual(course_category({"course_name": "大学英语", "kclb": "2024公共课"}), "general")
        self.assertEqual(course_category({"course_name": "编译原理", "kclb": "专业必修课"}), "major")
        courses = [{"code": "C1", "name": "课程", "category": "major", "department": "学院"}]
        teachers = [{"name": "教师", "department": "学院"}]
        relations = [{"course_code": "C1", "course_name": "课程", "teacher_name": "教师", "teacher_department": "学院"}]
        offerings = [{**relations[0], "term": "2026-2027学年第一学期", "section": "01", "campus": "校区", "schedule": "周一", "status": "active"}]
        validate_import_samples(courses, teachers, relations, offerings)
        offerings[0]["status"] = "planned"
        with self.assertRaises(ValueError):
            validate_import_samples(courses, teachers, relations, offerings)

    def test_alias_candidates_are_ranked_but_not_approved(self):
        candidates = [{"original_name": "形势与政策", "likely_entity": "true"}]
        courses = [
            {"code": "A", "name": "形势与政策III"},
            {"code": "B", "name": "会计学"},
        ]
        rows = alias_review_rows(candidates, courses)
        self.assertEqual(rows[0]["candidate_code"], "A")
        self.assertEqual(rows[0]["decision"], "")

    def test_placeholder_schedules_are_readable_and_keep_a_quality_marker(self):
        schedule, quality = normalize_schedule("线性代数（MOOC）", "1-16 周三(节)")
        self.assertEqual(schedule, "线上课程，具体时间见教务系统")
        self.assertEqual(quality, "normalized_online_placeholder")
        schedule, quality = normalize_schedule("学科竞赛指导", "1-8 周三( 节)")
        self.assertEqual(schedule, "具体时间地点待定")
        self.assertEqual(quality, "normalized_flexible_placeholder")


if __name__ == "__main__":
    unittest.main()
