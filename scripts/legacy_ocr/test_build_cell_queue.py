import unittest

from build_cell_queue import SHEETS, adjacent_ranges


class CellQueueGeometryTests(unittest.TestCase):
    def test_art_review_matrix_includes_legacy_course_review_column(self):
        self.assertEqual(SHEETS["美育"], ((8, 14), "E:M"))

    def test_selected_first_uses_next_grid_edge(self):
        self.assertEqual(adjacent_ranges((100, 300), "first", [0, 100, 300, 550, 900]), [(100, 300), (300, 550)])

    def test_selected_second_uses_previous_grid_edge(self):
        self.assertEqual(adjacent_ranges((300, 550), "second", [0, 100, 300, 550, 900]), [(100, 300), (300, 550)])

    def test_single_does_not_add_a_column(self):
        self.assertEqual(adjacent_ranges((300, 550), "single", [0, 100, 300, 550]), [(300, 550)])


if __name__ == "__main__":
    unittest.main()
