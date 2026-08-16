import unittest

from freeze_full_capture import FULL_SHEETS, expected_paths


class FreezeFullCaptureTests(unittest.TestCase):
    def test_expected_matrix_has_all_views_and_anchors(self):
        paths = expected_paths()

        self.assertEqual(len(paths), 240)
        self.assertEqual(len(set(paths)), 240)
        self.assertEqual(
            {sheet: sum(path.startswith(f"{sheet}/") for path in paths) for sheet in FULL_SHEETS},
            {
                "主要课程": 60,
                "数学课": 25,
                "美育": 30,
                "大英和视听说": 25,
                "思政课": 25,
                "外教": 25,
                "MOOC": 25,
                "体育课": 25,
            },
        )
        self.assertIn("主要课程/主要课程_rows001-480_reviews-F_anchor183.png", paths)
        self.assertIn("主要课程/主要课程_rows001-480_context-A-E_anchor127.png", paths)
        self.assertNotIn("主要课程/主要课程_rows001-480_reviews-F-G_anchor182.png", paths)


if __name__ == "__main__":
    unittest.main()
