import unittest

from aggregate_candidates import aggregate, aggregate_relations, assess_course, assess_teacher, normalize_name


class CandidateAggregationTests(unittest.TestCase):
    def test_teacher_suffix_is_only_removed_for_matching(self):
        self.assertEqual(normalize_name(" 张三（副教授）老师 ", person=True), "张三")

    def test_comment_text_is_not_a_likely_teacher(self):
        likely, reason = assess_teacher("作业很少给分很好")
        self.assertFalse(likely)
        self.assertIn("contains_review_language", reason)

    def test_sentence_is_not_a_likely_course(self):
        likely, reason = assess_course("一份ppt，并且讲解。疫情我们是看mooc。")
        self.assertFalse(likely)
        self.assertIn("contains_review_punctuation", reason)

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

    def test_relation_candidates_require_structured_fields_and_multiple_sources(self):
        rows = [
            {"ocr_course_name": "高等数学", "ocr_teacher_name": "张三", "comment": "李四也很好", "ocr_confidence": ".98", "source_file": "a.png", "source_row": "2", "sheet_name": "数学课", "inherited_from": "", "review_reason": ""},
            {"ocr_course_name": "高等数学", "ocr_teacher_name": "张三", "comment": "评价", "ocr_confidence": ".97", "source_file": "b.png", "source_row": "4", "sheet_name": "数学课", "inherited_from": "", "review_reason": ""},
        ]
        result = aggregate_relations(rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["ocr_teacher_name"], "张三")
        self.assertEqual(result[0]["independent_source_count"], 2)
        self.assertEqual(result[0]["likely_relation"], "true")
        self.assertNotIn("李四", result[0]["ocr_teacher_name"])


if __name__ == "__main__":
    unittest.main()
