import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from apply_alias_decisions import apply_aliases, approved_aliases, read_alias_decisions


class ApplyAliasDecisionTests(unittest.TestCase):
    def setUp(self):
        self.reference = {
            "courses": [{"id": 7, "code": "C7", "name": "形势与政策III"}],
            "teachers": [{"id": 9, "name": "教师", "department": "学院"}],
            "course_teachers": [{"course_id": 7, "teacher_id": 9}],
        }

    def test_reads_the_review_sheet_and_applies_one_explicit_alias(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "OCR课程别名核对"
        sheet.append(["说明"])
        sheet.append(["ocr_course_name", "candidate_code", "candidate_name", "decision"])
        sheet.append(["形势与政策", "C7", "形势与政策III", "approve"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review.xlsx"
            workbook.save(path)
            decisions = read_alias_decisions(path)
        aliases = approved_aliases(decisions, self.reference)
        rows, changed = apply_aliases(
            [{
                "ocr_course_name": "形势与政策",
                "matched_teacher_id": "9",
                "review_reason": "course_unmatched_or_ambiguous",
            }],
            aliases,
            self.reference,
        )
        self.assertEqual(changed, 1)
        self.assertEqual(rows[0]["matched_course_id"], "7")
        self.assertNotIn("teacher_not_linked_to_course", rows[0]["review_reason"])
        self.assertIn("course_alias_human_confirmed", rows[0]["review_reason"])

    def test_rejects_multiple_approved_targets_for_one_ocr_name(self):
        reference = {
            "courses": [
                {"id": 1, "code": "A", "name": "课程A"},
                {"id": 2, "code": "B", "name": "课程B"},
            ]
        }
        decisions = [
            {"ocr_course_name": "简称", "candidate_code": "A", "candidate_name": "课程A", "decision": "approve"},
            {"ocr_course_name": "简称", "candidate_code": "B", "candidate_name": "课程B", "decision": "approve"},
        ]
        with self.assertRaises(ValueError):
            approved_aliases(decisions, reference)

    def test_rejects_an_unknown_catalog_target(self):
        decisions = [{"ocr_course_name": "简称", "candidate_code": "X", "candidate_name": "不存在", "decision": "approve"}]
        with self.assertRaises(ValueError):
            approved_aliases(decisions, self.reference)


if __name__ == "__main__":
    unittest.main()
