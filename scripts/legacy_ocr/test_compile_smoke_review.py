import unittest

from compile_smoke_review import compile_cells


class CompileSmokeReviewTests(unittest.TestCase):
    def test_exact_match_is_agreed_and_declared_choice_is_arbitrated(self):
        sample = [{"key": "A|1|F"}, {"key": "B|2|G"}]
        a = [
            {"key": "A|1|F", "raw_transcription": "same", "corrected_text": "same", "edits": [], "uncertainty_markers": []},
            {"key": "B|2|G", "raw_transcription": "left", "corrected_text": "left", "edits": [], "uncertainty_markers": []},
        ]
        b = [
            {"key": "A|1|F", "raw_transcription": "same", "corrected_text": "same", "edits": [], "uncertainty_markers": []},
            {"key": "B|2|G", "raw_transcription": "right", "corrected_text": "right", "edits": [], "uncertainty_markers": []},
        ]
        arbitration = [{"worksheet": "B", "row": 2, "column": "G", "decision": "analysis_b", "selected_text": "right", "reason": "visible"}]

        result = compile_cells(sample, a, b, arbitration)

        self.assertEqual([item["conclusion"] for item in result], ["agreed", "arbitrated"])

    def test_rejects_arbitrator_text_that_is_neither_a_nor_b(self):
        sample = [{"key": "A|1|F"}]
        a = [{"key": "A|1|F", "raw_transcription": "left", "corrected_text": "left", "edits": [], "uncertainty_markers": []}]
        b = [{"key": "A|1|F", "raw_transcription": "right", "corrected_text": "right", "edits": [], "uncertainty_markers": []}]
        arbitration = [{"worksheet": "A", "row": 1, "column": "F", "decision": "analysis_a", "selected_text": "third", "reason": "bad"}]

        with self.assertRaisesRegex(ValueError, "third transcription"):
            compile_cells(sample, a, b, arbitration)


if __name__ == "__main__":
    unittest.main()
