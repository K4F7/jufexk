from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from build_identity_review_markdown import evidence_version, verified_alias_queue, verified_evidence_path
from compile_production_staging import read_json, read_jsonl, sha256, write_json
from map_catalog_identities import verified_catalog


def text(value: Any) -> str:
    return str(value).replace("\r", " ").replace("\n", " ").strip()


def build_comparison_review(
    mapping_root: Path,
    staging_root: Path,
    catalog_root: Path,
    evidence_root: Path,
    out: Path,
) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    mapping_manifest, mapping_manifest_sha, aliases = verified_alias_queue(mapping_root)
    staging_manifest_path = staging_root / "production-staging-manifest.json"
    staging_manifest = read_json(staging_manifest_path)
    if sha256(staging_manifest_path) != mapping_manifest.get("source_staging_manifest_sha256"):
        raise ValueError("staging manifest does not match identity mapping package")
    catalog_manifest, catalog_manifest_sha, catalog_rows = verified_catalog(catalog_root)
    if catalog_manifest_sha != mapping_manifest.get("approved_catalog_manifest_sha256"):
        raise ValueError("approved catalog manifest does not match identity mapping package")

    courses: dict[str, dict[str, Any]] = {}
    teachers: dict[str, dict[str, Any]] = {}
    catalog_teachers_by_course: dict[str, set[str]] = defaultdict(set)
    for record in catalog_rows:
        value = record["value"]
        if record["recordType"] == "course":
            courses[value["courseCode"]] = value
        elif record["recordType"] == "teacher":
            teachers[value["sourceTeacherLabel"]] = value
        else:
            catalog_teachers_by_course[value["courseCode"]].add(value["sourceTeacherLabel"])

    entity_files = {"course": staging_root / "courses.jsonl", "teacher": staging_root / "teachers.jsonl"}
    entities: dict[str, dict[str, dict[str, Any]]] = {}
    for kind, path in entity_files.items():
        declaration = (staging_manifest.get("files") or {}).get(path.name)
        if not isinstance(declaration, dict) or sha256(path) != declaration.get("sha256"):
            raise ValueError(f"staging artifact integrity mismatch: {path.name}")
        key = f"{kind}_id"
        entities[kind] = {row[key]: row for row in read_jsonl(path)}

    required = read_jsonl(staging_root / "catalog-mapping-required.jsonl")
    evaluations = read_jsonl(staging_root / "api-ready-evaluations.jsonl")
    resolved = read_jsonl(mapping_root / "resolved-mappings.jsonl")
    resolved_course_codes: dict[str, set[str]] = defaultdict(set)
    for row in resolved:
        resolved_course_codes[row["legacy_course_id"]].add(row["catalog_course_code"])
    alias_by_identity = {(row["identity_kind"], row["legacy_identity_id"]): row for row in aliases}
    requirements_by_course: dict[str, list[dict[str, Any]]] = defaultdict(list)
    requirements_by_teacher: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in required:
        requirements_by_course[row["legacy_course_id"]].append(row)
        requirements_by_teacher[row["legacy_teacher_id"]].append(row)
    evaluation_counts = {
        "course": Counter(row["course_id"] for row in evaluations),
        "teacher": Counter(row["teacher_id"] for row in evaluations),
    }

    course_count = sum(row["identity_kind"] == "course" for row in aliases)
    lines = [
        "# 历史评价身份口语化对照审核包 v2", "",
        "> 这不是审核评价正文。你只需要判断截图里的课程/教师究竟对应哪个目录身份，或者应该新增、拆分、丢弃。", "",
        "## 怎么填", "",
        "每项只填写最后的 `处理意见`。可以直接写口语，例如：", "",
        "- `选第 2 个候选` / `就是课号 100...` / `就是目录教师某某`",
        "- `目录里没有，需要新增`",
        "- `这里有多个老师，需要拆开`",
        "- `信息残缺，不要这条`",
        "- `看不出来，先留着`", "",
        f"待审合计：**{len(aliases)}**（课程 {course_count}，教师 {len(aliases) - course_count}）。", "",
    ]
    image_links = 0
    candidate_references = 0
    unique_images: set[str] = set()
    for number, alias in enumerate(aliases, 1):
        kind = alias["identity_kind"]
        legacy_id = alias["legacy_identity_id"]
        entity = entities[kind].get(legacy_id)
        if not entity:
            raise ValueError(f"missing staging entity: {kind}:{legacy_id}")
        lines.extend([
            f"## {number:03d} · {kind}:{legacy_id}", "",
            f"### 历史资料里写的是：{text(alias['legacy_source_label'])}", "",
        ])
        provenance = next(iter(entity.get("provenance") or []), None)
        if not provenance:
            raise ValueError(f"review task lacks provenance: {kind}:{legacy_id}")
        source = verified_evidence_path(evidence_root, provenance["context_source_file"], provenance["context_source_sha256"])
        relative = Path(os.path.relpath(source, out)).as_posix()
        lines.extend([
            f"原截图位置：`{provenance['worksheet']}` 第 {provenance['row']} 行；SHA-256 `{provenance['context_source_sha256']}`", "",
            f"![{kind}:{legacy_id} 原始上下文截图](<{relative}>)", "",
        ])
        image_links += 1
        unique_images.add(source.as_posix())

        if kind == "course":
            related_teacher_names = sorted({row["legacy_teacher_name"] for row in requirements_by_course[legacy_id]})
            lines.extend([
                f"历史资料中与这门课一起出现的教师：{('、'.join(related_teacher_names) or '（无）')}", "",
                "### 你要判断：它对应下面哪一个目录课程？", "",
            ])
            candidate_codes = alias.get("catalog_candidate_identities") or []
            if not candidate_codes:
                lines.extend(["当前目录没有直接同名候选。请判断是需要新增，还是来源文字无效。", ""])
            for index, code in enumerate(candidate_codes, 1):
                candidate = courses.get(code)
                if not candidate:
                    raise ValueError(f"review queue references missing catalog course: {code}")
                variants = sorted({item["rawName"] for item in candidate.get("nameVariants") or []})
                catalog_teacher_names = sorted(catalog_teachers_by_course.get(code, set()))
                overlaps = sorted(set(related_teacher_names) & set(catalog_teacher_names))
                lines.extend([
                    f"#### 候选 {index}：课号 `{code}` · {text(candidate['currentName'])}", "",
                    f"- 历史名称变体：{('、'.join(variants) or '（无）')}",
                    f"- 评价模板：`{'sports' if candidate.get('category') == 'sports' else 'general'}`",
                    f"- 来源课程类别文字：{('、'.join(candidate.get('sourceCategoryTexts') or []) or '（无）')}",
                    f"- 与历史教师直接同名的目录教师：{('、'.join(overlaps) or '（无）')}",
                    f"- 该目录课程全部任课教师（用于对照）：{('、'.join(catalog_teacher_names) or '（无）')}", "",
                ])
                candidate_references += 1
        else:
            related_rows = requirements_by_teacher[legacy_id]
            course_descriptions = []
            candidate_codes: set[str] = set()
            for row in related_rows:
                resolved_codes = sorted(resolved_course_codes.get(row["legacy_course_id"], set()))
                course_alias = alias_by_identity.get(("course", row["legacy_course_id"]))
                codes = resolved_codes or list((course_alias or {}).get("catalog_candidate_identities") or [])
                candidate_codes.update(item for item in codes if item)
                suffix = f" → {', '.join(codes)}" if codes else " → 暂无目录候选"
                course_descriptions.append(f"{row['legacy_course_name']}{suffix}")
            related_catalog_teachers = sorted({
                label for code in candidate_codes for label in catalog_teachers_by_course.get(code, set())
            })
            source_label = text(alias["legacy_source_label"])
            textual_matches = [label for label in related_catalog_teachers if label in source_label or source_label in label]
            lines.extend([
                "### 你要判断：这是已有的哪位目录教师，还是需要新增/拆分/丢弃？", "",
                f"- 这段教师文字关联的历史课程：{('；'.join(course_descriptions) or '（无）')}",
                f"- 相关课程中与来源文字有包含关系的目录教师：{('、'.join(textual_matches) or '（无）')}",
                f"- 相关目录课程的全部教师（用于对照）：{('、'.join(related_catalog_teachers) or '（无）')}", "",
            ])
            candidate_references += len(related_catalog_teachers)
        affected = evaluation_counts[kind][legacy_id]
        relation_count = len(requirements_by_course[legacy_id] if kind == "course" else requirements_by_teacher[legacy_id])
        lines.extend([
            f"影响范围：{relation_count} 个任课关系；{affected} 条 API-ready 评价。", "",
            "### 处理意见：", "",
            "", "---", "",
        ])

    content = ("\n".join(lines) + "\n").encode("utf-8")
    out.mkdir(parents=True)
    review_path = out / "identity-review-comparison.md"
    review_path.write_bytes(content)
    manifest = {
        "contract_version": "legacy-identity-review-comparison-markdown-manifest-v1",
        "status": "awaiting_identity_decisions", "source_mapping_manifest_sha256": mapping_manifest_sha,
        "approved_catalog_manifest_sha256": catalog_manifest_sha,
        "counts": {
            "tasks": len(aliases), "courses": course_count, "teachers": len(aliases) - course_count,
            "image_links": image_links, "unique_source_images": len(unique_images), "catalog_candidate_references": candidate_references,
        },
        "artifact": {"path": review_path.name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()},
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a colloquial identity review with source screenshots and catalog comparisons")
    parser.add_argument("--mapping-root", required=True)
    parser.add_argument("--staging-root", required=True)
    parser.add_argument("--catalog-root", required=True)
    parser.add_argument("--evidence-root", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = build_comparison_review(
        Path(args.mapping_root), Path(args.staging_root), Path(args.catalog_root), Path(args.evidence_root), Path(args.out),
    )
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
