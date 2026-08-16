import unittest

from build_smoke_sample import select_smoke_cells


class SmokeSampleTests(unittest.TestCase):
    def test_selects_first_routed_cell_for_each_sheet_in_declared_order(self):
        queue = [
            {"worksheet": "B", "row": 2, "column": "F", "key": "B|2|F"},
            {"worksheet": "A", "row": 2, "column": "F", "key": "A|2|F"},
            {"worksheet": "A", "row": 1, "column": "F", "key": "A|1|F"},
        ]

        self.assertEqual(
            [item["key"] for item in select_smoke_cells(queue, ["A", "B"])],
            ["A|1|F", "B|2|F"],
        )

    def test_rejects_a_sheet_without_a_non_empty_cell(self):
        with self.assertRaisesRegex(ValueError, "missing non-empty smoke cell for B"):
            select_smoke_cells([{"worksheet": "A", "row": 1, "column": "F", "key": "A|1|F"}], ["A", "B"])


if __name__ == "__main__":
    unittest.main()
