import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from compile_production_staging import API_CATEGORIES, api_evidence_compatible, catalog_mapping, compile_batches, stage_package


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def evaluation(key: str, *, reasons=None, comment="正文", ocr_text="OCR", confidence=0.9) -> dict:
    return {
        "schema_version": "historical-evaluation-v1",
        "dataset_version": "fixture-v1",
        "evaluation_id": f"evaluation-{key:0>32}",
        "review_status": "needs_review" if reasons else "candidate",
        "manual_review_reasons": reasons or [],
        "worksheet": "主要课程", "source_row": int(key), "source_column": "F",
        "course_id": "course-a", "course_name": "课程甲",
        "teacher_id": "teacher-a", "teacher_name": "教师甲",
        "comment": comment, "context_inherited_from_row": None,
        "review_conclusion": "arbitrated", "review_selected": "analysis_a",
        "review_uncertainty_markers": [], "context_uncertainty_markers": [],
        "context_raw": "course=课程甲\nteacher=教师甲", "context_conclusion": "agreed",
        "source": {
            "capture_manifest_sha256": "a" * 64,
            "review_source_file": "主要课程/source.png", "review_source_sha256": "b" * 64,
            "review_bbox": [1, 2, 3, 4], "review_crop_sha256": "c" * 64,
            "ocr_text": ocr_text, "ocr_confidence": confidence,
            "ocr_tokens": [] if not ocr_text else [{"text": ocr_text, "confidence": confidence}],
            "context_source_file": "主要课程/context.png", "context_source_sha256": "d" * 64,
            "context_bbox": [1, 2, 3, 4], "context_crop_sha256": "e" * 64,
        },
    }


def fixture_package(root: Path) -> None:
    rows = [
        evaluation("1"),
        evaluation("2", ocr_text="", confidence=None),
        evaluation("3", reasons=["review_uncertain"]),
        evaluation("4", reasons=["comment_blank"], comment=""),
    ]
    objects = {
        "historical_evaluations.fixture-v1.jsonl": rows,
        "courses.fixture-v1.jsonl": [{"course_id": "course-a", "name": "课程甲"}],
        "teachers.fixture-v1.jsonl": [{"teacher_id": "teacher-a", "name": "教师甲"}],
        "course_teachers.fixture-v1.jsonl": [{"relation_id": "relation-a", "course_id": "course-a", "teacher_id": "teacher-a"}],
        "capture_gaps.fixture-v1.jsonl": [],
    }
    files = {}
    for name, values in objects.items():
        path = root / name
        write_jsonl(path, values)
        files[name] = {"rows": len(values), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    (root / "package-manifest.json").write_text(json.dumps({
        "contract_version": "legacy-review-package-v1", "dataset_version": "fixture-v1", "files": files,
    }), encoding="utf-8")


class CompileProductionStagingTests(unittest.TestCase):
    def test_catalog_mapping_accepts_only_the_new_category_enum(self):
        self.assertEqual(API_CATEGORIES, {"general", "sports"})
        with tempfile.TemporaryDirectory() as temporary:
            mapping = Path(temporary) / "mapping.jsonl"
            for category in sorted(API_CATEGORIES):
                write_jsonl(mapping, [{
                    "legacy_course_id": "course-a", "legacy_teacher_id": "teacher-a",
                    "database_course_id": 1, "database_teacher_id": 2, "category": category,
                }])
                self.assertEqual(catalog_mapping(mapping)[("course-a", "teacher-a")]["category"], category)
            write_jsonl(mapping, [{
                "legacy_course_id": "course-a", "legacy_teacher_id": "teacher-a",
                "database_course_id": 1, "database_teacher_id": 2, "category": "required",
            }])
            with self.assertRaisesRegex(ValueError, "invalid catalog category"):
                catalog_mapping(mapping)

    def test_stage_separates_ai_verified_api_ready_quarantine_and_blank(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); package = root / "package"; out = root / "out"
            package.mkdir(); fixture_package(package)
            manifest = stage_package(package, out)
            self.assertEqual(manifest["counts"], {
                "input_evaluations": 4, "ai_verified": 2, "api_ready": 1,
                "api_evidence_blocked": 1, "quarantined": 1, "excluded_blank": 1,
                "pending_external_review": 1,
            })
            self.assertEqual(manifest["closure"], {"input_evaluations_partitioned_once": True})
            approved = [json.loads(line) for line in (out / "ai-verified-evaluations.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual([row["approval_status"] for row in approved], ["ai_verified", "ai_verified"])
            self.assertEqual(len((out / "api-ready-evaluations.jsonl").read_text(encoding="utf-8").splitlines()), 1)

    def test_compile_batches_matches_current_api_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); package = root / "package"; staging = root / "staging"; out = root / "payloads"
            package.mkdir(); fixture_package(package); stage_package(package, staging)
            mapping = root / "mapping.jsonl"
            write_jsonl(mapping, [{
                "legacy_course_id": "course-a", "legacy_teacher_id": "teacher-a",
                "database_course_id": 11, "database_teacher_id": 22, "category": "general",
            }])
            manifest = compile_batches(staging, mapping, out)
            self.assertEqual(manifest["counts"], {"rows": 1, "batches": 1})
            payload = json.loads((out / "batch-0001.json").read_text(encoding="utf-8"))
            self.assertRegex(payload["idempotencyKey"], r"^[a-f0-9]{64}$")
            self.assertEqual(payload["rows"][0]["course_id"], 11)
            self.assertEqual(payload["rows"][0]["teacher_id"], 22)
            self.assertNotIn("overall", payload["rows"][0])
            self.assertEqual(payload["rows"][0]["source_type"], "legacy_ocr")

    def test_compile_rejects_missing_catalog_mapping(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); package = root / "package"; staging = root / "staging"
            package.mkdir(); fixture_package(package); stage_package(package, staging)
            mapping = root / "mapping.jsonl"; write_jsonl(mapping, [])
            with self.assertRaisesRegex(ValueError, "catalog mapping set mismatch"):
                compile_batches(staging, mapping, root / "payloads")

    def test_api_evidence_requires_nonempty_valid_tokens(self):
        row = evaluation("1")
        self.assertTrue(api_evidence_compatible(row))
        row["source"]["ocr_tokens"] = []
        self.assertFalse(api_evidence_compatible(row))
        row["source"]["ocr_tokens"] = [{"text": "OCR", "confidence": None}]
        self.assertFalse(api_evidence_compatible(row))

    def test_compile_requires_exact_full_mapping_template(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); package = root / "package"; staging = root / "staging"
            package.mkdir(); fixture_package(package); stage_package(package, staging)
            template_path = staging / "catalog-mapping-required.jsonl"
            template_rows = [json.loads(line) for line in template_path.read_text(encoding="utf-8").splitlines()]
            template_rows.append({
                "legacy_course_id": "course-b", "legacy_course_name": "课程乙",
                "legacy_teacher_id": "teacher-b", "legacy_teacher_name": "教师乙",
                "database_course_id": None, "database_teacher_id": None, "category": None,
            })
            write_jsonl(template_path, template_rows)
            manifest_path = staging / "production-staging-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["files"]["catalog-mapping-required.jsonl"] = {
                "rows": len(template_rows), "sha256": hashlib.sha256(template_path.read_bytes()).hexdigest(),
            }
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            mapping = root / "mapping.jsonl"
            write_jsonl(mapping, [{
                "legacy_course_id": "course-a", "legacy_teacher_id": "teacher-a",
                "database_course_id": 11, "database_teacher_id": 22, "category": "general",
            }])
            with self.assertRaisesRegex(ValueError, "catalog mapping set mismatch"):
                compile_batches(staging, mapping, root / "payloads")

    def test_stage_rejects_tampered_package_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); package = root / "package"; package.mkdir(); fixture_package(package)
            with (package / "historical_evaluations.fixture-v1.jsonl").open("a", encoding="utf-8") as handle:
                handle.write("{}\n")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                stage_package(package, root / "out")


if __name__ == "__main__":
    unittest.main()
