import json
import tempfile
import unittest
from pathlib import Path

import build_targeted_context_groups as context_groups
import build_targeted_overlay as overlay
import build_targeted_review_groups as review_groups


class TargetedRecaptureTests(unittest.TestCase):
    def test_context_group_requires_every_row_and_uses_ctx_contract(self):
        patches = {
            ("体育课", row): {"row": row, "tokens": [], "text": "", "confidence": None, "crop": f"{row}.png"}
            for row in (24, 25)
        }
        group = context_groups.build_group("体育课", 24, 25, patches)
        self.assertEqual(group["review_columns"][0]["column"], "CTX")
        self.assertEqual([cell["row"] for cell in group["ocr_cells"]], [24, 25])
        with self.assertRaisesRegex(ValueError, "missing targeted context patch"):
            context_groups.build_group("体育课", 24, 26, patches)

    def test_selected_context_normalizes_wrapped_fields(self):
        cell = {
            "key": "主要课程|429|CTX",
            "selected": "analysis_a",
            "analysis_a": {"corrected_text": "course=财经报刊英语\n阅读\nteacher=易彤"},
        }
        self.assertEqual(review_groups.selected_context(cell), ("财经报刊英语阅读", "易彤"))

    def test_confirmed_blank_is_strict(self):
        cell = {
            "conclusion": "agreed",
            "selected": "analysis_a",
            "analysis_a": {"raw_transcription": "", "uncertainty_markers": []},
        }
        self.assertTrue(overlay.confirmed_blank(cell))
        cell["analysis_a"]["uncertainty_markers"] = ["unreadable"]
        self.assertFalse(overlay.confirmed_blank(cell))

    def test_composite_manifest_links_both_manifests(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = root / "base.json"
            recapture = root / "recapture.json"
            base.write_text(json.dumps({"files": {"old.png": "a"}}), encoding="utf-8")
            recapture.write_text(json.dumps({"files": [{"path": "new.jpg", "sha256": "b"}]}), encoding="utf-8")
            result = overlay.build_composite_manifest(base, recapture)
            self.assertEqual(result["files"], {"old.png": "a", "new.jpg": "b"})
            self.assertEqual([item["role"] for item in result["source_manifests"]], ["base", "targeted_recapture"])


if __name__ == "__main__":
    unittest.main()
