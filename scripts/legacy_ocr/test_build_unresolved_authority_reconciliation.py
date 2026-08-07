from __future__ import annotations

import unittest

from build_unresolved_authority_reconciliation import (
    best_relation_candidate,
    course_forms,
    one_substitution,
    reconcile_course,
)


class AuthorityReconciliationTest(unittest.TestCase):
    def test_course_forms_uses_owner_correction_conventions(self) -> None:
        self.assertEqual(course_forms("231微观经济学"), {"微观经济学"})
        self.assertEqual(course_forms("概率论（和数理统计）"), {"概率论与数理统计"})
        self.assertEqual(course_forms("金融计量学or计量经济学"), {"金融计量学", "计量经济学"})

    def test_one_substitution_rejects_insertions(self) -> None:
        self.assertTrue(one_substitution("江邵玫", "江绍玫"))
        self.assertFalse(one_substitution("饶文军.", "饶文军"))
        self.assertFalse(one_substitution("相同", "相同"))

    def test_relation_candidate_requires_a_unique_score(self) -> None:
        relations = {"A": {"甲", "乙"}, "B": {"甲"}, "C": {"丙"}}
        self.assertEqual(best_relation_candidate({"A", "B"}, {"甲", "乙"}, relations), ("A", 2, 1))
        self.assertEqual(best_relation_candidate({"B", "C"}, {"甲", "丙"}, relations)[0], None)

    def test_course_reconciliation_uses_semantic_name_and_relation(self) -> None:
        decision = {"legacy_course_id": "legacy", "approved_course_query": "概率论（和数理统计）"}
        names = {"A": {"概率论与数理统计"}, "B": {"概率论与数理统计"}}
        result = reconcile_course(decision, names, {"甲", "乙"}, {"A": {"甲", "乙"}, "B": {"甲"}})
        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result["catalog_course_code"], "A")
        self.assertEqual(result["match_method"], "owner_name_semantic_relation_score_unique")


if __name__ == "__main__":
    unittest.main()
