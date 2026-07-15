import unittest

from aggregate_candidates import aggregate, assess_teacher, normalize_name


class CandidateAggregationTests(unittest.TestCase):
    def test_teacher_suffix_is_only_removed_for_matching(self):
        self.assertEqual(normalize_name(" 张三（副教授）老师 ", person=True), "张三")

    def test_comment_text_is_not_a_likely_teacher(self):
        likely, reason = assess_teacher("作业很少给分很好")
        self.assertFalse(likely)
        self.assertIn("contains_review_language", reason)

    def test_original_text_and_review_gate_are_preserved(self):
        rows = [
            {"ocr_teacher_name": "张三老师", "ocr_confidence": ".98", "source_file": "a.png", "source_row": "2", "sheet_name": "数学课"},
            {"ocr_teacher_name": "张三", "ocr_confidence": ".96", "source_file": "b.png", "source_row": "4", "sheet_name": "数学课"},
        ]
        result = aggregate(rows, "ocr_teacher_name", person=True)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["original_name"], "张三老师 | 张三")
        self.assertEqual(result[0]["independent_source_count"], 2)
        self.assertEqual(result[0]["needs_review"], "true")


if __name__ == "__main__":
    unittest.main()
