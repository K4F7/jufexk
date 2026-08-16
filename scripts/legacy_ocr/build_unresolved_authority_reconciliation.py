from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from build_missing_catalog_identity_review import source_by_hash
from compile_production_staging import read_json, read_jsonl, sha256, write_json, write_jsonl
from map_catalog_identities import normalize_source_label, verified_catalog


def course_forms(value: str) -> set[str]:
    forms: set[str] = set()
    for part in re.split(r"(?i)or", value):
        normalized = re.sub(r"^\d+", "", part.strip())
        normalized = unicodedata.normalize("NFKC", normalized).lower()
        normalized = normalized.replace("（和", "与").replace("(和", "与")
        normalized = normalized.replace("及", "与").replace("和", "与")
        normalized = re.sub(r"[^0-9a-z\u3400-\u9fff]+", "", normalized)
        if normalized:
            forms.add(normalized)
    return forms


def one_substitution(left: str, right: str) -> bool:
    return len(left) == len(right) and sum(a != b for a, b in zip(left, right)) == 1


def verified_jsonl(root: Path, manifest_name: str, file_name: str, contract: str) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    manifest_path = root / manifest_name
    manifest = read_json(manifest_path)
    declaration = (manifest.get("files") or {}).get(file_name)
    path = root / file_name
    if manifest.get("contract_version") != contract or not isinstance(declaration, dict):
        raise ValueError(f"invalid manifest declaration: {manifest_path}")
    if not path.is_file() or sha256(path) != declaration.get("sha256"):
        raise ValueError(f"artifact integrity mismatch: {path}")
    rows = read_jsonl(path)
    if len(rows) != declaration.get("rows"):
        raise ValueError(f"artifact row mismatch: {path}")
    return manifest, sha256(manifest_path), rows


def best_relation_candidate(candidates: set[str], known_teachers: set[str], relations: dict[str, set[str]]) -> tuple[str | None, int, int]:
    scored = sorted(
        ((len(relations.get(code, set()) & known_teachers), code) for code in candidates),
        reverse=True,
    )
    if not scored or scored[0][0] == 0:
        return None, 0, scored[1][0] if len(scored) > 1 else 0
    runner_up = scored[1][0] if len(scored) > 1 else 0
    if scored[0][0] == runner_up:
        return None, scored[0][0], runner_up
    return scored[0][1], scored[0][0], runner_up


def reconcile_course(
    decision: dict[str, Any],
    course_names: dict[str, set[str]],
    known_teachers: set[str],
    relations: dict[str, set[str]],
) -> dict[str, Any] | None:
    query = decision["approved_course_query"]
    strict = {
        code
        for code, names in course_names.items()
        if normalize_source_label(query) in {normalize_source_label(name) for name in names}
    }
    if len(strict) == 1:
        selected, method, overlap, runner_up = next(iter(strict)), "strict_name_unique", 0, 0
    else:
        selected, overlap, runner_up = best_relation_candidate(strict, known_teachers, relations)
        method = "strict_name_relation_score_unique"
        if selected is None:
            query_forms = course_forms(query)
            semantic = {
                code for code, names in course_names.items()
                if query_forms & {form for name in names for form in course_forms(name)}
            }
            selected, overlap, runner_up = best_relation_candidate(semantic, known_teachers, relations)
            method = "owner_name_semantic_relation_score_unique"
            if selected is None and len(semantic) == 1:
                selected, method, overlap, runner_up = next(iter(semantic)), "owner_name_semantic_unique", 0, 0
            if selected is None:
                family = {
                    code for code, names in course_names.items()
                    if any(
                        (left.startswith(right) or right.startswith(left)) and min(len(left), len(right)) >= 2
                        for left in query_forms
                        for name in names
                        for right in course_forms(name)
                    )
                }
                selected, overlap, runner_up = best_relation_candidate(family, known_teachers, relations)
                method = "owner_name_family_relation_score_unique"
    if selected is None:
        return None
    return {
        "schema_version": "legacy-authority-course-binding-v1",
        "legacy_course_id": decision["legacy_course_id"],
        "approved_course_query": query,
        "catalog_course_code": selected,
        "decision": "bind_existing_course",
        "match_method": method,
        "authority_relation_overlap": overlap,
        "authority_relation_runner_up": runner_up,
    }


def build_reconciliation(
    package_root: Path,
    course_decisions_root: Path,
    staging_root: Path,
    catalog_root: Path,
    evidence_root: Path,
    visual_decisions_path: Path,
    out: Path,
) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    package_manifest, package_sha, requests = verified_jsonl(
        package_root, "manifest.json", "catalog-addition-requests.jsonl", "legacy-historical-approved-package-v1"
    )
    _, _, unresolved_reviews = verified_jsonl(
        package_root, "manifest.json", "unresolved-legacy-reviews.jsonl", "legacy-historical-approved-package-v1"
    )
    course_manifest, course_manifest_sha, course_decisions = verified_jsonl(
        course_decisions_root, "manifest.json", "compiled-decisions.jsonl", "legacy-missing-catalog-course-decisions-manifest-v1"
    )
    staging_manifest, staging_sha, evaluations = verified_jsonl(
        staging_root, "production-staging-manifest.json", "api-ready-evaluations.jsonl", "legacy-production-staging-v1"
    )
    for name in ("courses.jsonl", "teachers.jsonl", "course-teachers.jsonl"):
        declaration = staging_manifest["files"][name]
        path = staging_root / name
        if sha256(path) != declaration["sha256"] or len(read_jsonl(path)) != declaration["rows"]:
            raise ValueError(f"staging artifact integrity mismatch: {path}")
    catalog_manifest, catalog_sha, catalog_rows = verified_catalog(catalog_root)
    if package_manifest.get("approved_catalog_manifest_sha256") != catalog_sha:
        raise ValueError("approved package catalog lineage mismatch")

    visual_decisions = read_jsonl(visual_decisions_path)
    visual_by_label: dict[str, dict[str, Any]] = {}
    for row in visual_decisions:
        label = row.get("legacy_source_label")
        if row.get("identity_kind") != "teacher" or not isinstance(label, str) or not label or label in visual_by_label:
            raise ValueError("invalid or duplicate visual teacher decision")
        if row.get("decision") not in {"bind_existing_teacher", "preserve_as_catalog_addition", "manual_review", "reject"}:
            raise ValueError("invalid visual teacher decision")
        visual_by_label[label] = row

    authority_courses: dict[str, dict[str, Any]] = {}
    authority_teachers: dict[str, dict[str, Any]] = {}
    relations: dict[str, set[str]] = defaultdict(set)
    for record in catalog_rows:
        value = record["value"]
        if record["recordType"] == "course":
            authority_courses[value["courseCode"]] = value
        elif record["recordType"] == "teacher":
            authority_teachers[value["sourceTeacherLabel"]] = value
        else:
            relations[value["courseCode"]].add(value["sourceTeacherLabel"])
    course_names = {
        code: {value["currentName"], *(item["rawName"] for item in value.get("nameVariants") or [])}
        for code, value in authority_courses.items()
    }

    courses = {row["course_id"]: row for row in read_jsonl(staging_root / "courses.jsonl")}
    teachers = {row["teacher_id"]: row for row in read_jsonl(staging_root / "teachers.jsonl")}
    teacher_ids_by_name: dict[str, set[str]] = defaultdict(set)
    for teacher_id, row in teachers.items():
        teacher_ids_by_name[row["name"]].add(teacher_id)
    teachers_by_course: dict[str, set[str]] = defaultdict(set)
    for row in read_jsonl(staging_root / "course-teachers.jsonl"):
        teachers_by_course[row["course_id"]].add(teachers[row["teacher_id"]]["name"])
    evaluation_by_id = {row["evaluation_id"]: row for row in evaluations}
    affected_courses = Counter(row["course_id"] for row in evaluations)

    automatic_courses: list[dict[str, Any]] = []
    residual_courses: list[dict[str, Any]] = []
    for decision in sorted(course_decisions, key=lambda row: row["legacy_course_id"]):
        if decision["decision"] != "preserve_pending_course_code":
            continue
        known_teachers = teachers_by_course[decision["legacy_course_id"]] & set(authority_teachers)
        binding = reconcile_course(decision, course_names, known_teachers, relations)
        if binding:
            binding["affected_api_ready_evaluations"] = affected_courses[decision["legacy_course_id"]]
            automatic_courses.append(binding)
        else:
            residual_courses.append({
                "schema_version": "legacy-authority-residual-course-v1",
                "legacy_course_id": decision["legacy_course_id"],
                "approved_course_query": decision["approved_course_query"],
                "status": "preserve_pending_official_course_code",
                "affected_api_ready_evaluations": affected_courses[decision["legacy_course_id"]],
            })
    automatic_course_codes = {row["legacy_course_id"]: row["catalog_course_code"] for row in automatic_courses}

    codes_by_teacher_label: dict[str, set[str]] = defaultdict(set)
    teacher_ids_by_proposed_label: dict[str, set[str]] = defaultdict(set)
    for row in unresolved_reviews:
        label = row.get("proposed_teacher_label")
        if not label:
            continue
        evaluation = evaluation_by_id[row["source_evaluation_id"]]
        teacher_ids_by_proposed_label[label].add(evaluation["teacher_id"])
        code = row.get("catalog_course_code") or automatic_course_codes.get(evaluation["course_id"])
        if code:
            codes_by_teacher_label[label].add(code)

    teacher_requests = sorted(
        (row for row in requests if row["request_kind"] == "teacher_identity"),
        key=lambda row: row["proposed_source_teacher_label"],
    )
    automatic_teachers: list[dict[str, Any]] = []
    approved_teacher_additions: list[dict[str, Any]] = []
    manual_teachers: list[dict[str, Any]] = []
    rejected_teachers: list[dict[str, Any]] = []
    requested_labels = {row["proposed_source_teacher_label"] for row in teacher_requests}
    if not set(visual_by_label) <= requested_labels:
        raise ValueError("visual decision references unknown teacher request")
    for request in teacher_requests:
        label = request["proposed_source_teacher_label"]
        codes = codes_by_teacher_label[label]
        near = [candidate for candidate in authority_teachers if one_substitution(label, candidate)]
        scores = sorted(
            ((sum(candidate in relations.get(code, set()) for code in codes), candidate) for candidate in near),
            reverse=True,
        )
        selected = None
        method = None
        if scores and scores[0][0] > 0 and (len(scores) == 1 or scores[0][0] > scores[1][0]):
            selected, method = scores[0][1], "one_character_authority_alias_relation_unique"
        visual = visual_by_label.get(label)
        force_addition = bool(visual and visual["decision"] == "preserve_as_catalog_addition")
        if force_addition:
            selected, method = None, None
        if visual and visual["decision"] == "bind_existing_teacher":
            visual_target = visual.get("catalog_teacher_label")
            if visual_target not in authority_teachers:
                raise ValueError(f"visual decision target absent from authority catalog: {visual_target}")
            if selected and selected != visual_target:
                raise ValueError(f"visual and relation teacher decisions conflict: {label}")
            selected, method = visual_target, visual.get("evidence", "verified_source_screenshot")
        if selected:
            automatic_teachers.append({
                "schema_version": "legacy-authority-teacher-binding-v1",
                "legacy_source_label": label,
                "legacy_teacher_ids": sorted(teacher_ids_by_proposed_label[label] or teacher_ids_by_name.get(label, set())),
                "catalog_teacher_label": selected,
                "decision": "bind_existing_teacher",
                "match_method": method,
                "catalog_course_codes": sorted(codes),
            })
        elif visual and visual["decision"] == "reject":
            rejected_teachers.append({
                "schema_version": "legacy-authority-rejected-teacher-v1",
                "legacy_source_label": label,
                "legacy_teacher_ids": sorted(teacher_ids_by_proposed_label[label] or teacher_ids_by_name.get(label, set())),
                "decision": "reject",
                "owner_note": visual.get("owner_note", "owner_rejected_invalid_teacher_identity"),
            })
        elif visual and visual["decision"] == "manual_review":
            manual_teachers.append({
                "schema_version": "legacy-authority-manual-teacher-v1",
                "legacy_source_label": label,
                "legacy_teacher_ids": sorted(teacher_ids_by_proposed_label[label] or teacher_ids_by_name.get(label, set())),
                "status": "owner_review_required",
                "reason": visual.get("evidence", "source_label_not_a_stable_teacher_identity"),
            })
        else:
            approved_teacher_additions.append({
                "schema_version": "legacy-authority-approved-teacher-addition-v1",
                "proposed_source_teacher_label": label,
                "decision": "owner_approved_catalog_addition",
                "basis": visual.get("evidence", "owner_policy_preserve_historical_directory_teacher") if visual else "owner_policy_preserve_historical_directory_teacher",
            })
    if len(automatic_teachers) + len(approved_teacher_additions) + len(manual_teachers) + len(rejected_teachers) != len(teacher_requests):
        raise ValueError("teacher reconciliation partition mismatch")

    manual_lines = [
        "# unresolved 权威目录比对后人工确认包 v1", "",
        "> 课程和老师已经尽量与权威目录自动比对。这里不重新审核评价正文。", "",
        "## 已无人值守处理", "",
        f"- 课程：{len(automatic_courses)} 个历史课程身份已唯一绑定权威目录；{len(residual_courses)} 个仍缺正式课号，继续保留等待补号。",
        f"- 老师：{len(automatic_teachers)} 个历史名字已绑定权威目录现有老师；{len(approved_teacher_additions)} 个按你批准的政策保留为目录补充。",
        "- 课程—老师关系：批准包中已有的关系按复合键去重，不重复追加。", "",
        "## 怎么填", "",
        "下面每项只写一句口语化意见即可：`不是老师，丢掉`、`这个就是老师名字，保留`，或者直接写正确老师名。", "",
        f"真正需要人工确认：**{len(manual_teachers)} 项**。", "",
    ]
    image_links = 0
    for number, item in enumerate(manual_teachers, 1):
        label = item["legacy_source_label"]
        matching_entities = [teachers[teacher_id] for teacher_id in item["legacy_teacher_ids"] if teacher_id in teachers]
        if not matching_entities:
            raise ValueError(f"manual teacher lacks staging provenance: {label}")
        provenance = matching_entities[0]["provenance"][0]
        source = source_by_hash(evidence_root, provenance["context_source_file"], provenance["context_source_sha256"])
        relative = Path(os.path.relpath(source, out)).as_posix()
        manual_lines.extend([
            f"## {number:03d} · 教师栏 `{label}`", "",
            f"原截图：`{provenance['worksheet']}` 第 {provenance['row']} 行；SHA-256 `{provenance['context_source_sha256']}`", "",
            f"![教师栏 {label} 的原始上下文截图](<{relative}>)", "",
            "### 处理意见：", "", "", "---", "",
        ])
        image_links += 1

    out.mkdir(parents=True)
    outputs = {
        "auto-course-bindings.jsonl": automatic_courses,
        "residual-course-identities.jsonl": residual_courses,
        "auto-teacher-bindings.jsonl": automatic_teachers,
        "approved-teacher-additions.jsonl": approved_teacher_additions,
        "manual-teacher-identities.jsonl": manual_teachers,
        "rejected-teacher-identities.jsonl": rejected_teachers,
    }
    files = {name: write_jsonl(out / name, rows) for name, rows in outputs.items()}
    review_bytes = ("\n".join(manual_lines) + "\n").encode("utf-8")
    (out / "manual-review.md").write_bytes(review_bytes)
    files["manual-review.md"] = {"bytes": len(review_bytes), "sha256": hashlib.sha256(review_bytes).hexdigest()}
    counts = {
        "course_identity_inputs": len(automatic_courses) + len(residual_courses),
        "auto_course_bindings": len(automatic_courses),
        "residual_course_identities": len(residual_courses),
        "teacher_identity_inputs": len(teacher_requests),
        "auto_teacher_bindings": len(automatic_teachers),
        "approved_teacher_additions": len(approved_teacher_additions),
        "manual_teacher_tasks": len(manual_teachers),
        "rejected_teacher_identities": len(rejected_teachers),
        "manual_image_links": image_links,
    }
    manifest = {
        "contract_version": "legacy-unresolved-authority-reconciliation-manifest-v1",
        "status": "awaiting_owner_review" if manual_teachers else "reconciled",
        "approved_catalog_manifest_sha256": catalog_sha,
        "approved_catalog_content_sha256": catalog_manifest.get("contentSha256"),
        "source_historical_package_manifest_sha256": package_sha,
        "source_course_decisions_manifest_sha256": course_manifest_sha,
        "source_staging_manifest_sha256": staging_sha,
        "source_visual_decisions_sha256": sha256(visual_decisions_path),
        "counts": counts,
        "files": files,
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("package-root", "course-decisions-root", "staging-root", "catalog-root", "evidence-root", "visual-decisions", "out"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    manifest = build_reconciliation(
        Path(args.package_root),
        Path(args.course_decisions_root),
        Path(args.staging_root),
        Path(args.catalog_root),
        Path(args.evidence_root),
        Path(args.visual_decisions),
        Path(args.out),
    )
    print(json.dumps({"status": manifest["status"], "counts": manifest["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
