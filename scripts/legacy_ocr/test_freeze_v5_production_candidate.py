import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from compile_production_staging import sha256, write_json, write_jsonl
from freeze_v5_production_candidate import (
    SOURCE_CONTRACT,
    V5FreezeError,
    freeze_v5_production_candidate,
    sha256_text,
)


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def evaluation(key: str, course: str, teacher: str, body="已批准正文", **extra) -> dict:
    worksheet, row, column = key.split("|")
    row_payload = {
        "key": key,
        "worksheet": worksheet,
        "row": int(row),
        "column": column,
        "body": body,
        "body_source": "formula_bar",
        "course": course,
        "teacher": teacher,
        "cell_image": "H10-cell.jpg",
        "conflict_image": None,
        "approval_source": "auto_verify",
        "formula_bar_text_sha256": sha256_text(body),
    }
    row_payload.update(extra)
    return row_payload


def write_source(root: Path, rows: list[dict]) -> tuple[Path, str]:
    source = root / "source"
    source.mkdir()
    meta = write_jsonl(source / "evaluations.jsonl", rows)
    write_json(
        source / "manifest.json",
        {
            "contract_version": SOURCE_CONTRACT,
            "status": "completed",
            "wrote_tencent_or_business_db": False,
            "files": {"evaluations.jsonl": meta},
        },
    )
    return source, meta["sha256"]


def approved_record(record_type: str, value: dict) -> dict:
    return {
        "schemaVersion": "catalog-baseline-approved-record/v1",
        "recordType": record_type,
        "value": value,
    }


def write_catalog(
    root: Path,
    *,
    course_code="C001",
    course_name="货币银行学",
    teacher_label="孙爱琳",
    relation=True,
    extra_courses: list[dict] | None = None,
    extra_teachers: list[dict] | None = None,
    extra_relations: list[tuple[str, str]] | None = None,
) -> tuple[Path, dict[str, str]]:
    catalog = root / "catalog"
    catalog.mkdir()
    rows = [
        approved_record(
            "course",
            {
                "schemaVersion": "catalog-baseline-course/v1",
                "courseCode": course_code,
                "currentName": course_name,
                "normalizedCurrentName": course_name,
                "nameVariants": [],
                "category": "general",
                "sourceCategoryTexts": ["必修"],
            },
        ),
        approved_record(
            "teacher",
            {
                "schemaVersion": "catalog-baseline-teacher/v1",
                "sourceTeacherLabel": teacher_label,
                "normalizedTeacherLabel": teacher_label,
            },
        ),
    ]
    for course in extra_courses or []:
        rows.append(approved_record("course", course))
    for teacher in extra_teachers or []:
        rows.append(approved_record("teacher", teacher))
    if relation:
        rows.append(
            approved_record(
                "relation",
                {
                    "schemaVersion": "catalog-baseline-relation/v2",
                    "courseCode": course_code,
                    "sourceTeacherLabel": teacher_label,
                    "provenance": [{"queryId": "q"}],
                },
            )
        )
    for code, label in extra_relations or []:
        rows.append(
            approved_record(
                "relation",
                {
                    "schemaVersion": "catalog-baseline-relation/v2",
                    "courseCode": code,
                    "sourceTeacherLabel": label,
                    "provenance": [{"queryId": "q"}],
                },
            )
        )
    artifact = b"".join((canonical(row) + "\n").encode() for row in rows)
    (catalog / "catalog-baseline.jsonl").write_bytes(artifact)
    artifact_sha = hashlib.sha256(artifact).hexdigest()
    manifest = {
        "schemaVersion": "catalog-baseline-approved-manifest/v1",
        "status": "package_ready",
        "counts": {
            "courses": 1 + len(extra_courses or []),
            "teachers": 1 + len(extra_teachers or []),
            "relations": int(relation) + len(extra_relations or []),
            "totalRecords": len(rows),
        },
        "artifact": {
            "path": "catalog-baseline.jsonl",
            "records": len(rows),
            "bytes": len(artifact),
            "sha256": artifact_sha,
        },
        "contentSha256": "b" * 64,
    }
    (catalog / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return catalog, {
        "content": "b" * 64,
        "manifest": sha256(catalog / "manifest.json"),
        "artifact": artifact_sha,
    }


def write_imported(root: Path, rows: list[dict], relative="already.jsonl") -> Path:
    imported = root / "imported"
    imported.mkdir(exist_ok=True)
    path = imported / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    write_jsonl(path, rows)
    return imported


def course(code: str, name: str) -> dict:
    return {
        "schemaVersion": "catalog-baseline-course/v1",
        "courseCode": code,
        "currentName": name,
        "normalizedCurrentName": name,
        "nameVariants": [],
        "category": "general",
        "sourceCategoryTexts": ["体育"],
    }


def freeze(root: Path, rows: list[dict], imported: list[dict], **catalog_kwargs):
    source, evaluations_sha = write_source(root, rows)
    catalog, hashes = write_catalog(root, **catalog_kwargs)
    imported_root = write_imported(root, imported)
    return freeze_v5_production_candidate(
        source,
        catalog,
        imported_root,
        root / "out",
        expected_evaluations_sha256=evaluations_sha,
        expected_rows=len(rows),
        expected_catalog_content_sha256=hashes["content"],
        expected_catalog_manifest_sha256=hashes["manifest"],
        expected_catalog_artifact_sha256=hashes["artifact"],
        imported_packages=(("already.jsonl", len(imported)),),
    )


class FreezeV5ProductionCandidateTests(unittest.TestCase):
    def test_imports_exact_catalog_relation_without_rewriting_body(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            body = "公式栏原文\n\n"
            manifest = freeze(
                root,
                [evaluation("主要课程|173|F", "货币银行学", "孙爱琳", body=body)],
                [],
            )
            rows = [
                json.loads(line)
                for line in (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(manifest["contractVersion"], "legacy-v5-historical-freeze-v1")
            self.assertEqual(manifest["counts"]["importable"], 1)
            self.assertEqual(manifest["counts"]["excluded"], 0)
            self.assertEqual(rows[0]["comment"], body)
            self.assertEqual(rows[0]["catalog_course_code"], "C001")
            self.assertEqual(rows[0]["catalog_teacher_label"], "孙爱琳")
            self.assertEqual(rows[0]["worksheet"], "主要课程")
            self.assertEqual(rows[0]["source_row"], 173)
            self.assertEqual(rows[0]["source_column"], "F")
            self.assertEqual(rows[0]["schema_version"], "legacy-approved-review-v1")
            self.assertTrue(rows[0]["review_id"].startswith("legacy-review-"))

    def test_pending_relation_is_not_importable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [evaluation("主要课程|180|F", "跨文化商务沟通", "缪丽")],
                [],
                course_name="跨文化商务沟通",
                teacher_label="缪丽",
                relation=False,
            )
            importable = (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8")
            pending = [
                json.loads(line)
                for line in (root / "out" / "catalog-relation-pending.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(importable, "")
            self.assertEqual(pending[0]["request_kind"], "relation")
            self.assertEqual(pending[0]["catalog_teacher_label"], "缪丽")
            self.assertEqual(pending[0]["keys"], ["主要课程|180|F"])
            self.assertEqual(pending[0]["terminal_status"], "owner_review_required")

    def test_excludes_already_imported_keys_and_unmatched_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [
                    evaluation("主要课程|21|F", "货币银行学", "孙爱琳"),
                    evaluation("大英和视听说|10|H", "大英和视听说", "张晓花"),
                ],
                [
                    {
                        "worksheet": "主要课程",
                        "source_row": 21,
                        "source_column": "F",
                        "review_id": "legacy-review-old",
                    }
                ],
                extra_teachers=[
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "张晓花",
                        "normalizedTeacherLabel": "张晓花",
                    }
                ],
            )
            excluded = [
                json.loads(line)
                for line in (root / "out" / "excluded.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            reasons = {row["key"]: row["reason"] for row in excluded}
            self.assertEqual(reasons["主要课程|21|F"], "already_imported")
            self.assertEqual(reasons["大英和视听说|10|H"], "catalog_identity_unmatched")
            unresolved = [
                json.loads(line)
                for line in (root / "out" / "catalog-identity-excluded.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(unresolved[0]["legacy_source_label"], "大英和视听说")
            self.assertEqual(unresolved[0]["terminal_status"], "excluded_no_guess")

    def test_binds_pe_public_display_family_when_teacher_relation_is_unique(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [evaluation("体育课|8|D", "羽毛球", "程荣辉")],
                [],
                course_code="1005001892",
                course_name="羽毛球1",
                teacher_label="程荣辉",
                extra_courses=[course("1005001912", "羽毛球2")],
            )
            rows = [
                json.loads(line)
                for line in (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(rows[0]["catalog_course_code"], "1005001892")
            self.assertEqual(rows[0]["decision_basis"], "pe_public_display_unique")

    def test_rejects_hash_mismatch_and_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, evaluations_sha = write_source(
                root, [evaluation("主要课程|173|F", "货币银行学", "孙爱琳")]
            )
            catalog, hashes = write_catalog(root)
            imported_root = write_imported(root, [])
            kwargs = {
                "expected_evaluations_sha256": evaluations_sha,
                "expected_rows": 1,
                "expected_catalog_content_sha256": hashes["content"],
                "expected_catalog_manifest_sha256": hashes["manifest"],
                "expected_catalog_artifact_sha256": hashes["artifact"],
                "imported_packages": (("already.jsonl", 0),),
            }
            with self.assertRaises(V5FreezeError):
                freeze_v5_production_candidate(
                    source,
                    catalog,
                    imported_root,
                    root / "out",
                    **{**kwargs, "expected_evaluations_sha256": "0" * 64},
                )
            freeze_v5_production_candidate(source, catalog, imported_root, root / "out", **kwargs)
            with self.assertRaises(V5FreezeError):
                freeze_v5_production_candidate(
                    source, catalog, imported_root, root / "out", **kwargs
                )

    def test_refuses_to_guess_abbreviated_course_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [evaluation("思政课|8|F", "毛概", "某老师")],
                [],
                extra_courses=[
                    course("1012100085", "毛泽东思想和中国特色社会主义理论体系概论"),
                ],
                extra_teachers=[
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "某老师",
                        "normalizedTeacherLabel": "某老师",
                    }
                ],
                extra_relations=[("1012100085", "某老师")],
            )
            importable = (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8")
            excluded = [
                json.loads(line)
                for line in (root / "out" / "excluded.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(importable, "")
            self.assertEqual(excluded[0]["reason"], "catalog_identity_unmatched")

    def test_refuses_protected_output_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, evaluations_sha = write_source(
                root, [evaluation("主要课程|173|F", "货币银行学", "孙爱琳")]
            )
            catalog, hashes = write_catalog(root)
            imported_root = write_imported(root, [])
            with self.assertRaises(V5FreezeError):
                freeze_v5_production_candidate(
                    source,
                    catalog,
                    imported_root,
                    root / "review-approved-20260820-v5",
                    expected_evaluations_sha256=evaluations_sha,
                    expected_rows=1,
                    expected_catalog_content_sha256=hashes["content"],
                    expected_catalog_manifest_sha256=hashes["manifest"],
                    expected_catalog_artifact_sha256=hashes["artifact"],
                    imported_packages=(("already.jsonl", 0),),
                )


if __name__ == "__main__":
    unittest.main()
