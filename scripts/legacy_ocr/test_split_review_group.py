import unittest

from split_review_group import split_rows


class SplitReviewGroupTests(unittest.TestCase):
    def test_partitions_context_and_ocr_cells_without_loss(self):
        payload = {
            "worksheet": "sheet", "rows": [2, 5], "review_columns": [{"column": "F"}],
            "context_index": [{"row": row} for row in range(2, 6)],
            "ocr_cells": [{"row": 2, "column": "F"}, {"row": 4, "column": "F"}, {"row": 5, "column": "F"}],
            "capture_gaps": [{"key": "sheet|3|F", "row": 3, "column": "F"}],
        }
        parts = split_rows(payload, [(2, 3), (4, 5)])
        self.assertEqual([len(part["ocr_cells"]) for part in parts], [1, 2])
        self.assertEqual([len(part["context_index"]) for part in parts], [2, 2])
        self.assertEqual([[item["row"] for item in part["capture_gaps"]] for part in parts], [[3], []])

    def test_rejects_gap(self):
        payload = {"rows": [2, 5], "context_index": [], "ocr_cells": []}
        with self.assertRaisesRegex(ValueError, "contiguously"):
            split_rows(payload, [(2, 3), (5, 5)])


if __name__ == "__main__":
    unittest.main()
