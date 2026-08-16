import unittest

from build_context_review_groups import build_group


class BuildContextReviewGroupsTests(unittest.TestCase):
    def test_routes_each_unique_review_row_once_with_provenance(self):
        source = {"rows": [19, 21], "ocr_cells": [{"row": 19}, {"row": 19}, {"row": 21}]}
        contexts = {
            ("主要课程", 19): {"crop": "19.png", "text": "x", "tokens": []},
            ("主要课程", 20): {"crop": "20.png", "text": "context only", "tokens": []},
            ("主要课程", 21): {"crop": "21.png", "text": "y", "tokens": []},
        }
        group = build_group("主要课程", source, contexts)
        self.assertEqual([item["row"] for item in group["ocr_cells"]], [19, 20, 21])
        self.assertEqual(group["review_columns"][0]["display_header"], "course source column A, crop-relative x=0:212; teacher source column(s) E, crop-relative x=618:862; ignore all other pixels")
        self.assertEqual(group["ocr_cells"][0]["crop"], "19.png")

    def test_rejects_missing_context_crop(self):
        with self.assertRaisesRegex(ValueError, "missing context crops"):
            build_group("数学课", {"rows": [8, 8], "ocr_cells": [{"row": 8}]}, {})

    def test_mooc_teacher_is_before_course_introduction(self):
        contexts = {("MOOC", 8): {"crop": "8.png", "text": "intro", "tokens": []}}
        group = build_group("MOOC", {"rows": [8, 8], "ocr_cells": [{"row": 8}]}, contexts)
        self.assertEqual(group["review_columns"][0]["display_header"], "course source column A, crop-relative x=0:134; teacher source column(s) E, crop-relative x=134:184; ignore all other pixels")

    def test_routes_missing_context_as_capture_gap_not_blank_or_ocr(self):
        contexts = {("数学课", 8): {
            "status": "context_gap", "reason": "missing_context_capture",
            "recovery_condition": "capture in a new manifest", "manifest_sha256": "manifest-hash",
        }}
        group = build_group("数学课", {"rows": [8, 8], "ocr_cells": [{"row": 8}]}, contexts)
        self.assertEqual(group["ocr_cells"], [])
        self.assertEqual(group["context_index"], [{"row": 8, "course": "[missing capture]", "teacher": "[missing capture]"}])
        self.assertEqual(group["capture_gaps"][0]["key"], "数学课|8|CTX")

    def test_preserves_context_gap_even_when_the_row_has_no_review_or_ocr_evidence(self):
        contexts = {("体育课", 25): {
            "status": "context_gap", "reason": "missing_context_capture",
            "recovery_condition": "capture in a new manifest", "manifest_sha256": "manifest-hash",
        }}
        group = build_group("体育课", {"rows": [24, 25], "ocr_cells": []}, contexts)
        self.assertEqual(group["ocr_cells"], [])
        self.assertEqual([item["row"] for item in group["capture_gaps"]], [25])
        self.assertEqual(group["context_index"][1]["course"], "[missing capture]")


if __name__ == "__main__":
    unittest.main()
