from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from compile_production_staging import read_json, read_jsonl, sha256, write_json, write_jsonl
from map_catalog_identities import catalog_indexes, match_identity, normalize_source_label, verified_catalog


SOURCE_CONTRACT = "legacy-review-approved-package-v1"
FREEZE_CONTRACT = "legacy-v5-historical-freeze-v1"
RECORD_SCHEMA = "legacy-approved-review-v1"
EXPECTED_V5_EVALUATIONS = 630
EXPECTED_V5_EVALUATIONS_SHA256 = (
    "27ba8bff846bb74b77728ccf23075a193385c9d01157c77fea785d4ee04bdfae"
)
APPROVED_CATALOG_CONTENT_SHA256 = (
    "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588"
)
APPROVED_CATALOG_MANIFEST_SHA256 = (
    "c26d125dc56dfadf93638d2f94241c2ed6dd8c844f16e06262ae890798bd1070"
)
APPROVED_CATALOG_ARTIFACT_SHA256 = (
    "aab562b8ff5cbe8159128769749616f6285fa0b8a9fab9bb6a49d6e70e72504a"
)
REQUIRED_OWNER_LABELS = {
    "大英和视听说|10|N": ("英语口语", "张晓花"),
}
REQUIRED_OWNER_TEACHERS = {
    ("主要课程", 173): "孙爱琳",
    ("主要课程", 180): "缪丽",
}
FORBIDDEN_KEYS = {"大英和视听说|56|J"}
PROTECTED_OUT_MARKERS = (
    "full-matrix-freeze-20260819-v1",
    "full-matrix-ocr-20260819-v1",
    "review-approved-20260820-v5",
    "frozen-historical-production-v2",
    "frozen-historical-issue111-v1",
    "issue111-relation-addition-v1",
    "issue111-isolated-usable-v1",
    "issue111-isolated-shorthand-v1",
    "issue111-pe-course-teacher-v1",
    "frozen-historical-v5-candidate-v1",
    "frozen-historical-v5-candidate-v2",
    "frozen-historical-v5-candidate-v3",
)
IMPORTED_PACKAGES = (
    ("frozen-historical-production-v2/importable-legacy-reviews.jsonl", 522),
    ("frozen-historical-issue111-v1/importable-legacy-reviews.jsonl", 164),
    ("issue111-isolated-usable-v1/reviews.jsonl", 120),
    ("issue111-isolated-shorthand-v1/reviews.jsonl", 12),
    ("issue111-pe-course-teacher-v1/reviews.jsonl", 64),
)
APPROVED_FIELDS = (
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
)
PE_PUBLIC_ALIASES = {
    "健美操": frozenset({"健美操", "健身教练"}),
}
VISIBLE_COURSE_ALIASES = {
    "足球69": "足球",
    "散打上课": "散打",
}
OFFICIAL_COURSE_ALIASES = {
    "毛概": "毛泽东思想和中国特色社会主义理论体系概论",
    "马原": "马克思主义基本原理",
    "近代史": "中国近现代史纲要",
    "思修": "思想道德与法治",
    "习概": "习近平新时代中国特色社会主义思想概论",
}
UMBRELLA_PE_NAMES = frozenset({
    "体育1",
    "体育2",
    "体育3",
    "体育4",
    "体育Ⅰ（留）",
    "体育Ⅱ（留）",
    "体育I（留）",
    "体育II（留）",
})
ENGLISH_COLLEGE_PREFIXES = ("大学英语",)
ENGLISH_LISTENING_PREFIXES = ("英语视听说", "视听说")
PLAIN_COLLEGE_ENGLISH = re.compile(
    r"^大学英语(?:IV|III|II|I|Ⅳ|Ⅲ|Ⅱ|Ⅰ|4|3|2|1)$"
)
ENGLISH_HIGHER_LEVEL = re.compile(r"(?:IV|III|II|4|3|2|Ⅳ|Ⅲ|Ⅱ)$")
ENGLISH_LEVEL_ONE = re.compile(r"(?:I|Ⅰ|1)$")
ENGLISH_PAREN_SUFFIX = re.compile(r"[（(].*$")
SPECIAL_THEORY_SUFFIX = re.compile(r"专项理论与实践[1-6]$")
LEVEL_SUFFIX = re.compile(r"[1-6]$")
ONE_SUFFIX = re.compile(r"(?:专项理论与实践)?1$")


class V5FreezeError(ValueError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def content_sha256(files: dict[str, dict[str, Any]]) -> str:
    payload = json.dumps(files, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256_bytes(payload.encode("utf-8"))


def stable_id(prefix: str, *parts: str) -> str:
    return prefix + hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:32]


def public_display_family(name: str) -> str:
    value = normalize_source_label(name)
    value = SPECIAL_THEORY_SUFFIX.sub("", value)
    return LEVEL_SUFFIX.sub("", value)


def visible_course_name(raw: str) -> str:
    value = normalize_source_label(raw)
    return VISIBLE_COURSE_ALIASES.get(value, value)


def sports_family_candidates(visible: str, courses: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    aliases = PE_PUBLIC_ALIASES.get(visible, frozenset({visible}))
    hits: list[dict[str, Any]] = []
    for course in courses.values():
        current = course.get("currentName")
        if not isinstance(current, str) or not current or current in UMBRELLA_PE_NAMES:
            continue
        family = public_display_family(current)
        if family == "体育":
            continue
        if current in aliases or family in aliases:
            hits.append(course)
    unique = {course["courseCode"]: course for course in hits}
    return [unique[code] for code in sorted(unique)]


def pick_canonical(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    def name(course: dict[str, Any]) -> str:
        return str(course.get("currentName") or "")

    unnumbered = [
        course for course in candidates
        if not LEVEL_SUFFIX.search(name(course)) and not SPECIAL_THEORY_SUFFIX.search(name(course))
    ]
    ones = [course for course in candidates if ONE_SUFFIX.search(name(course))]
    ranked = unnumbered or ones or sorted(candidates, key=lambda course: course["courseCode"])
    return ranked[0]


def is_listening_english(name: str) -> bool:
    return name.startswith(ENGLISH_LISTENING_PREFIXES)


def is_plain_college_english(name: str) -> bool:
    return bool(PLAIN_COLLEGE_ENGLISH.match(name))


def is_modified_college_english(name: str) -> bool:
    return name.startswith(ENGLISH_COLLEGE_PREFIXES) and not is_plain_college_english(name)


def is_english_level_one(name: str) -> bool:
    base = ENGLISH_PAREN_SUFFIX.sub("", name).strip()
    if ENGLISH_HIGHER_LEVEL.search(base):
        return False
    return bool(ENGLISH_LEVEL_ONE.search(base))


def pick_english_canonical(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    ones = [
        course
        for course in candidates
        if is_english_level_one(str(course.get("currentName") or ""))
    ]
    pool = ones or candidates
    return sorted(pool, key=lambda course: course["courseCode"])[0]


def pick_english_existing(
    visible: str,
    matches: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, str]:
    def named(predicate) -> list[dict[str, Any]]:
        return [
            course
            for course in matches
            if predicate(str(course.get("currentName") or ""))
        ]

    if visible == "视听说":
        pool = named(is_listening_english)
    elif visible == "大英和视听说":
        pool = (
            named(is_plain_college_english)
            or named(is_modified_college_english)
            or named(is_listening_english)
        )
    elif len(matches) == 1:
        pool = matches
    else:
        pool = []
    if not pool:
        return None, "english_teacher_unique"
    picked = pick_english_canonical(pool)
    method = "english_teacher_unique" if len(pool) == 1 else "english_teacher_level"
    return picked, method


def load_teacher_overrides(path: Path | None) -> dict[tuple[str, int], str]:
    if path is None:
        return {}
    raw = read_json(path)
    items = raw.get("items") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        raise V5FreezeError("teacher overrides must contain items")
    overrides: dict[tuple[str, int], str] = {}
    for item in items:
        if not isinstance(item, dict):
            raise V5FreezeError("invalid teacher override item")
        worksheet = item.get("worksheet")
        row = item.get("row")
        teacher = str(item.get("teacher") or "").strip()
        if not isinstance(worksheet, str) or not isinstance(row, int) or not teacher:
            raise V5FreezeError("teacher override needs worksheet, row, and teacher")
        key = (worksheet, row)
        if key in overrides and overrides[key] != teacher:
            raise V5FreezeError(f"conflicting teacher override: {worksheet}|{row}")
        overrides[key] = teacher
    return overrides


def english_prefix_candidates(visible: str, courses: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if visible == "学术英语":
        prefixes: tuple[str, ...] = ("学术英语",)
    elif visible == "高级口语":
        prefixes = ("高级口语",)
    elif visible == "英语口语":
        prefixes = ("英语口语", *ENGLISH_LISTENING_PREFIXES)
    elif visible == "视听说":
        prefixes = ENGLISH_LISTENING_PREFIXES
    elif visible == "大英和视听说":
        prefixes = (*ENGLISH_COLLEGE_PREFIXES, *ENGLISH_LISTENING_PREFIXES)
    else:
        prefixes = ENGLISH_COLLEGE_PREFIXES
    return [
        course for course in courses.values()
        if isinstance(course.get("currentName"), str) and course["currentName"].startswith(prefixes)
    ]


def verify_v5_source(
    source: Path,
    expected_evaluations_sha256: str,
    expected_rows: int,
) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    manifest_path = source / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest.get("contract_version") != SOURCE_CONTRACT:
        raise V5FreezeError("source is not the v5 approved package")
    if manifest.get("status") != "completed":
        raise V5FreezeError("v5 approved package is not completed")
    if manifest.get("wrote_tencent_or_business_db") is not False:
        raise V5FreezeError("v5 package claims a Tencent or business-db write")
    declaration = (manifest.get("files") or {}).get("evaluations.jsonl")
    path = source / "evaluations.jsonl"
    if not isinstance(declaration, dict) or not path.is_file():
        raise V5FreezeError("v5 evaluations.jsonl is missing")
    actual_sha = sha256(path)
    if actual_sha != declaration.get("sha256") or actual_sha != expected_evaluations_sha256:
        raise V5FreezeError("v5 evaluations.jsonl hash mismatch")
    rows = read_jsonl(path)
    if len(rows) != declaration.get("rows") or len(rows) != expected_rows:
        raise V5FreezeError("v5 evaluations.jsonl row count mismatch")
    return manifest, sha256(manifest_path), rows


def load_imported_keys(
    imported_root: Path,
    imported_packages: tuple[tuple[str, int], ...],
) -> set[str]:
    keys: set[str] = set()
    for relative, expected in imported_packages:
        path = imported_root / relative
        if not path.is_file():
            raise V5FreezeError(f"missing already-imported package: {relative}")
        rows = read_jsonl(path)
        if len(rows) != expected:
            raise V5FreezeError(f"{relative} row count is not {expected}")
        for row in rows:
            key = f"{row.get('worksheet')}|{row.get('source_row')}|{row.get('source_column')}"
            if not row.get("worksheet") or row.get("source_row") is None or not row.get("source_column"):
                raise V5FreezeError(f"{relative} is missing worksheet/row/column identity")
            keys.add(key)
    return keys


def assert_owner_labels(rows: list[dict[str, Any]]) -> None:
    by_key = {str(row.get("key")): row for row in rows}
    for key in FORBIDDEN_KEYS:
        if key in by_key:
            raise V5FreezeError(f"forbidden key entered v5 evaluations: {key}")
    for key, expected in REQUIRED_OWNER_LABELS.items():
        row = by_key.get(key)
        if row is None:
            continue
        if (row.get("course"), row.get("teacher")) != expected:
            raise V5FreezeError(f"owner mapping was not preserved: {key}")
    for (worksheet, source_row), teacher in REQUIRED_OWNER_TEACHERS.items():
        matching = [
            row for row in rows
            if row.get("worksheet") == worksheet and row.get("row") == source_row
        ]
        if matching and any(row.get("teacher") != teacher for row in matching):
            raise V5FreezeError(f"owner teacher mapping was not preserved: {worksheet}|{source_row}")


def project_importable(
    row: dict[str, Any],
    course: dict[str, Any],
    teacher: dict[str, Any],
    basis: str,
) -> dict[str, Any]:
    projected = {
        "catalog_course_code": course["courseCode"],
        "catalog_teacher_label": teacher["sourceTeacherLabel"],
        "category": "sports" if course.get("category") == "sports" else "general",
        "comment": row["body"],
        "decision_basis": basis,
        "duplicate_group": None,
        "proposed_teacher_label": None,
        "review_id": stable_id("legacy-review-", row["key"], row["formula_bar_text_sha256"]),
        "schema_version": RECORD_SCHEMA,
        "source_column": row["column"],
        "source_evaluation_id": stable_id("evaluation-", row["key"]),
        "source_row": row["row"],
        "worksheet": row["worksheet"],
    }
    return {field: projected[field] for field in APPROVED_FIELDS}


def match_row(
    row: dict[str, Any],
    courses: dict[str, dict[str, Any]],
    relations: set[tuple[str, str]],
    course_names: dict[str, list[dict[str, Any]]],
    teacher_names: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str, str, str]:
    raw_course_name = str(row.get("course") or "")
    course_name = visible_course_name(raw_course_name)
    official_name = OFFICIAL_COURSE_ALIASES.get(course_name, course_name)
    teacher_name = str(row.get("teacher") or "")
    course, course_method, _course_candidates = match_identity(official_name, course_names, "currentName")
    if course is None and official_name != course_name:
        course, course_method, _course_candidates = match_identity(course_name, course_names, "currentName")
    teacher, teacher_method, _teacher_candidates = match_identity(teacher_name, teacher_names, "sourceTeacherLabel")
    pair_course_candidates = course_names.get(normalize_source_label(official_name), [])
    exact_pair = [candidate for candidate in pair_course_candidates if candidate.get("currentName") == official_name]
    pair_course_candidates = exact_pair or pair_course_candidates
    worksheet = row.get("worksheet")
    if not pair_course_candidates and worksheet == "体育课" and course_name:
        pair_course_candidates = sports_family_candidates(course_name, courses)
        if pair_course_candidates and course is None:
            course_method = "pe_public_display_family"
    if course_name == "形势与政策" and not pair_course_candidates:
        pair_course_candidates = [
            item for item in courses.values()
            if str(item.get("currentName") or "").startswith("形势与政策")
        ]
    if (
        not pair_course_candidates
        and worksheet == "大英和视听说"
        and course_name in {"大英和视听说", "视听说", "英语口语", "高级口语", "学术英语"}
    ):
        pair_course_candidates = english_prefix_candidates(course_name, courses)
        if pair_course_candidates and course is None:
            course_method = "english_teacher_unique"
    if teacher and course is None and pair_course_candidates:
        relation_matches = [
            candidate
            for candidate in pair_course_candidates
            if (candidate["courseCode"], teacher["sourceTeacherLabel"]) in relations
        ]
        if worksheet == "大英和视听说" and relation_matches:
            picked, english_method = pick_english_existing(course_name, relation_matches)
            if picked is not None:
                course = picked
                course_method = english_method
        elif len(relation_matches) == 1:
            course = relation_matches[0]
            course_method = (
                "pe_one_teacher_one_course"
                if course_method == "pe_public_display_family"
                else "english_teacher_unique"
                if course_method == "english_teacher_unique"
                else "official_alias_unique"
                if official_name != raw_course_name
                else "pair_relation_unique"
            )
        elif relation_matches and worksheet == "体育课":
            families = {public_display_family(str(item.get("currentName") or "")) for item in relation_matches}
            if len(families) == 1:
                course = pick_canonical(relation_matches)
                course_method = "pe_one_teacher_one_course"
    return course, teacher, course_method, teacher_method, raw_course_name


def freeze_v5_production_candidate(
    source: Path,
    catalog_root: Path,
    imported_root: Path,
    out: Path,
    *,
    expected_evaluations_sha256: str = EXPECTED_V5_EVALUATIONS_SHA256,
    expected_rows: int = EXPECTED_V5_EVALUATIONS,
    expected_catalog_content_sha256: str = APPROVED_CATALOG_CONTENT_SHA256,
    expected_catalog_manifest_sha256: str = APPROVED_CATALOG_MANIFEST_SHA256,
    expected_catalog_artifact_sha256: str = APPROVED_CATALOG_ARTIFACT_SHA256,
    imported_packages: tuple[tuple[str, int], ...] = IMPORTED_PACKAGES,
    teacher_overrides: dict[tuple[str, int], str] | None = None,
) -> dict[str, Any]:
    if out.exists():
        raise V5FreezeError(f"refusing existing output: {out}")
    out_parts = {part.lower() for part in out.resolve().parts}
    blocked = [marker for marker in PROTECTED_OUT_MARKERS if marker.lower() in out_parts]
    if blocked:
        raise V5FreezeError(f"refusing protected output directory: {blocked[0]}")
    source_manifest, source_manifest_sha, evaluations = verify_v5_source(
        source, expected_evaluations_sha256, expected_rows
    )
    assert_owner_labels(evaluations)
    imported_keys = load_imported_keys(imported_root, imported_packages)
    catalog_manifest, catalog_manifest_sha, catalog_rows = verified_catalog(catalog_root)
    if catalog_manifest.get("contentSha256") != expected_catalog_content_sha256:
        raise V5FreezeError("approved catalog content hash mismatch")
    if catalog_manifest_sha != expected_catalog_manifest_sha256:
        raise V5FreezeError("approved catalog manifest hash mismatch")
    if (catalog_manifest.get("artifact") or {}).get("sha256") != expected_catalog_artifact_sha256:
        raise V5FreezeError("approved catalog artifact hash mismatch")
    courses, _teachers, relations, course_names, teacher_names = catalog_indexes(catalog_rows)
    overrides = teacher_overrides or {}

    importable: list[dict[str, Any]] = []
    pending_by_pair: dict[tuple[str, str], dict[str, Any]] = {}
    excluded: list[dict[str, Any]] = []
    unresolved_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    lineage: list[dict[str, Any]] = []

    for row in evaluations:
        key = row.get("key")
        if not isinstance(key, str) or "|" not in key:
            raise V5FreezeError("v5 evaluation is missing a matrix key")
        if row.get("body_source") != "formula_bar":
            raise V5FreezeError(f"{key} body_source is not formula_bar")
        body = row.get("body")
        body_sha = row.get("formula_bar_text_sha256")
        if not isinstance(body, str) or not isinstance(body_sha, str) or sha256_text(body) != body_sha:
            raise V5FreezeError(f"{key} formula-bar SHA does not match body")
        if key in FORBIDDEN_KEYS:
            raise V5FreezeError(f"forbidden key entered v5 evaluations: {key}")

        common = {
            "key": key,
            "worksheet": row.get("worksheet"),
            "source_row": row.get("row"),
            "source_column": row.get("column"),
            "formula_bar_text_sha256": body_sha,
            "legacy_course_name": row.get("course"),
            "legacy_teacher_name": row.get("teacher"),
        }
        if key in imported_keys:
            excluded.append({**common, "reason": "already_imported", "detail": "replay_forbidden_batch"})
            lineage.append({**common, "partition": "excluded", "review_id": None})
            continue
        filled_teacher = overrides.get((str(row.get("worksheet")), int(row["row"])))
        mapped_row = dict(row)
        if filled_teacher:
            mapped_row["teacher"] = filled_teacher
            common["legacy_teacher_name"] = filled_teacher
            common["teacher_source"] = "table_recapture"
        if not str(mapped_row.get("teacher") or "").strip():
            excluded.append({**common, "reason": "missing_teacher", "detail": "empty_source_teacher_label"})
            lineage.append({**common, "partition": "excluded", "review_id": None})
            continue
        if not body.strip():
            excluded.append({**common, "reason": "blank_body", "detail": "formula_bar_empty_after_strip"})
            lineage.append({**common, "partition": "excluded", "review_id": None})
            continue

        course, teacher, course_method, teacher_method, course_name = match_row(
            mapped_row, courses, relations, course_names, teacher_names
        )
        if not course or not teacher:
            if not course:
                unresolved_key = ("course", course_name)
                unresolved_by_key.setdefault(
                    unresolved_key,
                    {
                        "schema_version": "legacy-catalog-alias-exception-v1",
                        "identity_kind": "course",
                        "legacy_source_label": course_name,
                        "reason": course_method,
                        "terminal_status": "excluded_no_guess",
                        "keys": [],
                    },
                )["keys"].append(key)
            if not teacher:
                teacher_name = str(mapped_row.get("teacher") or "")
                unresolved_key = ("teacher", teacher_name)
                unresolved_by_key.setdefault(
                    unresolved_key,
                    {
                        "schema_version": "legacy-catalog-alias-exception-v1",
                        "identity_kind": "teacher",
                        "legacy_source_label": teacher_name,
                        "reason": teacher_method,
                        "terminal_status": "excluded_no_guess",
                        "keys": [],
                    },
                )["keys"].append(key)
            excluded.append(
                {
                    **common,
                    "reason": "catalog_identity_unmatched",
                    "detail": f"course={course_method};teacher={teacher_method}",
                }
            )
            lineage.append({**common, "partition": "excluded", "review_id": None})
            continue

        pair = (course["courseCode"], teacher["sourceTeacherLabel"])
        if pair not in relations:
            pending = pending_by_pair.setdefault(
                pair,
                {
                    "schema_version": "legacy-catalog-addition-request-v1",
                    "request_kind": "relation",
                    "catalog_course_code": pair[0],
                    "catalog_teacher_label": pair[1],
                    "reason": "approved_catalog_relation_missing",
                    "terminal_status": "owner_review_required",
                    "keys": [],
                },
            )
            pending["keys"].append(key)
            lineage.append(
                {
                    **common,
                    "partition": "pending_relation",
                    "review_id": None,
                    "catalog_course_code": pair[0],
                    "catalog_teacher_label": pair[1],
                }
            )
            continue

        basis = {
            "exact_source_identity": "existing_catalog_relation",
            "stable_normalized_alias": "existing_catalog_relation",
            "pair_relation_unique": "pair_relation_unique",
            "pe_public_display_unique": "pe_one_teacher_one_course",
            "pe_public_display_family": "pe_one_teacher_one_course",
            "pe_one_teacher_one_course": "pe_one_teacher_one_course",
            "english_teacher_unique": "english_teacher_unique",
            "english_teacher_level": "english_teacher_level",
            "official_alias_unique": "official_alias_unique",
        }.get(course_method, "existing_catalog_relation")
        projected = project_importable(row, course, teacher, basis)
        importable.append(projected)
        lineage.append(
            {
                **common,
                "partition": "importable",
                "review_id": projected["review_id"],
                "catalog_course_code": projected["catalog_course_code"],
                "catalog_teacher_label": projected["catalog_teacher_label"],
                "decision_basis": basis,
            }
        )

    importable.sort(key=lambda row: (row["worksheet"], row["source_row"], row["source_column"]))
    excluded.sort(key=lambda row: str(row["key"]))
    pending_relations = sorted(
        pending_by_pair.values(),
        key=lambda row: (row["catalog_course_code"], row["catalog_teacher_label"]),
    )
    for item in pending_relations:
        item["keys"] = sorted(item["keys"])
    unresolved = sorted(
        unresolved_by_key.values(),
        key=lambda row: (row["identity_kind"], row["legacy_source_label"]),
    )
    for item in unresolved:
        item["keys"] = sorted(item["keys"])
    lineage.sort(key=lambda row: str(row["key"]))

    if len(importable) + len(excluded) + sum(len(item["keys"]) for item in pending_relations) != expected_rows:
        raise V5FreezeError("v5 partition counts do not cover every evaluation")
    if any(item["partition"] is None for item in lineage):
        raise V5FreezeError("v5 lineage is missing a terminal partition")

    out.mkdir(parents=True)
    files = {
        "importable-legacy-reviews.jsonl": write_jsonl(out / "importable-legacy-reviews.jsonl", importable),
        "catalog-relation-pending.jsonl": write_jsonl(out / "catalog-relation-pending.jsonl", pending_relations),
        "catalog-identity-excluded.jsonl": write_jsonl(out / "catalog-identity-excluded.jsonl", unresolved),
        "excluded.jsonl": write_jsonl(out / "excluded.jsonl", excluded),
        "lineage.jsonl": write_jsonl(out / "lineage.jsonl", lineage),
    }
    freeze_manifest = {
        "contractVersion": FREEZE_CONTRACT,
        "status": "package_ready",
        "contentSha256": content_sha256(files),
        "counts": {
            "importable": len(importable),
            "pending_relations": len(pending_relations),
            "pending_relation_reviews": sum(len(item["keys"]) for item in pending_relations),
            "excluded_identities": len(unresolved),
            "excluded": len(excluded),
            "source_evaluations": expected_rows,
        },
        "schemas": {
            "importable-legacy-reviews.jsonl": RECORD_SCHEMA,
            "catalog-relation-pending.jsonl": "legacy-catalog-addition-request-v1",
            "catalog-identity-excluded.jsonl": "legacy-catalog-alias-exception-v1",
            "excluded.jsonl": "legacy-v5-exclusion-v1",
            "lineage.jsonl": "legacy-v5-lineage-v1",
        },
        "files": files,
        "lineage": {
            "approvedPackageContract": SOURCE_CONTRACT,
            "approvedPackageManifestSha256": source_manifest_sha,
            "approvedEvaluationsSha256": expected_evaluations_sha256,
            "approvedCatalogContentSha256": APPROVED_CATALOG_CONTENT_SHA256,
            "approvedCatalogManifestSha256": catalog_manifest_sha,
            "approvedCatalogArtifactSha256": APPROVED_CATALOG_ARTIFACT_SHA256,
        },
        "safety": {
            "wrote_tencent_or_business_db": False,
            "wrote_production_d1": False,
            "overwrote_protected_directories": False,
        },
        "source_status": source_manifest.get("status"),
    }
    write_json(out / "manifest.json", freeze_manifest)
    return freeze_manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile the v5 production-candidate freeze package")
    parser.add_argument("--source", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--imported-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--teacher-overrides")
    args = parser.parse_args()
    result = freeze_v5_production_candidate(
        Path(args.source),
        Path(args.catalog),
        Path(args.imported_root),
        Path(args.out),
        teacher_overrides=load_teacher_overrides(Path(args.teacher_overrides) if args.teacher_overrides else None),
    )
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
