import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from compile_formula_bar_rebuild import (
    acknowledged_halt,
    content_hash,
    full_scan_keys,
    missing_evaluation,
    rebuild_package,
    validate_full_scan_audit,
)
from compile_production_staging import compile_batches, stage_package


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def write_jsonl(path: Path, rows):
    path.write_bytes(b"".join(json_bytes(row) for row in rows))


def evaluation(column, row, comment, *, evaluation_id=None):
    return {
        "schema_version": "historical-evaluation-v1", "dataset_version": "base-v1",
        "evaluation_id": evaluation_id or f"evaluation-{row:04d}{column.lower():0>27}",
        "review_status": "candidate", "manual_review_reasons": [],
        "worksheet": "数学课", "source_row": row, "source_column": column,
        "course_id": "course-a", "course_name": "课程甲", "teacher_id": "teacher-a", "teacher_name": "教师甲",
        "comment": comment, "context_inherited_from_row": None,
        "review_conclusion": "arbitrated", "review_selected": "analysis_a",
        "review_uncertainty_markers": [], "context_uncertainty_markers": [],
        "context_raw": "course=课程甲\nteacher=教师甲", "context_conclusion": "agreed",
        "source": {
            "capture_manifest_sha256": "a" * 64, "review_source_file": "source.png",
            "review_source_sha256": "b" * 64, "review_bbox": [1, 2, 3, 4], "review_crop_sha256": "c" * 64,
            "ocr_text": comment, "ocr_confidence": 0.8, "ocr_tokens": [{"text": comment, "confidence": 0.8}],
            "context_source_file": "context.png", "context_source_sha256": "d" * 64,
            "context_bbox": [1, 2, 3, 4], "context_crop_sha256": "e" * 64,
        },
    }


def fixture_package(root: Path):
    evaluations = [
        evaluation("D", 10, "截断旧文"),
        evaluation("E", 10, "从左侧横向显示"),
        evaluation("D", 11, "相同正文"),
        evaluation("E", 11, "相同正文"),
        evaluation("F", 11, "冲突旧文"),
    ]
    objects = {
        "historical_evaluations.base-v1.jsonl": evaluations,
        "courses.base-v1.jsonl": [{"course_id": "course-a", "name": "课程甲", "aliases": ["甲课"]}],
        "teachers.base-v1.jsonl": [{"teacher_id": "teacher-a", "name": "教师甲", "aliases": ["甲师"]}],
        "course_teachers.base-v1.jsonl": [{"relation_id": "relation-a", "course_id": "course-a", "teacher_id": "teacher-a"}],
        "capture_gaps.base-v1.jsonl": [],
    }
    files = {}
    for name, rows in objects.items():
        write_jsonl(root / name, rows)
        files[name] = {"rows": len(rows), "sha256": hashlib.sha256((root / name).read_bytes()).hexdigest()}
    (root / "package-manifest.json").write_bytes(json_bytes({"contract_version": "legacy-review-package-v1", "dataset_version": "base-v1", "files": files}))
    return objects


def evidence(root: Path, column, row, status, value, visible):
    key = f"数学课|{row}|{column}"
    image = root / f"{column}{row}.png"
    image.write_bytes(f"image:{key}".encode())
    image_ref = {"kind": "cell", "path": image.name, "sha256": hashlib.sha256(image.read_bytes()).hexdigest()}
    conflict_ref = None
    correspondence = "visible_text_matches_formula"
    reason = None
    if status == "horizontal_overflow_blank":
        correspondence = "formula_empty_visible_text"
    elif status == "ordinary_blank":
        correspondence = "both_empty"
    elif status == "evidence_conflict":
        correspondence = "visible_text_conflicts_with_formula"
        reason = "visible_text_formula_mismatch"
        conflict = root / f"{column}{row}.conflict.png"
        conflict.write_bytes(f"conflict:{key}".encode())
        conflict_ref = {"kind": "conflict", "path": conflict.name, "sha256": hashlib.sha256(conflict.read_bytes()).hexdigest()}
    content = {
        "contract_version": "formula-bar-cell-evidence-v1", "key": key, "worksheet": "数学课", "row": row,
        "column": column, "target_address": f"{column}{row}", "active_addresses": [f"{column}{row}", f"{column}{row}"],
        "formula_bar_reads": [
            {"sequence": 1, "value": value, "sha256": hashlib.sha256(value.encode()).hexdigest()},
            {"sequence": 2, "value": value, "sha256": hashlib.sha256(value.encode()).hexdigest()},
        ],
        "formula_bar_value": value, "formula_bar_text_sha256": hashlib.sha256(value.encode()).hexdigest(),
        "formula_bar_nonempty": bool(value), "visible_cell_text": visible,
        "visible_cell_text_sha256": hashlib.sha256(visible.encode()).hexdigest(), "correspondence": correspondence,
        "terminal_status": status, "conflict_reason": reason, "halt_batch": False, "read_only": True,
        "captured_at": "2026-07-29T00:00:00.000Z", "evidence": {"cell_image": image_ref, "conflict_image": conflict_ref},
    }
    record = {**content, "record_sha256": content_hash(content)}
    path = root / f"{column}{row}.json"
    path.write_bytes(json_bytes(record))
    return path, record


def fixture_evidence(root: Path):
    definitions = [
        ("D", 10, "review_origin", "公式栏完整原文", "公式栏完整"),
        ("E", 10, "horizontal_overflow_blank", "", "公式栏完整原文"),
        ("F", 10, "review_origin", "新发现评价", "新发现"),
        ("D", 11, "review_origin", "相同正文", "相同正文"),
        ("E", 11, "review_origin", "相同正文", "相同正文"),
        ("F", 11, "evidence_conflict", "公式正文", "不对应正文"),
        ("G", 11, "ordinary_blank", "", ""),
    ]
    files = {}
    records = []
    for definition in definitions:
        path, record = evidence(root, *definition)
        files[path.name] = {"key": record["key"], "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        records.append(record)
    manifest = {
        "contract_version": "formula-bar-evidence-set-v1", "dataset_version": "fixture-evidence-v1",
        "source_locator_plan_sha256": "f" * 64, "evidence_count": len(records), "files": files,
    }
    (root / "evidence-manifest.json").write_bytes(json_bytes(manifest))
    return records


def read_declared(root: Path, prefix: str):
    manifest = json.loads((root / "package-manifest.json").read_text(encoding="utf-8"))
    name = next(name for name in manifest["files"] if name.startswith(prefix + "."))
    return [json.loads(line) for line in (root / name).read_text(encoding="utf-8").splitlines() if line]


class FormulaBarRebuildTests(unittest.TestCase):
    def test_only_address_bound_conflicts_can_be_acknowledged_halts(self):
        conflict = {
            "halt_batch": True,
            "terminal_status": "evidence_conflict",
            "conflict_reason": "active_address_mismatch",
            "evidence": {"conflict_image": {"kind": "conflict"}},
        }
        self.assertTrue(acknowledged_halt(conflict))
        self.assertFalse(acknowledged_halt({**conflict, "conflict_reason": "visible_text_formula_mismatch"}))
        self.assertFalse(acknowledged_halt({**conflict, "evidence": {"conflict_image": None}}))
        self.assertFalse(acknowledged_halt({**conflict, "halt_batch": False}))

    def test_frozen_full_scan_contract_requires_audit_for_14985_records(self):
        keys = full_scan_keys()
        self.assertEqual(len(keys), 14_985)
        self.assertEqual(len(set(keys)), 14_985)
        self.assertEqual(keys[0], "主要课程|19|F")
        self.assertEqual(keys[-1], "体育课|211|K")
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "lacks full-scan audit"):
                validate_full_scan_audit(Path(temporary), {}, [{}] * 14_985)

    def test_evidence_to_overlay_package_staging_batch_and_report_close(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / "base"; evidence_root = root / "evidence"
            base.mkdir(); evidence_root.mkdir(); original = fixture_package(base); fixture_evidence(evidence_root)
            package = root / "rebuilt"
            result = rebuild_package(base, evidence_root, package, "formula-v1")
            rows = read_declared(package, "historical_evaluations")
            by_key = {f"{row['worksheet']}|{row['source_row']}|{row['source_column']}": row for row in rows}

            self.assertEqual(by_key["数学课|10|D"]["comment"], "公式栏完整原文")
            self.assertEqual(by_key["数学课|10|E"]["comment"], "")
            self.assertEqual(by_key["数学课|10|F"]["manual_review_reasons"], ["formula_bar_missing_evaluation"])
            self.assertEqual([by_key[key]["comment"] for key in ("数学课|11|D", "数学课|11|E")], ["相同正文", "相同正文"])
            self.assertNotEqual(by_key["数学课|11|D"]["evaluation_id"], by_key["数学课|11|E"]["evaluation_id"])
            self.assertIn("evidence_conflict", by_key["数学课|11|F"]["manual_review_reasons"])
            self.assertNotIn("数学课|11|G", by_key)
            for prefix in ("courses", "teachers", "course_teachers", "capture_gaps"):
                self.assertEqual(read_declared(package, prefix), original[next(name for name in original if name.startswith(prefix + "."))])
            self.assertEqual(result["report"]["counts"]["evidence"], 7)
            self.assertTrue(all(result["report"]["closure"].values()))

            staging = root / "staging"
            staging_manifest = stage_package(package, staging)
            self.assertEqual(staging_manifest["counts"], {
                "input_evaluations": 6, "ai_verified": 3, "api_ready": 3, "api_evidence_blocked": 0,
                "quarantined": 2, "excluded_blank": 1, "pending_external_review": 1,
            })
            mapping = root / "mapping.jsonl"
            write_jsonl(mapping, [{"legacy_course_id": "course-a", "legacy_teacher_id": "teacher-a", "database_course_id": 11, "database_teacher_id": 22, "category": "general"}])
            batches = root / "batches"
            import_manifest = compile_batches(staging, mapping, batches)
            self.assertEqual(import_manifest["counts"], {"rows": 3, "batches": 1})
            payload = json.loads((batches / "batch-0001.json").read_text(encoding="utf-8"))
            self.assertEqual([row["comment"] for row in payload["rows"]], ["公式栏完整原文", "相同正文", "相同正文"])
            self.assertTrue(all(row["source_type"] == "legacy_formula_bar" for row in payload["rows"]))

    def test_same_inputs_are_byte_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / "base"; ev = root / "evidence"; base.mkdir(); ev.mkdir()
            fixture_package(base); fixture_evidence(ev)
            first, second = root / "first", root / "second"
            rebuild_package(base, ev, first, "formula-v1"); rebuild_package(base, ev, second, "formula-v1")
            tree = lambda root: {str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()}
            self.assertEqual(tree(first), tree(second))

    def test_tampering_stale_hashes_and_duplicate_keys_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / "base"; ev = root / "evidence"; base.mkdir(); ev.mkdir()
            fixture_package(base); fixture_evidence(ev)
            record_path = ev / "D10.json"
            record = json.loads(record_path.read_text(encoding="utf-8")); record["formula_bar_value"] = "被篡改"
            record_path.write_bytes(json_bytes(record))
            manifest = json.loads((ev / "evidence-manifest.json").read_text(encoding="utf-8"))
            manifest["files"]["D10.json"]["sha256"] = hashlib.sha256(record_path.read_bytes()).hexdigest()
            (ev / "evidence-manifest.json").write_bytes(json_bytes(manifest))
            with self.assertRaisesRegex(ValueError, "evidence hash mismatch"):
                rebuild_package(base, ev, root / "tampered", "formula-v1")

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / "base"; ev = root / "evidence"; base.mkdir(); ev.mkdir()
            fixture_package(base); fixture_evidence(ev)
            manifest = json.loads((ev / "evidence-manifest.json").read_text(encoding="utf-8"))
            manifest["files"]["D10.json"]["key"] = "数学课|10|Z"
            (ev / "evidence-manifest.json").write_bytes(json_bytes(manifest))
            with self.assertRaisesRegex(ValueError, "stale formula-bar evidence manifest key"):
                rebuild_package(base, ev, root / "stale", "formula-v1")

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / "base"; ev = root / "evidence"; base.mkdir(); ev.mkdir()
            fixture_package(base); fixture_evidence(ev)
            duplicate = json.loads((base / "historical_evaluations.base-v1.jsonl").read_text(encoding="utf-8").splitlines()[0])
            with (base / "historical_evaluations.base-v1.jsonl").open("ab") as handle:
                handle.write(json_bytes(duplicate))
            manifest = json.loads((base / "package-manifest.json").read_text(encoding="utf-8"))
            file_meta = manifest["files"]["historical_evaluations.base-v1.jsonl"]
            file_meta.update(rows=file_meta["rows"] + 1, sha256=hashlib.sha256((base / "historical_evaluations.base-v1.jsonl").read_bytes()).hexdigest())
            (base / "package-manifest.json").write_bytes(json_bytes(manifest))
            with self.assertRaisesRegex(ValueError, "duplicate historical evaluation source key"):
                rebuild_package(base, ev, root / "duplicate", "formula-v1")

    def test_staging_rejects_forged_formula_provenance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / "base"; ev = root / "evidence"; base.mkdir(); ev.mkdir()
            fixture_package(base); fixture_evidence(ev)
            package = root / "rebuilt"; rebuild_package(base, ev, package, "formula-v1")
            manifest_path = package / "package-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            name = next(name for name in manifest["files"] if name.startswith("historical_evaluations."))
            rows = [json.loads(line) for line in (package / name).read_text(encoding="utf-8").splitlines()]
            rows[0]["source"]["formula_bar"]["record_sha256"] = "0" * 64
            write_jsonl(package / name, rows)
            manifest["files"][name]["sha256"] = hashlib.sha256((package / name).read_bytes()).hexdigest()
            manifest_path.write_bytes(json_bytes(manifest))
            with self.assertRaisesRegex(ValueError, "formula-bar package provenance mismatch"):
                stage_package(package, root / "staging")

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / "base"; ev = root / "evidence"; base.mkdir(); ev.mkdir()
            fixture_package(base); fixture_evidence(ev)
            package = root / "rebuilt"; rebuild_package(base, ev, package, "formula-v1")
            manifest_path = package / "package-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            image_name = next(name for name, meta in manifest["files"].items() if name.startswith("formula_bar_images/") and meta.get("kind") == "binary")
            image_path = package / image_name; image_path.write_bytes(b"forged image")
            manifest["files"][image_name].update(bytes=image_path.stat().st_size, sha256=hashlib.sha256(image_path.read_bytes()).hexdigest())
            manifest_path.write_bytes(json_bytes(manifest))
            with self.assertRaisesRegex(ValueError, "formula-bar package provenance mismatch"):
                stage_package(package, root / "staging")

    def test_missing_evaluation_with_ambiguous_peers_is_deterministically_unclear(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); root.mkdir(exist_ok=True)
            _, record = evidence(root, "F", 12, "review_origin", "漏项", "漏项")
            first = evaluation("D", 12, "甲"); second = evaluation("E", 12, "乙")
            second.update(course_id="course-b", course_name="课程乙", teacher_id="teacher-b", teacher_name="教师乙")
            forward = missing_evaluation(record, [first, second], "formula-v1", "f" * 64)
            reverse = missing_evaluation(record, [second, first], "formula-v1", "f" * 64)
            self.assertEqual(forward, reverse)
            self.assertIsNone(forward["course_id"]); self.assertIsNone(forward["teacher_id"])
            self.assertEqual(forward["course_name"], "[unclear]")


if __name__ == "__main__":
    unittest.main()
