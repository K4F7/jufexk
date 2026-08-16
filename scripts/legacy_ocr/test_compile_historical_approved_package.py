import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from compile_historical_approved_package import apply_teacher_reconciliation, stable, verified_file


class CompileHistoricalApprovedPackageTests(unittest.TestCase):
    def test_stable_identity_is_deterministic_and_target_sensitive(self):
        self.assertEqual(stable("review", "source", "course", "teacher"), stable("review", "source", "course", "teacher"))
        self.assertNotEqual(stable("review", "source", "course", "teacher-a"), stable("review", "source", "course", "teacher-b"))

    def test_verified_file_rejects_tampered_decision_artifact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / "decisions.jsonl"
            artifact.write_text('{"decision":"approve"}\n', encoding="utf-8")
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            (root / "manifest.json").write_text(json.dumps({
                "contract_version": "fixture-v1",
                "files": {"decisions.jsonl": {"rows": 1, "sha256": digest}},
            }), encoding="utf-8")
            verified_file(root, "manifest.json", "fixture-v1", "decisions.jsonl")
            artifact.write_text('{"decision":"reject"}\n', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                verified_file(root, "manifest.json", "fixture-v1", "decisions.jsonl")

    def test_teacher_reconciliation_fills_alias_and_removes_rejection(self):
        targets = {
            ("course-a", "teacher-a"): [{"teacher_label": None, "basis": "policy"}],
            ("course-b", "teacher-b"): [{"teacher_label": None, "basis": "policy"}],
        }
        rejected = {}
        apply_teacher_reconciliation(
            targets,
            rejected,
            {"teacher-a": {"catalog_teacher_label": "authority-a"}},
            {"teacher-b": {"owner_note": "owner rejected"}},
        )
        self.assertEqual(targets[("course-a", "teacher-a")][0]["teacher_label"], "authority-a")
        self.assertNotIn(("course-b", "teacher-b"), targets)
        self.assertEqual(rejected[("course-b", "teacher-b")], "owner rejected")

    def test_teacher_reconciliation_rejects_conflicting_terminal_target(self):
        targets = {("course-a", "teacher-a"): [{"teacher_label": "different", "basis": "manual"}]}
        with self.assertRaisesRegex(ValueError, "conflicts"):
            apply_teacher_reconciliation(
                targets,
                {},
                {"teacher-a": {"catalog_teacher_label": "authority-a"}},
                {},
            )


if __name__ == "__main__":
    unittest.main()
