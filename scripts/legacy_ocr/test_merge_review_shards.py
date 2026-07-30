import json
import tempfile
import unittest
from pathlib import Path

from merge_review_shards import merge


class MergeReviewShardsTests(unittest.TestCase):
    def test_merges_complete_contiguous_shards(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = {"worksheet": "S", "rows": [1, 2], "review_columns": [{"column": "F"}], "ocr_cells": [{"row": 1, "column": "F"}]}
            source_path = root / "input.json"; source_path.write_text(json.dumps(source))
            shards = []
            for index, row in enumerate((1, 2), 1):
                shard = root / str(index); shard.mkdir(); shards.append(shard)
                (shard / "matrix.json").write_text(json.dumps({"worksheet": "S", "rows": [row, row], "review_columns": [{"column": "F"}], "cells": [{"key": f"S|{row}|F", "conclusion": "agreed" if row == 1 else "not_applicable"}]}))
                (shard / "status.json").write_text(json.dumps({"status": "completed", "unresolved_cells": 0}))
                (shard / "validation.json").write_text(json.dumps({"valid": True, "references_valid": True}))
                (shard / "attempts.json").write_text(json.dumps([{"task_id": "batch-1", "side": "analysis_a", "model": "gpt-5.6-luna", "attempt": 1, "started_at": str(index), "status": "completed", "cell_keys": [f"S|{row}|F"], "input_sha256": "a" * 64}]))
            matrix, attempts, validation, status = merge(source_path, shards)
            self.assertEqual([cell["key"] for cell in matrix["cells"]], ["S|1|F", "S|2|F"])
            self.assertEqual([item["task_id"] for item in attempts], ["shard-01/attempt-000001/batch-1", "shard-02/attempt-000001/batch-1"])
            self.assertEqual([item["source_attempt_index"] for item in attempts], [1, 1])
            self.assertTrue(validation["valid"]); self.assertEqual(status["routed_cells"], 1)
            self.assertEqual(matrix["contract_version"], "ocr-first-cell-review-v2")

    def test_rejects_row_gap(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source_path = root / "input.json"
            source_path.write_text(json.dumps({"worksheet": "S", "rows": [1, 2], "review_columns": [{"column": "F"}], "ocr_cells": []}))
            shard = root / "shard"; shard.mkdir()
            (shard / "matrix.json").write_text(json.dumps({"worksheet": "S", "rows": [2, 2], "review_columns": [{"column": "F"}], "cells": [{"key": "S|2|F"}]}))
            (shard / "status.json").write_text(json.dumps({"status": "completed", "unresolved_cells": 0}))
            (shard / "validation.json").write_text(json.dumps({"valid": True, "references_valid": True}))
            (shard / "attempts.json").write_text("[]")
            with self.assertRaisesRegex(ValueError, "row ranges"):
                merge(source_path, [shard])

    def test_preserves_valid_completed_exceptions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source_path = root / "input.json"
            source_path.write_text(json.dumps({"worksheet": "S", "rows": [1, 1], "review_columns": [{"column": "F"}], "ocr_cells": [{"row": 1, "column": "F"}]}))
            shard = root / "shard"; shard.mkdir()
            (shard / "matrix.json").write_text(json.dumps({"worksheet": "S", "rows": [1, 1], "review_columns": [{"column": "F"}], "cells": [{"key": "S|1|F", "conclusion": "unresolved"}]}))
            (shard / "status.json").write_text(json.dumps({"status": "completed_with_exceptions", "unresolved_cells": 1}))
            (shard / "validation.json").write_text(json.dumps({"valid": True, "references_valid": True}))
            (shard / "attempts.json").write_text("[]")
            _, _, validation, status = merge(source_path, [shard])
            self.assertTrue(validation["valid"])
            self.assertEqual(status, {"status": "completed_with_exceptions", "expected_cells": 1, "routed_cells": 1, "unresolved_cells": 1, "capture_gap_cells": 0})

    def test_preserves_capture_blocked_cells_and_counts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source_path = root / "input.json"
            source_path.write_text(json.dumps({"worksheet": "S", "rows": [1, 1], "review_columns": [{"column": "F"}], "ocr_cells": [], "capture_gaps": [{"key": "S|1|F"}]}))
            shard = root / "shard"; shard.mkdir()
            (shard / "matrix.json").write_text(json.dumps({"worksheet": "S", "rows": [1, 1], "review_columns": [{"column": "F"}], "cells": [{"key": "S|1|F", "status": "capture_gap", "conclusion": "unresolved"}]}))
            (shard / "status.json").write_text(json.dumps({"status": "capture_blocked", "unresolved_cells": 1, "capture_gap_cells": 1}))
            (shard / "validation.json").write_text(json.dumps({"valid": True, "references_valid": True}))
            (shard / "attempts.json").write_text("[]")
            matrix, _, _, status = merge(source_path, [shard])
            self.assertEqual(matrix["cells"][0]["status"], "capture_gap")
            self.assertEqual(status["status"], "capture_blocked")
            self.assertEqual(status["capture_gap_cells"], 1)


if __name__ == "__main__":
    unittest.main()
