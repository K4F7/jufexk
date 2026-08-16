import unittest

import cv2
import numpy as np

from build_full_context_queue import CONTEXT_FILE, consensus_context_right, context_gap_records, context_x_bounds, detect_context_selection, expected_context_keys


class FullContextQueueTests(unittest.TestCase):
    def test_expected_context_matrix_has_every_source_row(self):
        keys = expected_context_keys()
        self.assertEqual(len(keys), 1878)
        self.assertEqual(len(set(keys)), 1878)
        self.assertIn("主要课程|19", keys)
        self.assertIn("体育课|211", keys)

    def test_context_filename_contract(self):
        match = CONTEXT_FILE.search("主要课程_rows001-480_context-A-E_anchor185.png")
        self.assertIsNotNone(match)
        self.assertEqual(match.groups(), ("A", "E", "185"))

    def test_context_selection_allows_a_tall_merged_anchor(self):
        frame = np.zeros((1800, 800, 3), dtype=np.uint8)
        cv2.rectangle(frame, (100, 300), (500, 1500), (255, 0, 0), 3)
        self.assertEqual(detect_context_selection(frame), (98, 298, 405, 1205))

    def test_context_crop_stops_at_selected_endpoint_column(self):
        self.assertEqual(context_x_bounds(654, 2560), (100, 654))
        with self.assertRaisesRegex(ValueError, "horizontal bounds"):
            context_x_bounds(60, 2560)

    def test_context_endpoint_consensus_ignores_merged_header_and_outliers(self):
        values = [(2, 2269), (60, 504), (120, 504), (180, 504), (190, 314)]
        self.assertEqual(consensus_context_right(values), 504)

    def test_context_gap_is_explicit_and_recoverable(self):
        self.assertEqual(context_gap_records(["主要课程|191"], "manifest-hash"), [{
            "key": "主要课程|191", "worksheet": "主要课程", "row": 191,
            "status": "context_gap", "reason": "missing_context_capture",
            "recovery_condition": "capture the missing source row context in a new frozen manifest version",
            "manifest_sha256": "manifest-hash",
        }])


if __name__ == "__main__":
    unittest.main()
