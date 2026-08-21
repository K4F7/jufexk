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
    is_modified_college_english,
    is_plain_college_english,
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


def freeze(root: Path, rows: list[dict], imported: list[dict], teacher_overrides=None, **catalog_kwargs):
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
        teacher_overrides=teacher_overrides,
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
            self.assertEqual(rows[0]["decision_basis"], "pe_one_teacher_one_course")

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

    def test_binds_official_political_alias_when_teacher_relation_is_unique(self) -> None:
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
            rows = [
                json.loads(line)
                for line in (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(rows[0]["catalog_course_code"], "1012100085")
            self.assertEqual(rows[0]["decision_basis"], "existing_catalog_relation")

    def test_refuses_protected_output_directory(self) -> None:
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
            for blocked in (
                "review-approved-20260820-v5",
                "frozen-historical-v5-candidate-v1",
                "frozen-historical-v5-candidate-v2",
                "frozen-historical-v5-candidate-v3",
            ):
                with self.assertRaises(V5FreezeError):
                    freeze_v5_production_candidate(
                        source,
                        catalog,
                        imported_root,
                        root / blocked,
                        **kwargs,
                    )

    def test_maps_football69_and_sanda_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [
                    evaluation("体育课|48|D", "足球69", "谭刚"),
                    evaluation("体育课|31|D", "散打上课", "甲"),
                ],
                [],
                course_code="1005002252",
                course_name="足球1",
                teacher_label="谭刚",
                extra_courses=[
                    course("1005002262", "足球2"),
                    course("1005002662", "散打"),
                ],
                extra_teachers=[
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "甲",
                        "normalizedTeacherLabel": "甲",
                    }
                ],
                extra_relations=[
                    ("1005002262", "谭刚"),
                    ("1005002662", "甲"),
                ],
            )
            rows = [
                json.loads(line)
                for line in (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            by_row = {row["source_row"]: row for row in rows}
            self.assertEqual(by_row[48]["catalog_course_code"], "1005002252")
            self.assertEqual(by_row[31]["catalog_course_code"], "1005002662")

    def test_plain_college_english_does_not_treat_bare_name_as_level(self) -> None:
        self.assertTrue(is_plain_college_english("大学英语I"))
        self.assertFalse(is_plain_college_english("大学英语"))
        self.assertTrue(is_modified_college_english("大学英语"))
        self.assertTrue(is_modified_college_english("大学英语I(涉外)"))

    def test_english_binds_unique_teacher_course_and_prefers_level_one(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [
                    evaluation("大英和视听说|10|H", "大英和视听说", "张晓花"),
                    evaluation("大英和视听说|11|H", "大英和视听说", "张生萍"),
                ],
                [],
                extra_courses=[
                    course("1004600332", "大学英语III"),
                    course("1004600232", "大学英语I"),
                    course("1004600282", "大学英语II"),
                ],
                extra_teachers=[
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "张晓花",
                        "normalizedTeacherLabel": "张晓花",
                    },
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "张生萍",
                        "normalizedTeacherLabel": "张生萍",
                    },
                ],
                extra_relations=[
                    ("1004600332", "张晓花"),
                    ("1004600232", "张生萍"),
                    ("1004600282", "张生萍"),
                ],
            )
            rows = [
                json.loads(line)
                for line in (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            by_row = {row["source_row"]: row for row in rows}
            self.assertEqual(by_row[10]["catalog_course_code"], "1004600332")
            self.assertEqual(by_row[10]["decision_basis"], "english_teacher_unique")
            self.assertEqual(by_row[11]["catalog_course_code"], "1004600232")
            self.assertEqual(by_row[11]["decision_basis"], "english_teacher_level")
            self.assertEqual(len(rows), 2)

    def test_english_falls_back_modified_then_listening_and_ignores_oral(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [
                    evaluation("大英和视听说|12|H", "大英和视听说", "张洁琼"),
                    evaluation("大英和视听说|13|H", "大英和视听说", "王南"),
                    evaluation("大英和视听说|14|H", "大英和视听说", "张萍萍"),
                    evaluation("大英和视听说|15|H", "视听说", "史希平"),
                    evaluation("大英和视听说|16|H", "视听说", "余丽文"),
                ],
                [],
                extra_courses=[
                    course("1004600262", "大学英语I(涉外)"),
                    course("1004600362", "大学英语III(涉外)"),
                    course("1004600232", "大学英语I"),
                    course("1004603781", "英语视听说2"),
                    course("1004603801", "英语视听说3"),
                    course("1004603821", "英语视听说4"),
                    course("1004606732", "英语视听说"),
                    course("1004603642", "英语口语II"),
                ],
                extra_teachers=[
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "张洁琼",
                        "normalizedTeacherLabel": "张洁琼",
                    },
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "王南",
                        "normalizedTeacherLabel": "王南",
                    },
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "张萍萍",
                        "normalizedTeacherLabel": "张萍萍",
                    },
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "史希平",
                        "normalizedTeacherLabel": "史希平",
                    },
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "余丽文",
                        "normalizedTeacherLabel": "余丽文",
                    },
                ],
                extra_relations=[
                    ("1004600262", "张洁琼"),
                    ("1004600362", "张洁琼"),
                    ("1004606732", "张洁琼"),
                    ("1004603781", "王南"),
                    ("1004603801", "王南"),
                    ("1004606732", "王南"),
                    ("1004603642", "张萍萍"),
                    ("1004603821", "史希平"),
                    ("1004606732", "史希平"),
                    ("1004600232", "余丽文"),
                    ("1004603821", "余丽文"),
                ],
            )
            rows = [
                json.loads(line)
                for line in (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            excluded = [
                json.loads(line)
                for line in (root / "out" / "excluded.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            by_row = {row["source_row"]: row for row in rows}
            self.assertEqual(by_row[12]["catalog_course_code"], "1004600262")
            self.assertEqual(by_row[13]["catalog_course_code"], "1004603781")
            self.assertEqual(by_row[15]["catalog_course_code"], "1004603821")
            self.assertEqual(by_row[16]["catalog_course_code"], "1004603821")
            self.assertEqual([row["key"] for row in excluded], ["大英和视听说|14|H"])
            self.assertEqual(by_row[12]["decision_basis"], "english_teacher_level")
            self.assertEqual(by_row[16]["decision_basis"], "english_teacher_unique")

    def test_teacher_override_fills_blank_table_teacher(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [evaluation("主要课程|56|F", "音乐鉴赏", "")],
                [],
                teacher_overrides={("主要课程", 56): "孙爱琳"},
                course_name="音乐鉴赏",
            )
            rows = [
                json.loads(line)
                for line in (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(rows[0]["catalog_teacher_label"], "孙爱琳")
            self.assertEqual(rows[0]["catalog_course_code"], "C001")
            self.assertEqual(rows[0]["comment"], "已批准正文")

    def test_blank_teacher_without_override_stays_excluded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [
                    evaluation("主要课程|55|F", "音乐鉴赏", "郑洁"),
                    evaluation("主要课程|56|F", "音乐鉴赏", " "),
                ],
                [],
                extra_teachers=[
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "郑洁",
                        "normalizedTeacherLabel": "郑洁",
                    }
                ],
                extra_relations=[("C001", "郑洁")],
                course_name="音乐鉴赏",
            )
            excluded = [
                json.loads(line)
                for line in (root / "out" / "excluded.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            importable = [
                json.loads(line)
                for line in (root / "out" / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual([row["source_row"] for row in importable], [55])
            self.assertEqual(excluded[0]["reason"], "missing_teacher")
            self.assertEqual(excluded[0]["key"], "主要课程|56|F")

    def test_teacher_override_unmatched_uses_filled_label(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [evaluation("主要课程|56|F", "音乐鉴赏", "")],
                [],
                teacher_overrides={("主要课程", 56): "表上原名"},
                course_name="音乐鉴赏",
            )
            unresolved = [
                json.loads(line)
                for line in (root / "out" / "catalog-identity-excluded.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            excluded = [
                json.loads(line)
                for line in (root / "out" / "excluded.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            teacher_unresolved = [row for row in unresolved if row["identity_kind"] == "teacher"]
            self.assertEqual(teacher_unresolved[0]["legacy_source_label"], "表上原名")
            self.assertEqual(excluded[0]["reason"], "catalog_identity_unmatched")
            self.assertEqual(excluded[0]["legacy_teacher_name"], "表上原名")

    def test_does_not_split_annotated_english_teacher_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            freeze(
                root,
                [
                    evaluation("大英和视听说|36|H", "大英和视听说", "邱垂亿（大英）"),
                    evaluation("大英和视听说|9|H", "大英和视听说", "赵娟（经典英语视听说）"),
                ],
                [],
                extra_courses=[course("1004600232", "大学英语I")],
                extra_teachers=[
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "邱垂亿",
                        "normalizedTeacherLabel": "邱垂亿",
                    },
                    {
                        "schemaVersion": "catalog-baseline-teacher/v1",
                        "sourceTeacherLabel": "赵娟",
                        "normalizedTeacherLabel": "赵娟",
                    },
                ],
                extra_relations=[
                    ("1004600232", "邱垂亿"),
                    ("1004600232", "赵娟"),
                ],
            )
            excluded = [
                json.loads(line)
                for line in (root / "out" / "excluded.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(
                [row["key"] for row in excluded],
                ["大英和视听说|36|H", "大英和视听说|9|H"],
            )
            self.assertTrue(all(row["reason"] == "catalog_identity_unmatched" for row in excluded))


if __name__ == "__main__":
    unittest.main()
