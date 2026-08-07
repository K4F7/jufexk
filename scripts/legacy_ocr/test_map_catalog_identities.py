import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from map_catalog_identities import map_catalog_identities


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def write_jsonl(path: Path, rows: list[dict]) -> dict:
    content = b"".join(json_bytes(row) for row in rows)
    path.write_bytes(content)
    return {"rows": len(rows), "sha256": hashlib.sha256(content).hexdigest()}


def fixture_staging(root: Path, required: list[dict]) -> None:
    files = {"catalog-mapping-required.jsonl": write_jsonl(root / "catalog-mapping-required.jsonl", required)}
    manifest = {
        "contract_version": "legacy-production-staging-v1",
        "status": "awaiting_catalog_mapping",
        "source_package_manifest_sha256": "a" * 64,
        "files": files,
    }
    (root / "production-staging-manifest.json").write_bytes(json_bytes(manifest))


def approved_record(record_type: str, value: dict) -> dict:
    return {"schemaVersion": "catalog-baseline-approved-record/v1", "recordType": record_type, "value": value}


def fixture_catalog(root: Path, *, relation=True, extra_courses=None) -> None:
    rows = [
        approved_record("course", {
            "schemaVersion": "catalog-baseline-course/v1", "courseCode": "C001",
            "currentName": "课程甲", "normalizedCurrentName": "课程甲",
            "nameVariants": [{"rawName": "课程 甲", "normalizedName": "课程 甲"}],
            "category": "general", "sourceCategoryTexts": ["必修"],
        }),
        approved_record("teacher", {
            "schemaVersion": "catalog-baseline-teacher/v1", "sourceTeacherLabel": "教师甲",
            "normalizedTeacherLabel": "教师甲",
        }),
    ]
    rows.extend(approved_record("course", course) for course in (extra_courses or []))
    if relation:
        rows.append(approved_record("relation", {
            "schemaVersion": "catalog-baseline-relation/v2", "courseCode": "C001",
            "sourceTeacherLabel": "教师甲", "provenance": [{"queryId": "q"}],
        }))
    artifact = b"".join(json_bytes(row) for row in rows)
    (root / "catalog-baseline.jsonl").write_bytes(artifact)
    content = {
        "schemaVersion": "catalog-baseline-approved-manifest/v1", "status": "package_ready",
        "counts": {"courses": 1 + len(extra_courses or []), "teachers": 1, "relations": int(relation), "totalRecords": len(rows)},
        "artifact": {"path": "catalog-baseline.jsonl", "records": len(rows), "bytes": len(artifact), "sha256": hashlib.sha256(artifact).hexdigest()},
        "contentSha256": "b" * 64,
    }
    (root / "manifest.json").write_text(json.dumps(content), encoding="utf-8")


def requirement(course="课程甲", teacher="教师甲") -> dict:
    return {
        "legacy_course_id": "legacy-course", "legacy_course_name": course,
        "legacy_teacher_id": "legacy-teacher", "legacy_teacher_name": teacher,
        "database_course_id": None, "database_teacher_id": None, "category": None,
    }


class MapCatalogIdentitiesTests(unittest.TestCase):
    def test_resolves_only_existing_catalog_relation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); staging = root / "staging"; catalog = root / "catalog"
            staging.mkdir(); catalog.mkdir(); fixture_staging(staging, [requirement()]); fixture_catalog(catalog)
            manifest = map_catalog_identities(staging, catalog, root / "out")
            self.assertEqual(manifest["status"], "identity_mapping_complete")
            self.assertEqual(manifest["counts"], {"required": 1, "resolved": 1, "alias_exceptions": 0, "catalog_addition_requests": 0})
            resolved = json.loads((root / "out" / "resolved-mappings.jsonl").read_text(encoding="utf-8"))
            self.assertEqual((resolved["catalog_course_code"], resolved["catalog_teacher_label"], resolved["category"]), ("C001", "教师甲", "general"))

    def test_minimal_normalization_is_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); staging = root / "staging"; catalog = root / "catalog"
            staging.mkdir(); catalog.mkdir(); fixture_staging(staging, [requirement(course=" 课程甲 ", teacher="教师甲\u200b")]); fixture_catalog(catalog)
            first = root / "first"; second = root / "second"
            map_catalog_identities(staging, catalog, first); map_catalog_identities(staging, catalog, second)
            self.assertEqual((first / "resolved-mappings.jsonl").read_bytes(), (second / "resolved-mappings.jsonl").read_bytes())
            row = json.loads((first / "resolved-mappings.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(row["course_match_method"], "stable_normalized_alias")
            self.assertEqual(row["teacher_match_method"], "stable_normalized_alias")

    def test_unmatched_identity_becomes_alias_exception(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); staging = root / "staging"; catalog = root / "catalog"
            staging.mkdir(); catalog.mkdir(); fixture_staging(staging, [requirement(course="未知课程")]); fixture_catalog(catalog)
            manifest = map_catalog_identities(staging, catalog, root / "out")
            self.assertEqual(manifest["status"], "awaiting_owner_review")
            self.assertEqual(manifest["counts"]["alias_exceptions"], 1)
            self.assertEqual(manifest["counts"]["resolved"], 0)

    def test_relation_graph_uniquely_disambiguates_same_name_course(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); staging = root / "staging"; catalog = root / "catalog"
            staging.mkdir(); catalog.mkdir(); fixture_staging(staging, [requirement()])
            fixture_catalog(catalog, extra_courses=[{
                "schemaVersion": "catalog-baseline-course/v1", "courseCode": "C002",
                "currentName": "课程甲", "normalizedCurrentName": "课程甲",
                "nameVariants": [], "category": "general", "sourceCategoryTexts": ["选修"],
            }])
            manifest = map_catalog_identities(staging, catalog, root / "out")
            self.assertEqual(manifest["counts"]["resolved"], 1)
            row = json.loads((root / "out" / "resolved-mappings.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(row["catalog_course_code"], "C001")
            self.assertEqual(row["course_match_method"], "pair_relation_unique")

    def test_missing_relation_becomes_catalog_addition_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); staging = root / "staging"; catalog = root / "catalog"
            staging.mkdir(); catalog.mkdir(); fixture_staging(staging, [requirement()]); fixture_catalog(catalog, relation=False)
            manifest = map_catalog_identities(staging, catalog, root / "out")
            self.assertEqual(manifest["status"], "awaiting_owner_review")
            self.assertEqual(manifest["counts"]["catalog_addition_requests"], 1)
            request = json.loads((root / "out" / "catalog-addition-requests.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(request["request_kind"], "relation")

    def test_rejects_tampered_catalog_artifact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); staging = root / "staging"; catalog = root / "catalog"
            staging.mkdir(); catalog.mkdir(); fixture_staging(staging, [requirement()]); fixture_catalog(catalog)
            with (catalog / "catalog-baseline.jsonl").open("ab") as handle:
                handle.write(b"{}\n")
            with self.assertRaisesRegex(ValueError, "catalog artifact integrity"):
                map_catalog_identities(staging, catalog, root / "out")


if __name__ == "__main__":
    unittest.main()
