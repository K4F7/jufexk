import hashlib
import json
import tempfile
import unittest
from inspect import signature
from pathlib import Path

from freeze_historical_production_package import (
    SOURCE_APPROVED_CATALOG_MANIFEST_SHA256,
    FreezeError,
    _freeze,
    freeze,
)


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def write_jsonl(path: Path, rows: list[dict]) -> dict:
    path.write_text(
        "".join(f"{canonical_json(row)}\n" for row in rows), encoding="utf-8"
    )
    return {
        "rows": len(rows),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def refresh_manifest(source: Path, artifact_name: str) -> str:
    manifest_path = source / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rows = [
        json.loads(line)
        for line in (source / artifact_name).read_text(encoding="utf-8").split("\n")
        if line.strip()
    ]
    manifest["files"][artifact_name] = {
        "rows": len(rows),
        "sha256": hashlib.sha256((source / artifact_name).read_bytes()).hexdigest(),
    }
    manifest_path.write_text(canonical_json(manifest), encoding="utf-8")
    return hashlib.sha256(manifest_path.read_bytes()).hexdigest()


def refresh_catalog_manifest(catalog_manifest: Path) -> None:
    artifact_path = catalog_manifest.parent / "catalog-baseline.jsonl"
    rows = [
        json.loads(line)
        for line in artifact_path.read_text(encoding="utf-8").splitlines()
    ]
    counts = {
        "courses": sum(row["recordType"] == "course" for row in rows),
        "teachers": sum(row["recordType"] == "teacher" for row in rows),
        "relations": sum(row["recordType"] == "relation" for row in rows),
        "totalRecords": len(rows),
    }
    manifest = json.loads(catalog_manifest.read_text(encoding="utf-8"))
    manifest["counts"] = counts
    manifest["artifact"] = {
        "path": "catalog-baseline.jsonl",
        "records": len(rows),
        "bytes": artifact_path.stat().st_size,
        "sha256": hashlib.sha256(artifact_path.read_bytes()).hexdigest(),
    }
    catalog_manifest.write_text(canonical_json(manifest), encoding="utf-8")


class FreezeHistoricalProductionPackageTests(unittest.TestCase):
    def fixture(self, root: Path, *, blank_comment: bool = False):
        source = root / "source"
        source.mkdir()
        approved = [
            {
                "schema_version": "legacy-approved-review-v1",
                "review_id": f"review-{index}",
                "source_evaluation_id": f"evaluation-{index}",
                "catalog_course_code": "C1" if index < 522 else "C2",
                "catalog_teacher_label": "Teacher" if index < 522 else "Teacher2",
                "category": "general",
                "comment": "" if blank_comment and index == 0 else "Useful review",
                "decision_basis": "existing_catalog_relation",
                "duplicate_group": None,
                "proposed_teacher_label": None,
                "source_column": "F",
                "source_row": index + 1,
                "worksheet": "Sheet",
            }
            for index in range(941)
        ]
        unresolved = [
            {
                "schema_version": "legacy-approved-unresolved-review-v1",
                "review_id": f"unresolved-{index}",
                "source_evaluation_id": (
                    f"evaluation-{index}"
                    if index < 41
                    else f"unresolved-evaluation-{index}"
                ),
                "catalog_course_code": "C1",
                "catalog_teacher_label": None,
                "category": "general",
                "comment": "Unresolved review",
                "decision_basis": "preserve_pending_teacher",
                "duplicate_group": f"duplicate-{index}" if index < 41 else None,
                "proposed_teacher_label": "Pending Teacher",
                "source_column": "G",
                "source_row": index + 1,
                "unresolved_reasons": ["teacher_identity"],
                "worksheet": "Sheet",
            }
            for index in range(430)
        ]
        excluded = [
            {
                "schema_version": "legacy-approved-exclusion-v1",
                "reason": "owner_rejected_identity",
                "evaluation": {
                    "evaluation_id": f"excluded-{index}",
                    "comment": "Excluded",
                },
                "owner_note": "Rejected identity",
            }
            for index in range(8)
        ]
        inputs = {
            "approved-legacy-reviews.jsonl": approved,
            "unresolved-legacy-reviews.jsonl": unresolved,
            "excluded-legacy-reviews.jsonl": excluded,
            "catalog-courses.jsonl": [{"courseCode": "C1"}, {"courseCode": "C2"}],
            "catalog-teachers.jsonl": [
                {"sourceTeacherLabel": "Teacher"},
                {"sourceTeacherLabel": "Teacher2"},
            ],
            "catalog-relations.jsonl": [
                {"courseCode": "C1", "sourceTeacherLabel": "Teacher"},
                {"courseCode": "C2", "sourceTeacherLabel": "Teacher2"},
            ],
        }
        files = {
            name: write_jsonl(source / name, rows) for name, rows in inputs.items()
        }
        catalog_manifest = root / "catalog-manifest.json"
        catalog_records = [
            {
                "schemaVersion": "catalog-baseline-approved-record/v1",
                "recordType": "course",
                "value": {"courseCode": "C1"},
            },
            {
                "schemaVersion": "catalog-baseline-approved-record/v1",
                "recordType": "course",
                "value": {"courseCode": "C2"},
            },
            {
                "schemaVersion": "catalog-baseline-approved-record/v1",
                "recordType": "teacher",
                "value": {"sourceTeacherLabel": "Teacher"},
            },
            {
                "schemaVersion": "catalog-baseline-approved-record/v1",
                "recordType": "teacher",
                "value": {"sourceTeacherLabel": "Teacher2"},
            },
            {
                "schemaVersion": "catalog-baseline-approved-record/v1",
                "recordType": "relation",
                "value": {"courseCode": "C1", "sourceTeacherLabel": "Teacher"},
            },
        ]
        catalog_artifact = root / "catalog-baseline.jsonl"
        write_jsonl(catalog_artifact, catalog_records)
        catalog_manifest.write_text(
            canonical_json(
                {
                    "schemaVersion": "catalog-baseline-approved-manifest/v1",
                    "status": "package_ready",
                    "counts": {
                        "courses": 2,
                        "teachers": 2,
                        "relations": 1,
                        "totalRecords": 5,
                    },
                    "artifact": {
                        "path": "catalog-baseline.jsonl",
                        "records": 5,
                        "bytes": catalog_artifact.stat().st_size,
                        "sha256": hashlib.sha256(catalog_artifact.read_bytes()).hexdigest(),
                    },
                    "contentSha256": "catalog-hash",
                }
            ),
            encoding="utf-8",
        )
        manifest = {
            "contract_version": "legacy-historical-approved-package-v1",
            "approved_catalog_manifest_sha256": SOURCE_APPROVED_CATALOG_MANIFEST_SHA256,
            "closure": {
                "all_api_ready_source_rows_terminal": True,
                "production_write_performed": False,
            },
            "counts": {
                "approved_import_rows": 941,
                "unresolved_rows": 430,
                "excluded_source_rows": 8,
                "source_api_ready": 1338,
                "fan_out_extra_rows": 41,
            },
            "files": files,
        }
        (source / "manifest.json").write_text(canonical_json(manifest), encoding="utf-8")
        manifest_sha256 = hashlib.sha256((source / "manifest.json").read_bytes()).hexdigest()
        return source, catalog_manifest, manifest_sha256

    def test_freeze_rejects_a_blank_importable_comment(self):
        with tempfile.TemporaryDirectory() as directory:
            source, catalog_manifest, manifest_sha256 = self.fixture(
                Path(directory), blank_comment=True
            )
            with self.assertRaisesRegex(FreezeError, "non-blank comment"):
                _freeze(
                    source,
                    catalog_manifest,
                    Path(directory) / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_manifest_counts_are_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            source, catalog_manifest, _ = self.fixture(Path(directory))
            manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
            manifest["counts"]["approved_import_rows"] = 940
            (source / "manifest.json").write_text(canonical_json(manifest), encoding="utf-8")
            manifest_sha256 = hashlib.sha256((source / "manifest.json").read_bytes()).hexdigest()
            with self.assertRaisesRegex(FreezeError, "approved_import_rows"):
                _freeze(
                    source,
                    catalog_manifest,
                    Path(directory) / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_source_manifest_authority_hash_is_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, _ = self.fixture(root)
            with self.assertRaisesRegex(FreezeError, "#24 approved authority"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256="0" * 64,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_catalog_manifest_authority_hash_is_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, manifest_sha256 = self.fixture(root)
            catalog_manifest_sha256 = hashlib.sha256(
                catalog_manifest.read_bytes()
            ).hexdigest()
            catalog_manifest.write_text(
                canonical_json({"contentSha256": "catalog-hash", "changed": True}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(FreezeError, "catalog manifest SHA-256 mismatch"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                    expected_catalog_manifest_sha256=catalog_manifest_sha256,
                )

    def test_catalog_content_authority_hash_is_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, manifest_sha256 = self.fixture(root)
            with self.assertRaisesRegex(FreezeError, "contract or content SHA-256 mismatch"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="unexpected",
                )

    def test_catalog_artifact_hash_is_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, manifest_sha256 = self.fixture(root)
            with (root / "catalog-baseline.jsonl").open("a", encoding="utf-8") as stream:
                stream.write("{}\n")
            with self.assertRaisesRegex(FreezeError, "artifact hash, size, or record"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_v2_relation_split_is_fixed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, manifest_sha256 = self.fixture(root)
            artifact_path = root / "catalog-baseline.jsonl"
            rows = [json.loads(line) for line in artifact_path.read_text(encoding="utf-8").splitlines()]
            rows.append(
                {
                    "schemaVersion": "catalog-baseline-approved-record/v1",
                    "recordType": "relation",
                    "value": {"courseCode": "C2", "sourceTeacherLabel": "Teacher2"},
                }
            )
            write_jsonl(artifact_path, rows)
            refresh_catalog_manifest(catalog_manifest)
            with self.assertRaisesRegex(FreezeError, "relation split"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_importable_catalog_relation_is_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, _ = self.fixture(root)
            path = source / "catalog-relations.jsonl"
            write_jsonl(path, [])
            manifest_sha256 = refresh_manifest(source, path.name)
            with self.assertRaisesRegex(FreezeError, "catalog relation"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_unresolved_schema_is_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, _ = self.fixture(root)
            path = source / "unresolved-legacy-reviews.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            rows[0]["schema_version"] = "unexpected"
            write_jsonl(path, rows)
            manifest_sha256 = refresh_manifest(source, path.name)
            with self.assertRaisesRegex(FreezeError, "unexpected schema_version"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_production_credentials_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, _ = self.fixture(root)
            path = source / "excluded-legacy-reviews.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            rows[0]["evaluation"]["client-secret"] = "must-not-ship"
            write_jsonl(path, rows)
            manifest_sha256 = refresh_manifest(source, path.name)
            with self.assertRaisesRegex(FreezeError, "credential field is forbidden"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_source_evaluation_and_fan_out_closure_is_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, _ = self.fixture(root)
            path = source / "approved-legacy-reviews.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            rows[100]["source_evaluation_id"] = rows[99]["source_evaluation_id"]
            write_jsonl(path, rows)
            manifest_sha256 = refresh_manifest(source, path.name)
            with self.assertRaisesRegex(FreezeError, "fan-out closure mismatch"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_importable_schema_rejects_conflict_markers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, _ = self.fixture(root)
            path = source / "approved-legacy-reviews.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            rows[0]["manual_review_reasons"] = ["evidence_conflict"]
            write_jsonl(path, rows)
            manifest_sha256 = refresh_manifest(source, path.name)
            with self.assertRaisesRegex(FreezeError, "fixed schema fields"):
                _freeze(
                    source,
                    catalog_manifest,
                    root / "out",
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_report_uses_actual_exclusion_partition_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, _ = self.fixture(root)
            path = source / "excluded-legacy-reviews.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            rows[0]["evaluation"]["comment"] = ""
            rows[1]["evaluation"]["manual_review_reasons"] = ["evidence_conflict"]
            write_jsonl(path, rows)
            manifest_sha256 = refresh_manifest(source, path.name)
            output = root / "out"
            result = _freeze(
                source,
                catalog_manifest,
                output,
                expected_manifest_sha256=manifest_sha256,
                expected_catalog_content_sha256="catalog-hash",
            )
            report = (output / "ACCEPTANCE.md").read_text(encoding="utf-8")
            self.assertEqual(result["counts"]["blank"], 1)
            self.assertEqual(result["counts"]["evidenceConflict"], 1)
            self.assertIn("522 + 419 + 430 + 1 + 1 + 6", report)

    def test_public_freeze_does_not_allow_authority_overrides(self):
        self.assertEqual(
            list(signature(freeze).parameters),
            ["source_root", "catalog_manifest_path", "output_root"],
        )

    def test_jsonl_reader_preserves_unicode_line_separators_inside_comments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, _ = self.fixture(root)
            path = source / "approved-legacy-reviews.jsonl"
            rows = [
                json.loads(line)
                for line in path.read_text(encoding="utf-8").split("\n")
                if line
            ]
            rows[0]["comment"] = "before\u2028after"
            write_jsonl(path, rows)
            manifest_sha256 = refresh_manifest(source, path.name)
            output = root / "out"
            _freeze(
                source,
                catalog_manifest,
                output,
                expected_manifest_sha256=manifest_sha256,
                expected_catalog_content_sha256="catalog-hash",
            )
            first = json.loads(
                (output / "importable-legacy-reviews.jsonl")
                .read_text(encoding="utf-8")
                .split("\n")[0]
            )
            self.assertEqual(first["comment"], "before\u2028after")

    def test_existing_output_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, manifest_sha256 = self.fixture(root)
            output = root / "out"
            output.mkdir()
            with self.assertRaisesRegex(FreezeError, "refusing existing output"):
                _freeze(
                    source,
                    catalog_manifest,
                    output,
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )

    def test_repeated_freeze_is_byte_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, catalog_manifest, manifest_sha256 = self.fixture(root)
            first = root / "first"
            second = root / "second"
            for output in (first, second):
                _freeze(
                    source,
                    catalog_manifest,
                    output,
                    expected_manifest_sha256=manifest_sha256,
                    expected_catalog_content_sha256="catalog-hash",
                )
            first_files = {path.name: path.read_bytes() for path in first.iterdir()}
            second_files = {path.name: path.read_bytes() for path in second.iterdir()}
            self.assertEqual(first_files, second_files)
            self.assertEqual(
                json.loads(first_files["manifest.json"])["counts"]["importable"], 522
            )
            manifest = json.loads(first_files["manifest.json"])
            self.assertEqual(manifest["counts"]["catalogRelationUnavailable"], 419)
            self.assertEqual(
                manifest["schemas"]["catalog-identity-unresolved.jsonl"],
                "legacy-approved-unresolved-review-v1",
            )
            self.assertEqual(
                manifest["schemas"]["catalog-relation-unavailable.jsonl"],
                "legacy-approved-review-v1",
            )
            self.assertEqual(manifest["lineage"]["issue44"]["needsReviewRows"], 23)


if __name__ == "__main__":
    unittest.main()
