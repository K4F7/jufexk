import csv
import json
import tempfile
import unittest
from pathlib import Path

from approval import APPROVED_FIELDS, REVIEW_FIELDS, finalize


class ApprovalTests(unittest.TestCase):
    def fixture(self, root: Path, **changes):
        reference = root / "reference.json"
        reference.write_text(json.dumps({
            "courses": [{"id": 1, "name": "课程", "category": "major"}],
            "teachers": [{"id": 2, "name": "教师"}],
            "course_teachers": [{"course_id": 1, "teacher_id": 2}],
            "offerings": [], "offering_teachers": [],
        }, ensure_ascii=False), encoding="utf-8")
        row = {field: "" for field in REVIEW_FIELDS}
        row.update({"decision": "approve", "approved_course_id": "1", "approved_teacher_id": "2", "comment": "历史评价", "source_file": "a.png", "sheet_name": "主要课程", "source_row": "2", "raw_ocr_text": "原始文字", "ocr_confidence": ".98", "ocr_tokens_json": "[]", "review_note": "人工核对截图"})
        row.update(changes)
        queue = root / "queue.csv"
        with queue.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=REVIEW_FIELDS); writer.writeheader(); writer.writerow(row)
        return queue, reference

    def test_finalize_preserves_provenance_and_never_adds_overall(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); queue, reference = self.fixture(root)
            approved = root / "approved.csv"; errors = root / "errors.csv"; payload = root / "payload"
            self.assertEqual(finalize(queue, reference, approved, errors, payload), 0)
            with approved.open(encoding="utf-8-sig", newline="") as handle: row = next(csv.DictReader(handle))
            self.assertEqual(row["source_type"], "legacy_ocr")
            self.assertEqual(row["category"], "major")
            self.assertNotIn("overall", APPROVED_FIELDS)
            payload_data = json.loads((payload / "legacy_import_payload_001.json").read_text(encoding="utf-8"))
            self.assertRegex(payload_data["idempotencyKey"], r"^[a-f0-9]{64}$")

    def test_duplicate_needs_an_explicit_keep_decision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); queue, reference = self.fixture(root, duplicate_group="abc")
            approved = root / "approved.csv"; errors = root / "errors.csv"
            self.assertEqual(finalize(queue, reference, approved, errors, root / "payload"), 2)
            self.assertFalse(approved.exists())
            self.assertIn("duplicate_action=keep", errors.read_text(encoding="utf-8-sig"))


if __name__ == "__main__": unittest.main()
