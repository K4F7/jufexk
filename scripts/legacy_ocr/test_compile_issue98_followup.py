import json
import tempfile
import unittest
from pathlib import Path

from compile_issue98_followup import (
    CompileError,
    add_consistent_request,
    formula_decision_index,
    normalized,
    unique_index,
    validate_source_fanout,
)


class CompileIssue98FollowupTests(unittest.TestCase):
    def test_normalized_collapses_unicode_whitespace(self):
        self.assertEqual(normalized("  大学\u3000英语  "), "大学 英语")

    def test_unique_index_rejects_duplicate_keys(self):
        with self.assertRaisesRegex(CompileError, "duplicate"):
            unique_index([{"id": "a"}, {"id": "a"}], "id", "fixture")

    def test_formula_decisions_must_exactly_cover_source_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.jsonl"
            path.write_text(json.dumps({
                "schema_version": "legacy-issue98-formula-source-decision-v1",
                "source_key": "Sheet|1|F",
                "action": "source_verified",
                "reviewer_note": "Reviewed",
            }) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(CompileError, "exactly cover"):
                formula_decision_index(path, {"Sheet|1|F", "Sheet|1|G"})

    def test_identity_request_rejects_conflicting_evidence(self):
        target = {}
        add_consistent_request(target, "identity", {"source_label": "First"})
        with self.assertRaisesRegex(CompileError, "conflicting identity request"):
            add_consistent_request(target, "identity", {"source_label": "Second"})

    def test_source_fanout_requires_declared_consistent_duplicates(self):
        rows = [
            {"source_evaluation_id": "e1", "duplicate_group": "d1", "comment": "Review", "worksheet": "S", "source_row": 1, "source_column": "F", "proposed_teacher_label": "A"},
            {"source_evaluation_id": "e1", "duplicate_group": "d1", "comment": "Review", "worksheet": "S", "source_row": 1, "source_column": "F", "proposed_teacher_label": "B"},
        ]
        validate_source_fanout(rows, expected_extra_rows=1)
        rows[1]["comment"] = "Different"
        with self.assertRaisesRegex(CompileError, "invalid unresolved source fan-out"):
            validate_source_fanout(rows, expected_extra_rows=1)


if __name__ == "__main__":
    unittest.main()
