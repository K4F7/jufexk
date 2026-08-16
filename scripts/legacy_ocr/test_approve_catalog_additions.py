import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from approve_catalog_additions import approve_catalog_additions


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def fixture_mapping(root: Path) -> None:
    requests = [{
        "schema_version": "legacy-catalog-addition-request-v1", "request_kind": "relation",
        "catalog_course_code": "C001", "catalog_teacher_label": "教师甲",
        "legacy_course_ids": ["legacy-course"], "legacy_teacher_ids": ["legacy-teacher"],
        "reason": "approved_catalog_relation_missing", "terminal_status": "owner_review_required",
    }]
    request_bytes = b"".join(json_bytes(row) for row in requests)
    (root / "catalog-addition-requests.jsonl").write_bytes(request_bytes)
    manifest = {
        "contract_version": "legacy-catalog-identity-mapping-manifest-v1",
        "status": "awaiting_owner_review", "source_staging_manifest_sha256": "a" * 64,
        "approved_catalog_manifest_sha256": "b" * 64, "approved_catalog_content_sha256": "c" * 64,
        "counts": {"required": 1, "resolved": 0, "alias_exceptions": 0, "catalog_addition_requests": 1},
        "files": {"catalog-addition-requests.jsonl": {"rows": 1, "sha256": hashlib.sha256(request_bytes).hexdigest()}},
    }
    (root / "manifest.json").write_bytes(json_bytes(manifest))


class ApproveCatalogAdditionsTests(unittest.TestCase):
    def test_compiles_owner_batch_approval(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / "mapping"; source.mkdir()
            fixture_mapping(source)
            manifest = approve_catalog_additions(source, root / "out", "owner-batch-2026-07-30")
            self.assertEqual(manifest["status"], "addition_requests_approved")
            self.assertEqual(manifest["counts"], {"approved": 1})
            row = json.loads((root / "out" / "decisions.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(row["decision"], "approve")
            self.assertEqual(row["decision_mode"], "owner_batch_approval")

    def test_rejects_tampered_request_queue(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / "mapping"; source.mkdir()
            fixture_mapping(source)
            with (source / "catalog-addition-requests.jsonl").open("ab") as handle:
                handle.write(b"{}\n")
            with self.assertRaisesRegex(ValueError, "integrity"):
                approve_catalog_additions(source, root / "out", "owner-batch-2026-07-30")


if __name__ == "__main__":
    unittest.main()
