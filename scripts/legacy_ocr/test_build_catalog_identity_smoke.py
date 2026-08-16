import unittest

from build_catalog_identity_smoke import compare, select_smoke


class CatalogIdentitySmokeTests(unittest.TestCase):
    def test_relations_limit_candidates_from_the_known_side(self):
        courses = [{"courseCode": "C1", "currentName": "课程 A", "nameVariants": []}]
        teachers = [{"sourceTeacherLabel": "张三"}]
        relations = [{"courseCode": "C1", "sourceTeacherLabel": "张三"}]
        rows = [
            {"evaluation_id": "E1", "worksheet": "S", "source_row": 1, "source_column": "F", "course_name": "课程A", "teacher_name": "[unclear]", "production_reasons": ["teacher_unclear"]},
            {"evaluation_id": "E2", "worksheet": "S", "source_row": 2, "source_column": "F", "course_name": "[unclear]", "teacher_name": "张三", "production_reasons": ["course_unclear"]},
        ]
        result = compare(rows, courses, teachers, relations)
        self.assertEqual(result[0]["candidate_teacher_labels"], ["张三"])
        self.assertEqual(result[1]["candidate_course_codes"], ["C1"])
        self.assertTrue(all(row["decision"] == "manual_image_review_required" for row in result))

    def test_smoke_uses_distinct_rows_and_both_anchor_modes(self):
        rows = [
            {"comparison_mode": "teacher_anchor", "worksheet": "S", "source_row": 1},
            {"comparison_mode": "teacher_anchor", "worksheet": "S", "source_row": 1},
            {"comparison_mode": "course_anchor", "worksheet": "S", "source_row": 2},
        ]
        self.assertEqual(select_smoke(rows, 2), [rows[0], rows[2]])


if __name__ == "__main__":
    unittest.main()
