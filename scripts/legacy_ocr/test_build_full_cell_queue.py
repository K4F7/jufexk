import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import cv2

from build_full_cell_queue import (
    assign_row_numbers,
    capture_gap_records,
    column_ranges_from_edges,
    consensus_row_numbers,
    detect_selection,
    has_unrecognized_ink,
    horizontal_intervals,
    load_pages,
    review_columns,
    validate_bbox,
)


class FullCellQueueGeometryTests(unittest.TestCase):
    def test_review_columns_expand_declared_range(self):
        self.assertEqual(review_columns("H:O"), ["H", "I", "J", "K", "L", "M", "N", "O"])

    def test_assigns_intervals_around_selected_anchor(self):
        intervals = [(200, 250), (250, 300), (300, 350), (350, 400)]

        self.assertEqual(
            assign_row_numbers(intervals, selected=(300, 350), anchor=60),
            {58: (200, 250), 59: (250, 300), 60: (300, 350), 61: (350, 400)},
        )

    def test_rejects_selection_not_matching_a_grid_interval(self):
        with self.assertRaisesRegex(ValueError, "selected row interval"):
            assign_row_numbers([(200, 250)], selected=(300, 350), anchor=60)

    def test_pair_geometry_uses_nearest_supported_full_height_edge(self):
        self.assertEqual(
            column_ranges_from_edges((500, 300, 200, 50), ["G", "H"], [0, 100, 300, 500, 700]),
            {"G": (300, 500), "H": (500, 700)},
        )

    def test_pair_geometry_rejects_clipped_or_unsupported_selection(self):
        with self.assertRaisesRegex(ValueError, "clipped"):
            column_ranges_from_edges((140, 300, 760, 50), ["F", "G"], [101, 140, 900])
        with self.assertRaisesRegex(ValueError, "supported"):
            column_ranges_from_edges((500, 300, 200, 50), ["G", "H"], [100, 300, 700])

    def test_selection_ignores_viewport_scale_blue_decoration(self):
        frame = np.zeros((1200, 900, 3), dtype=np.uint8)
        cv2.rectangle(frame, (20, 200), (300, 1150), (255, 0, 0), 3)
        cv2.line(frame, (498, 180), (498, 1199), (255, 255, 255), 2)
        cv2.line(frame, (703, 180), (703, 1199), (255, 255, 255), 2)
        cv2.rectangle(frame, (500, 600), (700, 660), (255, 0, 0), 3)
        self.assertEqual(detect_selection(frame), (498, 598, 205, 65))

    def test_horizontal_intervals_ignore_text_edges_inside_selected_cell(self):
        frame = np.full((620, 900, 3), 255, dtype=np.uint8)
        for y in (200, 300, 400, 500):
            cv2.line(frame, (0, y), (899, y), (0, 0, 0), 2)
        # A long text-like stroke spans most of the selected cell but is not a
        # sheet grid boundary because it does not cross the full viewport.
        cv2.line(frame, (310, 350), (490, 350), (0, 0, 0), 2)

        self.assertEqual(
            horizontal_intervals(frame, (300, 300, 200, 100)),
            [(200, 300), (300, 400), (400, 500)],
        )

    def test_consensus_filters_edges_not_shared_across_column_views(self):
        rows = consensus_row_numbers(
            [
                [200, 250, 300, 333, 350, 400],
                [201, 251, 301, 351, 401],
                [199, 249, 299, 349, 399],
                [200, 250, 300, 350, 400],
            ],
            [325, 326, 324, 325],
            anchor=60,
        )
        self.assertEqual(rows, {58: (200, 250), 59: (250, 300), 60: (300, 350), 61: (350, 400)})

    def test_rejects_out_of_bounds_or_tiny_crop(self):
        self.assertEqual(validate_bbox((10, 20, 100, 80), (200, 120)), (10, 20, 100, 80))
        for bbox in ((-1, 20, 100, 80), (10, 20, 201, 80), (10, 20, 13, 80)):
            with self.subTest(bbox=bbox), self.assertRaisesRegex(ValueError, "bbox"):
                validate_bbox(bbox, (200, 120))

    def test_capture_gaps_are_explicit_and_recoverable(self):
        self.assertEqual(
            capture_gap_records(["主要课程|122|F"], "manifest-hash"),
            [{
                "key": "主要课程|122|F",
                "worksheet": "主要课程",
                "row": 122,
                "column": "F",
                "reason": "missing_review_capture",
                "recovery_condition": "capture the missing source row and review column in a new frozen manifest version",
                "manifest_sha256": "manifest-hash",
            }],
        )

    def test_duplicate_ocr_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "tokens.jsonl"
            row = {"source_file": "Sheet/a.png", "status": "completed", "tokens": []}
            path.write_text("\n".join((json.dumps(row), json.dumps(row))), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate OCR page"):
                load_pages(path)

    def test_suspected_miss_uses_dark_ink_not_white_or_watermark_pixels(self):
        self.assertFalse(has_unrecognized_ink(np.full((50, 100, 3), 255, dtype=np.uint8), []))
        self.assertFalse(has_unrecognized_ink(np.full((50, 100, 3), 225, dtype=np.uint8), []))
        ink = np.full((50, 100, 3), 255, dtype=np.uint8)
        ink[10:20, 10:20] = 0
        self.assertTrue(has_unrecognized_ink(ink, []))
        self.assertFalse(has_unrecognized_ink(ink, [{"text": "recognized"}]))
        dark = np.zeros((50, 100, 3), dtype=np.uint8)
        self.assertFalse(has_unrecognized_ink(dark, []))
        dark[10:20, 10:20] = 255
        self.assertTrue(has_unrecognized_ink(dark, []))

    def test_sub_glyph_height_spacer_is_not_routed_as_unrecognized_ink(self):
        spacer = np.zeros((6, 500, 3), dtype=np.uint8)
        spacer[:, 100:400] = 255
        self.assertFalse(has_unrecognized_ink(spacer, []))


if __name__ == "__main__":
    unittest.main()
