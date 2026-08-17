from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline import Token
import ocr_review_cells


class OcrReviewCellsTest(unittest.TestCase):
    def test_writes_cells_json_from_inventory_crops(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            image = root / "D6-cell.jpg"
            image.write_bytes(b"fake-image")
            inventory = root / "inventory.json"
            inventory.write_text(json.dumps({
                "cells": [{
                    "key": "体育课|6|D",
                    "routing": "pending_review",
                    "cell_image": str(image),
                }, {
                    "key": "体育课|6|H",
                    "routing": "not_applicable",
                    "cell_image": None,
                }],
            }), encoding="utf-8")
            out = root / "ocr"

            with patch.object(ocr_review_cells, "cuda_provider_evidence", return_value={"text_det": ["CUDAExecutionProvider"]}), \
                    patch.object(ocr_review_cells, "ocr_cuda", return_value=([Token("这门课很好", 0.99, [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])], "rapidocr 3.9.1 (CUDA)")):
                summary = ocr_review_cells.run_cell_ocr(inventory, out)

            self.assertEqual(summary["status"], "completed")
            self.assertEqual(summary["ocr_cells"], 1)
            payload = json.loads((out / "cells.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["体育课|6|D"]["text"], "这门课很好")
            self.assertEqual(payload["体育课|6|D"]["providers"]["text_det"], ["CUDAExecutionProvider"])


if __name__ == "__main__":
    unittest.main()
