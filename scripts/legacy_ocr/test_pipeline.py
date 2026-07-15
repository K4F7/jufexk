import unittest
import json
import tempfile
from pathlib import Path

from pipeline import Candidate, PreviewRow, Token, cluster_rows, infer_comment_start, load_ocr_cache, mark_duplicates, normalize, similarity, unique_match


def token(text: str, x: float, y: float, confidence: float = .99) -> Token:
    return Token(text, confidence, [[x, y], [x + 20, y], [x + 20, y + 10], [x, y + 10]])


class PipelineTests(unittest.TestCase):
    def test_normalize_preserves_original_semantics(self):
        self.assertEqual(normalize(" 张 三（副教授）老师 ", person=True), "张三")
        self.assertEqual(normalize("ＡＢＣ，课程"), "abc课程")

    def test_similarity_and_unique_threshold(self):
        self.assertGreater(similarity("高等数学", "高等数学A"), .88)
        self.assertIsNone(unique_match([Candidate(1, "甲", .96, "fuzzy"), Candidate(2, "乙", .95, "fuzzy")], .95))
        self.assertEqual(unique_match([Candidate(1, "甲", 1, "exact")], .95).id, 1)

    def test_cluster_rows_uses_coordinates(self):
        rows = cluster_rows([token("B2", 100, 40), token("A1", 10, 10), token("B1", 100, 12), token("A2", 10, 42)])
        self.assertEqual([[x.text for x in row] for row in rows], [["A1", "B1"], ["A2", "B2"]])

    def test_duplicate_detection_is_global(self):
        rows = [
            PreviewRow("a.png", "主要课程", "2", "原文", matched_course_id=1, matched_teacher_id=2, comment="讲得很好"),
            PreviewRow("b.png", "主要课程", "1", "原文", matched_course_id=1, matched_teacher_id=2, comment="讲得 很好"),
        ]
        mark_duplicates(rows)
        self.assertTrue(rows[0].duplicate_group)
        self.assertEqual(rows[0].duplicate_group, rows[1].duplicate_group)
        self.assertTrue(all(row.needs_review for row in rows))

    def test_missing_comment_headers_are_recovered_from_number(self):
        header = ["课程", "老师", "", "", "学生评价3", "学生评价4"]
        self.assertEqual(infer_comment_start(header, 4), 2)

    def test_raw_ocr_cache_round_trip(self):
        page = {"source_file": "数学课_001.png", "tokens": [{"text": "老师", "confidence": .99, "box": [[1, 2], [3, 2], [3, 4], [1, 4]]}]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "raw.jsonl"
            path.write_text(json.dumps(page, ensure_ascii=False) + "\n", encoding="utf-8")
            cache = load_ocr_cache(path)
        self.assertEqual(cache["数学课_001.png"][0].text, "老师")
        self.assertEqual(cache["数学课_001.png"][0].confidence, .99)


if __name__ == "__main__":
    unittest.main()
