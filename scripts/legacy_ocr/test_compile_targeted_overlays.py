import json
import tempfile
import unittest

from compile_targeted_overlays import (
    AUTHORITATIVE_REVIEW_MATRIX_SHA256,
    FORMULA_BAR_BBOX,
    REVIEW_UNCERTAIN_CLASSIFICATION_COUNTS,
    REVIEW_UNCERTAIN_REASON_COUNTS,
    compile_review_uncertain_51_dom_overlay,
    is_within,
    unique,
    validate_review_decisions,
)
from pathlib import Path


class CompileTargetedOverlaysTests(unittest.TestCase):
    def test_unique_requires_exact_count(self):
        self.assertEqual(set(unique([{"id": "a"}, {"id": "b"}], "id", 2)), {"a", "b"})
        with self.assertRaisesRegex(ValueError, "expected 2 unique"):
            unique([{"id": "a"}, {"id": "a"}], "id", 2)
        with self.assertRaisesRegex(ValueError, "expected 2 unique"):
            unique([{"id": "a"}], "id", 2)

    def test_authoritative_review_matrix_hash_is_pinned(self):
        self.assertEqual(AUTHORITATIVE_REVIEW_MATRIX_SHA256, "9ee88303dd9d0c65263582468a4d0422824a03cf19a290ce28c537bc81a06b88")

    def test_review_uncertain_66_contract_is_pinned(self):
        self.assertEqual(sum(REVIEW_UNCERTAIN_REASON_COUNTS.values()), 66)
        self.assertEqual(REVIEW_UNCERTAIN_CLASSIFICATION_COUNTS, {"source_clipped": 49, "partial_transcription": 17})
        self.assertEqual(FORMULA_BAR_BBOX, [75, 150, 2536, 182])

    def test_path_must_stay_within_frozen_root(self):
        self.assertTrue(is_within(Path("root/crops/a.png"), Path("root/crops")))
        self.assertFalse(is_within(Path("root/other/a.png"), Path("root/crops")))

    def test_decisions_require_exact_selected_candidate(self):
        decision = {
            "contract_version": "review-uncertain-66-decisions-v2",
            "reviews": {"sheet|1|A": {
                "a": {"status": "complete", "transcription": "alpha"},
                "b": {"status": "complete", "transcription": "beta"},
                "arbitration": {"choice": "B"},
                "terminal_status": "recovered_arbitration",
                "final_text": "beta",
            }},
        }
        self.assertEqual(set(validate_review_decisions(decision, {"sheet|1|A"})), {"sheet|1|A"})
        decision["reviews"]["sheet|1|A"]["final_text"] = "edited third text"
        with self.assertRaisesRegex(ValueError, "exact selected candidate"):
            validate_review_decisions(decision, {"sheet|1|A"})

    def test_decisions_require_arbitration_for_unclear_agreement(self):
        decision = {
            "contract_version": "review-uncertain-66-decisions-v2",
            "reviews": {"sheet|1|A": {
                "a": {"status": "unclear", "transcription": "same"},
                "b": {"status": "complete", "transcription": "same"},
                "arbitration": None,
                "terminal_status": "recovered_agreement",
                "final_text": "same",
            }},
        }
        with self.assertRaisesRegex(ValueError, "requires constrained arbitration"):
            validate_review_decisions(decision, {"sheet|1|A"})

    def test_dom_overlay_recovers_only_nonblank_formula_transcriptions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = []
            for index in range(66):
                recovered = index < 15
                rows.append({"evaluation_id": f"evaluation-{index}", "key": f"sheet|{index}|A",
                             "final_classification": "recovered_complete" if recovered else "source_clipped",
                             "final_transcription": "old", "final_uncertainty_markers": [] if recovered else ["review_uncertain"]})
            base = root / "base.jsonl"
            base.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            captures = root / "captures" / "sheet"
            captures.mkdir(parents=True)
            for index in range(15, 66):
                (captures / f"A{index}.png").write_bytes(f"capture-{index}".encode())
            evidence = root / "evidence.json"
            evidence.write_text(json.dumps({"contract_version": "review-uncertain-51-dom-v1",
                                            "transcriptions": {f"sheet|{index}|A": f"text-{index}" for index in range(15, 36)}}), encoding="utf-8")
            report = compile_review_uncertain_51_dom_overlay(base, evidence, root / "captures", root / "out")
            self.assertEqual((report["recovered_count"], report["unresolved_count"]), (36, 30))



if __name__ == "__main__":
    unittest.main()
