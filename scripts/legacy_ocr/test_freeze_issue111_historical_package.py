import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from freeze_issue111_historical_package import (
    APPROVED_CATALOG_CONTENT_SHA256,
    EXPECTED_RELATIONS,
    EXPECTED_REVIEWS,
    FREEZE_CONTRACT,
    Issue111FreezeError,
    freeze_issue111_package,
)


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def write_json(path: Path, value) -> None:
    path.write_text(canonical(value) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict]) -> dict:
    path.write_text("".join(f"{canonical(row)}\n" for row in rows), encoding="utf-8")
    return {"rows": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def review(index: int, course: str, teacher: str, **extra) -> dict:
    row = {
        "schema_version": "legacy-approved-review-v1",
        "review_id": f"legacy-review-{index:03d}",
        "source_evaluation_id": f"evaluation-{index:03d}",
        "catalog_course_code": course,
        "catalog_teacher_label": teacher,
        "category": "general",
        "comment": f"已批准正文 {index}",
        "decision_basis": "preserve_via_catalog_addition_request",
        "duplicate_group": None,
        "proposed_teacher_label": None,
        "source_column": "F",
        "source_row": index,
        "worksheet": "主要课程",
    }
    row.update(extra)
    return row


class FreezeIssue111HistoricalPackageTests(unittest.TestCase):
    def package(self, root: Path, *, extra_review=None, isolated=False) -> Path:
        source = root / "source"
        source.mkdir()
        requests = [
            {
                "schema_version": "legacy-catalog-addition-request-v1",
                "request_kind": "relation",
                "catalog_course_code": f"C{index:03d}",
                "catalog_teacher_label": f"T{index:03d}",
                "reason": "approved_catalog_relation_missing",
                "terminal_status": "owner_review_required",
            }
            for index in range(EXPECTED_RELATIONS)
        ]
        reviews = [
            review(index, f"C{index % EXPECTED_RELATIONS:03d}", f"T{index % EXPECTED_RELATIONS:03d}")
            for index in range(EXPECTED_REVIEWS)
        ]
        if isolated:
            reviews[0]["source_bucket"] = "keep-isolated"
        if extra_review:
            reviews.append(extra_review)
        request_meta = write_jsonl(source / "catalog-addition-requests.jsonl", requests)
        review_meta = write_jsonl(source / "reviews.jsonl", reviews)
        write_json(
            source / "manifest.json",
            {
                "contract_version": "legacy-issue111-relation-addition-v1",
                "counts": {
                    "relations": EXPECTED_RELATIONS,
                    "reviews": EXPECTED_REVIEWS if not extra_review else EXPECTED_REVIEWS + 1,
                },
                "files": {
                    "catalog-addition-requests.jsonl": request_meta,
                    "reviews.jsonl": review_meta,
                },
            },
        )
        return source

    def test_freezes_only_the_164_official_reviews(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.package(root)
            out = root / "out"
            manifest = freeze_issue111_package(source, out)
            rows = [
                json.loads(line)
                for line in (out / "importable-legacy-reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(manifest["contractVersion"], FREEZE_CONTRACT)
            self.assertEqual(manifest["counts"], {"importable": 164, "relations": 61})
            self.assertEqual(len(rows), 164)
            self.assertEqual(rows[0]["comment"], "已批准正文 0")
            self.assertEqual(rows[0]["review_id"], "legacy-review-000")
            self.assertEqual(
                manifest["lineage"]["approvedCatalogContentSha256"],
                APPROVED_CATALOG_CONTENT_SHA256,
            )
            self.assertNotIn("catalog-relation-unavailable.jsonl", manifest["files"])

    def test_rejects_isolated_bucket_and_unbound_pairs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(Issue111FreezeError):
                freeze_issue111_package(self.package(root, isolated=True), root / "isolated")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            extra = review(999, "OTHER", "Someone")
            with self.assertRaises(Issue111FreezeError):
                freeze_issue111_package(self.package(root, extra_review=extra), root / "extra")

    def test_rejects_abandoned_no_course_bucket(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.package(root)
            reviews = [
                json.loads(line)
                for line in (source / "reviews.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            reviews[1]["source_bucket"] = "abandoned-no-course"
            (source / "reviews.jsonl").write_text(
                "".join(f"{canonical(row)}\n" for row in reviews), encoding="utf-8"
            )
            manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
            manifest["files"]["reviews.jsonl"] = {
                "rows": len(reviews),
                "sha256": hashlib.sha256((source / "reviews.jsonl").read_bytes()).hexdigest(),
            }
            (source / "manifest.json").write_text(canonical(manifest) + "\n", encoding="utf-8")
            with self.assertRaises(Issue111FreezeError):
                freeze_issue111_package(source, root / "abandoned")


if __name__ == "__main__":
    unittest.main()
