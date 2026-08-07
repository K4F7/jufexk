from __future__ import annotations

import unittest
from collections import Counter

from compile_catalog_augmentation_requests import build_request_rows


class CompileCatalogAugmentationRequestsTest(unittest.TestCase):
    def test_combines_teacher_creation_with_first_relation(self) -> None:
        rows = build_request_rows(
            {"teacher-a", "teacher-b"},
            Counter({("course-1", "teacher-a"): 3, ("course-2", "teacher-a"): 2}),
        )
        self.assertEqual(len(rows), 3)
        self.assertEqual(sum(row["teacher_source_label"] == "teacher-a" for row in rows), 2)
        self.assertEqual(sum(not row["course_code"] for row in rows), 1)
        self.assertEqual(sum(row["covered_unresolved_review_rows"] for row in rows), 5)

    def test_request_keys_are_deterministic_and_pair_sensitive(self) -> None:
        first = build_request_rows({"teacher-a"}, Counter({("course-1", "teacher-a"): 1}))[0]
        replay = build_request_rows({"teacher-a"}, Counter({("course-1", "teacher-a"): 1}))[0]
        other = build_request_rows({"teacher-a"}, Counter({("course-2", "teacher-a"): 1}))[0]
        self.assertEqual(first["request_key"], replay["request_key"])
        self.assertNotEqual(first["request_key"], other["request_key"])

    def test_rejects_relation_for_unapproved_teacher(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid approved teacher relation"):
            build_request_rows({"teacher-a"}, Counter({("course-1", "teacher-b"): 1}))


if __name__ == "__main__":
    unittest.main()
