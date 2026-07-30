import json
import tempfile
import unittest
from pathlib import Path

from build_versioned_package import (
    capture_source,
    load_selected_context,
    parse_context,
    stable_id,
    unique_index,
    validate_queue_sources,
    manual_review_reasons,
)


class BuildVersionedPackageTests(unittest.TestCase):
    def test_context_contract_and_stable_ids(self):
        self.assertEqual(parse_context("course=高等数学\nteacher=张三"), ("高等数学", "张三"))
        self.assertEqual(
            parse_context("course=概率论\n（和数理统计）\nteacher=陈\n琳"),
            ("概率论（和数理统计）", "陈琳"),
        )
        self.assertEqual(stable_id("course", " 高等数学 "), stable_id("course", "高等数学"))
        self.assertNotEqual(stable_id("teacher", "ß"), stable_id("teacher", "ss"))

    def test_duplicate_provenance_keys_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate review"):
            unique_index([{"key": "x"}, {"key": "x"}], lambda item: item["key"], "review")

    def test_course_blank_inherits_but_unclear_breaks_inheritance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for sheet in ["主要课程", "数学课", "美育", "大英和视听说", "思政课", "外教", "MOOC", "体育课"]:
                out = root / sheet; out.mkdir()
                cells = []
                if sheet == "主要课程":
                    for row, value in [(19, "course=统计学\nteacher=甲"), (20, "course=[blank]\nteacher=乙"), (21, "course=[unclear]\nteacher=丙"), (22, "course=[blank]\nteacher=丁"), (23, "course=概率论\nteacher=戊"), (25, "course=[blank]\nteacher=己")]:
                        cells.append({"row": row, "status": "review", "selected": "analysis_a", "analysis_a": {"raw_transcription": value, "uncertainty_markers": []}, "conclusion": "agreed"})
                    cells.append({"row": 24, "status": "context_gap", "reason": "missing_context_capture"})
                (out / "matrix.json").write_text(json.dumps({"cells": cells}))
            result = load_selected_context(root)
            self.assertEqual(result[("主要课程", 20)]["course"], "统计学")
            self.assertEqual(result[("主要课程", 20)]["inherited_from"], 19)
            self.assertEqual(result[("主要课程", 22)]["course"], "")
            self.assertEqual(result[("主要课程", 25)]["course"], "")

    def test_capture_gap_uses_manifest_provenance_without_source_fields(self):
        manifest_sha256 = "a" * 64
        gap = {"status": "context_gap", "manifest_sha256": manifest_sha256}
        validate_queue_sources([gap], "context", {"files": {}}, manifest_sha256)
        self.assertEqual(
            capture_source(gap),
            {"source_file": None, "source_sha256": None, "crop_sha256": None, "bbox": None},
        )

    def test_capture_gap_manifest_mismatch_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "context capture gap is not linked"):
            validate_queue_sources(
                [{"status": "context_gap", "manifest_sha256": "b" * 64}],
                "context",
                {"files": {}},
                "a" * 64,
            )

    def test_manual_review_reasons_are_explicit_and_stable(self):
        self.assertEqual(
            manual_review_reasons(
                course_id=None, teacher_id="teacher", comment="", review_conclusion="unresolved",
                review_markers=["x"], context_markers=["y"], context_capture_gap=True,
            ),
            ["content_unresolved", "review_uncertain", "context_uncertain", "context_capture_gap", "course_unclear", "comment_blank"],
        )


if __name__ == "__main__":
    unittest.main()
