import tempfile
import unittest
from pathlib import Path

from review_uncertain_geometry import classify_geometry, clipping_directions, resolve_manifest_path
from compile_review_uncertain_rerun import final_classification


class ReviewUncertainGeometryTests(unittest.TestCase):
    def test_non_geometry_uncertainty_is_already_complete(self):
        directions = clipping_directions(["末字字形可能不清"])
        classification, new_bbox, _, _ = classify_geometry([10, 20, 90, 80], (100, 100), directions, 8, 4)
        self.assertEqual(directions, [])
        self.assertEqual(classification, "already_complete")
        self.assertEqual(new_bbox, [10, 20, 90, 80])

    def test_left_clipping_with_source_pixels_is_expandable(self):
        directions = clipping_directions(["左侧文字被裁切"])
        classification, new_bbox, available, _ = classify_geometry([10, 20, 90, 80], (100, 100), directions, 8, 4)
        self.assertEqual(directions, ["left"])
        self.assertEqual(classification, "expandable")
        self.assertEqual(new_bbox, [2, 16, 90, 84])
        self.assertEqual(available["left"], 10)

    def test_required_edge_at_source_boundary_is_source_clipped(self):
        directions = clipping_directions([{"span": "字", "reason": "right-clipped"}])
        classification, new_bbox, available, _ = classify_geometry([10, 20, 100, 80], (100, 100), directions, 8, 4)
        self.assertEqual(directions, ["right"])
        self.assertEqual(classification, "source_clipped")
        self.assertEqual(new_bbox, [10, 20, 100, 80])
        self.assertEqual(available["right"], 0)

    def test_legacy_manifest_path_resolves_from_repository_scripts_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lineage = root / "scripts" / "legacy_evidence" / "output" / "run" / "overlay" / "lineage.json"
            expected = root / "scripts" / "legacy_evidence" / "input" / "v1" / "manifest.json"
            expected.parent.mkdir(parents=True)
            expected.write_text("{}", encoding="utf-8")
            self.assertEqual(
                resolve_manifest_path(lineage, r"..\legacy_evidence\input\v1\manifest.json"),
                expected.resolve(),
            )

    def test_final_classification_preserves_honest_uncertainty(self):
        self.assertEqual(final_classification([], True), "recovered_complete")
        self.assertEqual(final_classification(["末字字形可能不清"], True), "partial_transcription")
        self.assertEqual(final_classification(["文本右侧被裁切"], True), "source_clipped")


if __name__ == "__main__":
    unittest.main()
