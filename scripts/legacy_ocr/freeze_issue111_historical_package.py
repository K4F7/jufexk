from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from compile_production_staging import read_json, read_jsonl, sha256, write_json, write_jsonl


RELATION_CONTRACT = "legacy-issue111-relation-addition-v1"
FREEZE_CONTRACT = "legacy-issue111-historical-freeze-v1"
RECORD_SCHEMA = "legacy-approved-review-v1"
SOURCE_CONTRACT = "legacy-historical-approved-package-v1"
APPROVED_PACKAGE_MANIFEST_SHA256 = (
    "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af"
)
APPROVED_CATALOG_CONTENT_SHA256 = (
    "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588"
)
APPROVED_CATALOG_ARTIFACT_SHA256 = (
    "aab562b8ff5cbe8159128769749616f6285fa0b8a9fab9bb6a49d6e70e72504a"
)
EXPECTED_RELATIONS = 61
EXPECTED_REVIEWS = 164
FORBIDDEN_BUCKETS = {"keep-isolated", "abandoned-no-course", "human-remaining"}
APPROVED_FIELDS = {
    "catalog_course_code",
    "catalog_teacher_label",
    "category",
    "comment",
    "decision_basis",
    "duplicate_group",
    "proposed_teacher_label",
    "review_id",
    "schema_version",
    "source_column",
    "source_evaluation_id",
    "source_row",
    "worksheet",
}


class Issue111FreezeError(ValueError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def content_sha256(files: dict[str, dict[str, Any]]) -> str:
    payload = json.dumps(files, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256_bytes(payload.encode("utf-8"))


def project_review(row: dict[str, Any]) -> dict[str, Any]:
    projected = {field: row.get(field) for field in sorted(APPROVED_FIELDS)}
    if projected["schema_version"] != RECORD_SCHEMA:
        raise Issue111FreezeError("review schema_version is not legacy-approved-review-v1")
    review_id = projected["review_id"]
    comment = projected["comment"]
    course = projected["catalog_course_code"]
    teacher = projected["catalog_teacher_label"]
    if not isinstance(review_id, str) or not review_id:
        raise Issue111FreezeError("review_id missing")
    if not isinstance(comment, str) or not comment.strip():
        raise Issue111FreezeError(f"{review_id} has empty comment")
    if not isinstance(course, str) or not course or not isinstance(teacher, str) or not teacher:
        raise Issue111FreezeError(f"{review_id} missing catalog identity")
    if row.get("comment") != comment:
        raise Issue111FreezeError(f"{review_id} comment would be rewritten")
    return projected


def freeze_issue111_package(source: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise Issue111FreezeError(f"refusing existing output: {out}")
    manifest = read_json(source / "manifest.json")
    if manifest.get("contract_version") != RELATION_CONTRACT:
        raise Issue111FreezeError("source is not the issue111 relation-addition package")
    if manifest.get("counts", {}).get("relations") != EXPECTED_RELATIONS:
        raise Issue111FreezeError("source relation count is not 61")
    if manifest.get("counts", {}).get("reviews") != EXPECTED_REVIEWS:
        raise Issue111FreezeError("source review count is not 164")

    requests_meta = (manifest.get("files") or {}).get("catalog-addition-requests.jsonl")
    reviews_meta = (manifest.get("files") or {}).get("reviews.jsonl")
    requests_path = source / "catalog-addition-requests.jsonl"
    reviews_path = source / "reviews.jsonl"
    if not isinstance(requests_meta, dict) or sha256(requests_path) != requests_meta.get("sha256"):
        raise Issue111FreezeError("catalog-addition-requests.jsonl hash mismatch")
    if not isinstance(reviews_meta, dict) or sha256(reviews_path) != reviews_meta.get("sha256"):
        raise Issue111FreezeError("reviews.jsonl hash mismatch")

    requests = read_jsonl(requests_path)
    reviews = read_jsonl(reviews_path)
    if len(requests) != EXPECTED_RELATIONS or len(reviews) != EXPECTED_REVIEWS:
        raise Issue111FreezeError("source row counts do not match the declared 61/164 package")

    allowed_pairs = {
        (row.get("catalog_course_code"), row.get("catalog_teacher_label")) for row in requests
    }
    if len(allowed_pairs) != EXPECTED_RELATIONS or any(
        not all(isinstance(item, str) and item for item in pair) for pair in allowed_pairs
    ):
        raise Issue111FreezeError("relation request queue is not 61 unique catalog pairs")

    importable: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in reviews:
        bucket = str(row.get("source_bucket") or row.get("lineage", {}).get("source_bucket") or "")
        if bucket in FORBIDDEN_BUCKETS:
            raise Issue111FreezeError("source reviews include an isolated or abandoned bucket")
        projected = project_review(row)
        review_id = str(projected["review_id"])
        if review_id in seen:
            raise Issue111FreezeError(f"duplicate review_id: {review_id}")
        pair = (projected["catalog_course_code"], projected["catalog_teacher_label"])
        if pair not in allowed_pairs:
            raise Issue111FreezeError(f"{review_id} is not bound to the 61 official pairs")
        seen.add(review_id)
        importable.append(projected)

    out.mkdir(parents=True)
    artifact = write_jsonl(out / "importable-legacy-reviews.jsonl", importable)
    files = {"importable-legacy-reviews.jsonl": artifact}
    freeze_manifest = {
        "contractVersion": FREEZE_CONTRACT,
        "status": "package_ready",
        "contentSha256": content_sha256(files),
        "counts": {"importable": EXPECTED_REVIEWS, "relations": EXPECTED_RELATIONS},
        "schemas": {"importable-legacy-reviews.jsonl": RECORD_SCHEMA},
        "files": files,
        "lineage": {
            "approvedPackageContract": SOURCE_CONTRACT,
            "approvedPackageManifestSha256": APPROVED_PACKAGE_MANIFEST_SHA256,
            "approvedCatalogContentSha256": APPROVED_CATALOG_CONTENT_SHA256,
            "approvedCatalogArtifactSha256": APPROVED_CATALOG_ARTIFACT_SHA256,
            "sourceRelationPackageManifestSha256": sha256(source / "manifest.json"),
            "sourceReviewsSha256": reviews_meta.get("sha256"),
        },
    }
    write_json(out / "manifest.json", freeze_manifest)
    return freeze_manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Freeze the issue111 164-review historical package")
    parser.add_argument("--source", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = freeze_issue111_package(Path(args.source), Path(args.out))
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
