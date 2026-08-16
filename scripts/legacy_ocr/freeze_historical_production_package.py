from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


SOURCE_CONTRACT = "legacy-historical-approved-package-v1"
FREEZE_CONTRACT = "legacy-historical-production-freeze-v1"
APPROVED_MANIFEST_SHA256 = (
    "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af"
)
APPROVED_CATALOG_CONTENT_SHA256 = (
    "33efc25c965510f7e87aeefc8b14a3ab5ec7c0df81d3485688d4630a4179bf1f"
)
ISSUE44_PACKAGE_MANIFEST_SHA256 = (
    "5d06fd91bdcac95a0dc7163156766c7f6eb7c17388a20ba6f9c21d8370d7dca6"
)
ISSUE44_STAGING_MANIFEST_SHA256 = (
    "e4f5e2b47ddf4c2864e0d326bf8ce271fb1845451c4bfbf5f3a024c74862558a"
)

EXPECTED_SOURCE_COUNTS = {
    "approved_import_rows": 941,
    "unresolved_rows": 430,
    "excluded_source_rows": 8,
    "source_api_ready": 1338,
    "fan_out_extra_rows": 41,
}

PARTITIONS = {
    "approved-legacy-reviews.jsonl": "importable-legacy-reviews.jsonl",
    "unresolved-legacy-reviews.jsonl": "catalog-identity-unresolved.jsonl",
}
EXCLUDED_PARTITIONS = (
    "evidence-conflict.jsonl",
    "blank.jsonl",
    "other-excluded.jsonl",
)
OUTPUT_SCHEMAS = {
    "importable-legacy-reviews.jsonl": "legacy-approved-review-v1",
    "catalog-identity-unresolved.jsonl": "legacy-approved-unresolved-review-v1",
    "evidence-conflict.jsonl": "legacy-approved-exclusion-v1",
    "blank.jsonl": "legacy-approved-exclusion-v1",
    "other-excluded.jsonl": "legacy-approved-exclusion-v1",
}
FORBIDDEN_CREDENTIAL_KEYS = {
    "apikey",
    "accesstoken",
    "authorization",
    "bearertoken",
    "clientsecret",
    "password",
    "privatekey",
    "refreshtoken",
    "secret",
    "token",
}
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
UNRESOLVED_FIELDS = APPROVED_FIELDS | {"unresolved_reasons"}
EXCLUDED_FIELDS = {"evaluation", "owner_note", "reason", "schema_version"}


class FreezeError(ValueError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            raise FreezeError(f"{path.name}:{line_number} contains a blank line")
        value = json.loads(line)
        if not isinstance(value, dict):
            raise FreezeError(f"{path.name}:{line_number} must contain an object")
        rows.append(value)
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    content = "".join(f"{canonical_json(row)}\n" for row in rows)
    path.write_text(content, encoding="utf-8", newline="\n")


def verify_source_file(
    source_root: Path,
    name: str,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    path = source_root / name
    if not path.is_file():
        raise FreezeError(f"missing source artifact: {name}")
    actual_sha256 = sha256_file(path)
    if actual_sha256 != metadata.get("sha256"):
        raise FreezeError(f"source artifact hash mismatch: {name}")
    rows = read_jsonl(path)
    if len(rows) != metadata.get("rows"):
        raise FreezeError(f"source artifact row count mismatch: {name}")
    return rows


def require_unique_non_empty(rows: list[dict[str, Any]], field: str, label: str) -> set[str]:
    values: set[str] = set()
    for index, row in enumerate(rows, 1):
        value = row.get(field)
        if not isinstance(value, str) or not value or value in values:
            raise FreezeError(f"{label}:{index} has an invalid or duplicate {field}")
        values.add(value)
    return values


def validate_catalog_rows(
    courses: list[dict[str, Any]],
    teachers: list[dict[str, Any]],
    relations: list[dict[str, Any]],
) -> tuple[set[str], set[str], set[tuple[str, str]]]:
    course_codes = require_unique_non_empty(courses, "courseCode", "catalog-courses.jsonl")
    teacher_labels = require_unique_non_empty(
        teachers, "sourceTeacherLabel", "catalog-teachers.jsonl"
    )
    relation_keys: set[tuple[str, str]] = set()
    for index, row in enumerate(relations, 1):
        key = (row.get("courseCode"), row.get("sourceTeacherLabel"))
        if (
            not all(isinstance(value, str) and value for value in key)
            or key in relation_keys
            or key[0] not in course_codes
            or key[1] not in teacher_labels
        ):
            raise FreezeError(f"catalog-relations.jsonl:{index} has an invalid relation")
        relation_keys.add(key)
    return course_codes, teacher_labels, relation_keys


def classify_exclusion(row: dict[str, Any]) -> str:
    evaluation = row.get("evaluation")
    if not isinstance(evaluation, dict):
        return "other-excluded.jsonl"
    comment = evaluation.get("comment")
    if not isinstance(comment, str) or not comment.strip():
        return "blank.jsonl"
    reasons: set[str] = set()
    for field in ("manual_review_reasons", "production_reasons"):
        values = evaluation.get(field, [])
        if not isinstance(values, list):
            raise FreezeError(f"excluded evaluation has invalid {field}")
        reasons.update(str(reason) for reason in values)
    if "evidence_conflict" in reasons:
        return "evidence-conflict.jsonl"
    return "other-excluded.jsonl"


def validate_importable_rows(
    rows: list[dict[str, Any]],
    courses: list[dict[str, Any]],
    teachers: list[dict[str, Any]],
    relations: list[dict[str, Any]],
) -> None:
    course_codes, teacher_labels, relation_keys = validate_catalog_rows(
        courses, teachers, relations
    )
    review_ids: set[str] = set()
    for index, row in enumerate(rows, 1):
        review_id = str(row.get("review_id", ""))
        course_code = str(row.get("catalog_course_code", ""))
        teacher_label = str(row.get("catalog_teacher_label", ""))
        comment = row.get("comment")
        errors: list[str] = []
        if set(row) != APPROVED_FIELDS:
            errors.append("fixed schema fields")
        if row.get("schema_version") != "legacy-approved-review-v1":
            errors.append("schema_version")
        if not review_id or review_id in review_ids:
            errors.append("unique review_id")
        if course_code not in course_codes:
            errors.append("catalog course")
        if teacher_label not in teacher_labels:
            errors.append("catalog teacher")
        if (course_code, teacher_label) not in relation_keys:
            errors.append("catalog relation")
        if not isinstance(comment, str) or not comment.strip():
            errors.append("non-blank comment")
        if errors:
            raise FreezeError(
                f"approved-legacy-reviews.jsonl:{index} failed: {', '.join(errors)}"
            )
        review_ids.add(review_id)


def validate_terminal_partitions(
    approved: list[dict[str, Any]],
    unresolved: list[dict[str, Any]],
    excluded: list[dict[str, Any]],
) -> None:
    disposition_ids: set[str] = set()
    for filename, rows, schema in (
        ("approved-legacy-reviews.jsonl", approved, "legacy-approved-review-v1"),
        (
            "unresolved-legacy-reviews.jsonl",
            unresolved,
            "legacy-approved-unresolved-review-v1",
        ),
    ):
        for index, row in enumerate(rows, 1):
            review_id = row.get("review_id")
            expected_fields = (
                APPROVED_FIELDS
                if filename == "approved-legacy-reviews.jsonl"
                else UNRESOLVED_FIELDS
            )
            if row.get("schema_version") != schema:
                raise FreezeError(f"{filename}:{index} has an unexpected schema_version")
            if set(row) != expected_fields:
                raise FreezeError(f"{filename}:{index} does not match the fixed schema")
            if not isinstance(review_id, str) or not review_id or review_id in disposition_ids:
                raise FreezeError(f"{filename}:{index} has an invalid or duplicate review_id")
            if not isinstance(row.get("source_evaluation_id"), str) or not row[
                "source_evaluation_id"
            ]:
                raise FreezeError(f"{filename}:{index} lacks source_evaluation_id")
            disposition_ids.add(review_id)

    for index, row in enumerate(unresolved, 1):
        reasons = row.get("unresolved_reasons")
        if (
            not isinstance(reasons, list)
            or not reasons
            or not set(reasons) <= {"course_identity", "teacher_identity"}
            or ("course_identity" in reasons and row.get("catalog_course_code"))
            or ("teacher_identity" in reasons and row.get("catalog_teacher_label"))
        ):
            raise FreezeError(
                f"unresolved-legacy-reviews.jsonl:{index} has invalid identity closure"
            )

    for index, row in enumerate(excluded, 1):
        evaluation = row.get("evaluation")
        evaluation_id = evaluation.get("evaluation_id") if isinstance(evaluation, dict) else None
        disposition_id = f"excluded:{evaluation_id}" if evaluation_id else ""
        if (
            row.get("schema_version") != "legacy-approved-exclusion-v1"
            or set(row) != EXCLUDED_FIELDS
            or not isinstance(row.get("reason"), str)
            or not row["reason"]
            or not disposition_id
            or disposition_id in disposition_ids
        ):
            raise FreezeError(f"excluded-legacy-reviews.jsonl:{index} is invalid")
        disposition_ids.add(disposition_id)


def reject_production_credentials(value: Any, path: str = "output") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = "".join(character for character in str(key).lower() if character.isalnum())
            if normalized in FORBIDDEN_CREDENTIAL_KEYS:
                raise FreezeError(f"production credential field is forbidden: {path}.{key}")
            reject_production_credentials(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_production_credentials(child, f"{path}[{index}]")


def file_descriptor(path: Path, rows: int) -> dict[str, Any]:
    return {
        "bytes": path.stat().st_size,
        "rows": rows,
        "sha256": sha256_file(path),
    }


def _freeze(
    source_root: Path,
    catalog_manifest_path: Path,
    output_root: Path,
    *,
    expected_manifest_sha256: str = APPROVED_MANIFEST_SHA256,
    expected_catalog_content_sha256: str = APPROVED_CATALOG_CONTENT_SHA256,
) -> dict[str, Any]:
    manifest_path = source_root / "manifest.json"
    if not manifest_path.is_file():
        raise FreezeError("missing source manifest.json")
    source_manifest_sha256 = sha256_file(manifest_path)
    if source_manifest_sha256 != expected_manifest_sha256:
        raise FreezeError("source manifest SHA-256 is not the #88 approved authority")
    source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if source_manifest.get("contract_version") != SOURCE_CONTRACT:
        raise FreezeError("unexpected source contract")
    catalog_manifest_sha256 = sha256_file(catalog_manifest_path)
    if source_manifest.get("approved_catalog_manifest_sha256") != catalog_manifest_sha256:
        raise FreezeError("approved catalog manifest SHA-256 mismatch")
    catalog_manifest = json.loads(catalog_manifest_path.read_text(encoding="utf-8"))
    if catalog_manifest.get("contentSha256") != expected_catalog_content_sha256:
        raise FreezeError("approved catalog content SHA-256 mismatch")
    closure = source_manifest.get("closure", {})
    if closure.get("all_api_ready_source_rows_terminal") is not True:
        raise FreezeError("source package does not close all API-ready rows")
    if closure.get("production_write_performed") is not False:
        raise FreezeError("source package reports a production write")

    source_files = source_manifest.get("files", {})
    required = (
        "approved-legacy-reviews.jsonl",
        "unresolved-legacy-reviews.jsonl",
        "excluded-legacy-reviews.jsonl",
        "catalog-courses.jsonl",
        "catalog-teachers.jsonl",
        "catalog-relations.jsonl",
    )
    source_rows = {
        name: verify_source_file(source_root, name, source_files.get(name, {}))
        for name in required
    }
    validate_importable_rows(
        source_rows["approved-legacy-reviews.jsonl"],
        source_rows["catalog-courses.jsonl"],
        source_rows["catalog-teachers.jsonl"],
        source_rows["catalog-relations.jsonl"],
    )
    validate_terminal_partitions(
        source_rows["approved-legacy-reviews.jsonl"],
        source_rows["unresolved-legacy-reviews.jsonl"],
        source_rows["excluded-legacy-reviews.jsonl"],
    )

    counts = source_manifest.get("counts", {})
    for name, expected in EXPECTED_SOURCE_COUNTS.items():
        if counts.get(name) != expected:
            raise FreezeError(f"unexpected source count: {name}")
    actual_counts = {
        "approved_import_rows": len(source_rows["approved-legacy-reviews.jsonl"]),
        "unresolved_rows": len(source_rows["unresolved-legacy-reviews.jsonl"]),
        "excluded_source_rows": len(source_rows["excluded-legacy-reviews.jsonl"]),
    }
    if any(counts[name] != actual for name, actual in actual_counts.items()):
        raise FreezeError("source manifest counts do not match terminal artifacts")

    partition_rows: dict[str, list[dict[str, Any]]] = {
        target: source_rows[source]
        for source, target in PARTITIONS.items()
    }
    partition_rows.update({name: [] for name in EXCLUDED_PARTITIONS})
    for row in source_rows["excluded-legacy-reviews.jsonl"]:
        partition_rows[classify_exclusion(row)].append(row)
    reject_production_credentials(partition_rows)

    disposition_rows = sum(len(rows) for rows in partition_rows.values())
    expected_dispositions = counts["source_api_ready"] + counts["fan_out_extra_rows"]
    if disposition_rows != expected_dispositions:
        raise FreezeError("terminal partitions do not close source rows plus fan-out")
    source_dispositions: dict[str, int] = {}
    for row in source_rows["approved-legacy-reviews.jsonl"]:
        source_id = row["source_evaluation_id"]
        source_dispositions[source_id] = source_dispositions.get(source_id, 0) + 1
    for row in source_rows["unresolved-legacy-reviews.jsonl"]:
        source_id = row["source_evaluation_id"]
        source_dispositions[source_id] = source_dispositions.get(source_id, 0) + 1
    for row in source_rows["excluded-legacy-reviews.jsonl"]:
        source_id = row["evaluation"]["evaluation_id"]
        source_dispositions[source_id] = source_dispositions.get(source_id, 0) + 1
    fan_out_extra_rows = sum(count - 1 for count in source_dispositions.values())
    if (
        len(source_dispositions) != counts["source_api_ready"]
        or fan_out_extra_rows != counts["fan_out_extra_rows"]
    ):
        raise FreezeError("source evaluation disposition and fan-out closure mismatch")

    if output_root.exists():
        raise FreezeError(f"refusing existing output: {output_root}")
    output_root.mkdir(parents=True)
    for name, rows in partition_rows.items():
        write_jsonl(output_root / name, rows)

    lineage = {
        "approvedCatalogContentSha256": expected_catalog_content_sha256,
        "approvedCatalogManifestSha256": catalog_manifest_sha256,
        "approvedPackageManifestSha256": source_manifest_sha256,
        "approvedPackageContract": SOURCE_CONTRACT,
        "issue24ApprovedPackage": "historical-approved-package-v1",
        "issue44": {
            "apiReadyPreviewIsAuthority": False,
            "apiReadyPreviewRows": 1158,
            "needsReviewRows": 23,
            "packageManifestSha256": ISSUE44_PACKAGE_MANIFEST_SHA256,
            "stagingManifestSha256": ISSUE44_STAGING_MANIFEST_SHA256,
        },
    }
    freeze_counts = {
        "blank": len(partition_rows["blank.jsonl"]),
        "catalogIdentityUnresolved": len(
            partition_rows["catalog-identity-unresolved.jsonl"]
        ),
        "dispositionRows": disposition_rows,
        "evidenceConflict": len(partition_rows["evidence-conflict.jsonl"]),
        "fanOutExtraRows": counts["fan_out_extra_rows"],
        "importable": len(partition_rows["importable-legacy-reviews.jsonl"]),
        "otherExcluded": len(partition_rows["other-excluded.jsonl"]),
        "sourceRows": counts["source_api_ready"],
    }
    report = f"""# 首批历史评价生产数据包验收报告

- 状态：`package_ready`
- 冻结契约：`{FREEZE_CONTRACT}`
- 权威批准包 manifest SHA-256：`{source_manifest_sha256}`
- 批准目录 content SHA-256：`{expected_catalog_content_sha256}`

## 闭合结果

- 上游来源记录：{freeze_counts['sourceRows']}
- fan-out 额外处置行：{freeze_counts['fanOutExtraRows']}
- 终态处置行：{freeze_counts['dispositionRows']}
- 可导入：{freeze_counts['importable']}
- 目录身份未闭合：{freeze_counts['catalogIdentityUnresolved']}
- 证据冲突：{freeze_counts['evidenceConflict']}
- 空白：{freeze_counts['blank']}
- 其他排除：{freeze_counts['otherExcluded']}

`{freeze_counts['sourceRows']} + {freeze_counts['fanOutExtraRows']} = {freeze_counts['dispositionRows']} = {freeze_counts['importable']} + {freeze_counts['catalogIdentityUnresolved']} + {freeze_counts['evidenceConflict']} + {freeze_counts['blank']} + {freeze_counts['otherExcluded']}`。{freeze_counts['sourceRows']} 个来源评价全部闭合，fan-out 仅增加终态行；每个唯一 `review_id` 只写入一个分区。

## 资格与安全门禁

- 可导入行全部通过既有课程、教师、任课关系和非空正文校验。
- {freeze_counts['catalogIdentityUnresolved']} 条目录身份未闭合记录、{freeze_counts['evidenceConflict']} 条证据冲突、{freeze_counts['blank']} 条空白记录和 {freeze_counts['otherExcluded']} 条其他排除记录不在可导入文件中。
- 唯一权威输入是 #24 关闭时的 `historical-approved-package-v1`；其 1,338 条 API-ready 来源因 41 条人工 fan-out 决策形成 1,379 条终态处置行。
- 同目录的后续包或其他候选包即使包含更多可绑定记录，也因 manifest 哈希不同而被拒绝，冻结过程不拼接来源。
- #44 的 1,158 条 AI 已验证/API-ready 离线预览来自独立证据重建，只证明离线证据与 API 形状可用，不等同于外部人工批准，不能扩充这 941 条生产集合。
- #44 新发现的 23 条 `needs_review` 记录保持在其上游审核分区，本冻结包不读取也不输出这些记录。
- 数据包不含生产凭证，未调用生产 API，未写业务数据库。
"""
    (output_root / "ACCEPTANCE.md").write_text(report, encoding="utf-8", newline="\n")
    files = {
        name: file_descriptor(output_root / name, len(rows))
        for name, rows in sorted(partition_rows.items())
    }
    files["ACCEPTANCE.md"] = {
        "bytes": (output_root / "ACCEPTANCE.md").stat().st_size,
        "sha256": sha256_file(output_root / "ACCEPTANCE.md"),
    }
    content_sha256 = sha256_bytes(
        canonical_json({"files": files, "lineage": lineage, "counts": freeze_counts}).encode()
    )
    manifest = {
        "contractVersion": FREEZE_CONTRACT,
        "status": "package_ready",
        "counts": freeze_counts,
        "files": files,
        "lineage": lineage,
        "schemas": OUTPUT_SCHEMAS,
        "contentSha256": content_sha256,
        "safety": {
            "containsProductionCredentials": False,
            "productionApiCalled": False,
            "productionWritePerformed": False,
        },
    }
    (output_root / "manifest.json").write_text(
        f"{canonical_json(manifest)}\n", encoding="utf-8", newline="\n"
    )
    return manifest


def freeze(
    source_root: Path,
    catalog_manifest_path: Path,
    output_root: Path,
) -> dict[str, Any]:
    return _freeze(
        source_root,
        catalog_manifest_path,
        output_root,
        expected_manifest_sha256=APPROVED_MANIFEST_SHA256,
        expected_catalog_content_sha256=APPROVED_CATALOG_CONTENT_SHA256,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Freeze the #24 approved historical reviews for production import."
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--catalog-manifest", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        freeze(args.source, args.catalog_manifest, args.out)
    except (FreezeError, json.JSONDecodeError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
