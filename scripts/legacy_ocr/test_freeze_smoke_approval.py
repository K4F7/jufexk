import json
import tempfile
import unittest
from pathlib import Path

from freeze_smoke_approval import freeze


class FreezeSmokeApprovalTests(unittest.TestCase):
    def test_freezes_eight_resolved_groups_and_counts_null_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cells = []
            for index in range(8):
                worksheet = f"sheet-{index}"
                key = f"{worksheet}|1|F"
                cells.append({"worksheet": worksheet, "key": key})
                out = root / "workflows" / worksheet / "out"
                out.mkdir(parents=True)
                (out / "status.json").write_text(json.dumps({"status": "completed", "expected_cells": 1, "routed_cells": 1, "unresolved_cells": 0}))
                (out / "validation.json").write_text(json.dumps({"valid": True, "references_valid": True}))
                (out / "matrix.json").write_text(json.dumps({"cells": [{"key": key, "conclusion": "agreed", "selected": "analysis_a"}]}))
                response = {"cells": [{"selected": None}]} if index == 0 else {"cells": []}
                (out / "attempts.json").write_text(json.dumps([{"side": "arbitration" if index == 0 else "analysis_a", "model": "gpt-5.6-luna", "status": "completed", "session_id": str(index), "raw_response": response}]))
            sample = root / "sample.json"
            sample.write_text(json.dumps({"manifest_sha256": "m", "cells": cells}))

            result = freeze(sample, root / "workflows")

            self.assertEqual(result["status"], "approved")
            self.assertEqual(result["resolved_cells"], 8)
            self.assertEqual(result["recovered_null_arbitrations"], 1)

    def test_rejects_unresolved_group(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sample = root / "sample.json"
            sample.write_text(json.dumps({"manifest_sha256": "m", "input_sha256": "i", "cells": [{"worksheet": str(i), "key": f"{i}|1|F"} for i in range(8)]}))
            for index in range(8):
                out = root / "workflows" / str(index) / "out"
                out.mkdir(parents=True)
                status = {"status": "completed", "expected_cells": 1, "routed_cells": 1, "unresolved_cells": int(index == 0)}
                (out / "status.json").write_text(json.dumps(status))
                (out / "validation.json").write_text(json.dumps({"valid": True, "references_valid": True}))
                (out / "matrix.json").write_text(json.dumps({"cells": [{"key": f"{index}|1|F", "conclusion": "agreed", "selected": "analysis_a"}]}))
                (out / "attempts.json").write_text("[]")

            with self.assertRaisesRegex(ValueError, "status"):
                freeze(sample, root / "workflows")


if __name__ == "__main__":
    unittest.main()
