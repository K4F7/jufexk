from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any

from build_identity_review_markdown import verified_evidence_path
from compile_production_staging import read_json, read_jsonl, sha256, write_json
from map_catalog_identities import normalize_source_label, verified_catalog


def build_pair_review(mapping_root: Path, staging_root: Path, catalog_root: Path, evidence_root: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    mapping_manifest_path = mapping_root / "manifest.json"
    mapping_manifest = read_json(mapping_manifest_path)
    staging_manifest_path = staging_root / "production-staging-manifest.json"
    if sha256(staging_manifest_path) != mapping_manifest.get("source_staging_manifest_sha256"):
        raise ValueError("staging manifest does not match mapping package")
    catalog_manifest, catalog_manifest_sha, catalog_rows = verified_catalog(catalog_root)
    if catalog_manifest_sha != mapping_manifest.get("approved_catalog_manifest_sha256"):
        raise ValueError("catalog manifest does not match mapping package")

    courses: dict[str, dict[str, Any]] = {}
    teachers_by_name: dict[str, list[str]] = defaultdict(list)
    course_codes_by_name: dict[str, list[str]] = defaultdict(list)
    teachers_by_course: dict[str, set[str]] = defaultdict(set)
    relations: set[tuple[str, str]] = set()
    for record in catalog_rows:
        value = record["value"]
        if record["recordType"] == "course":
            code = value["courseCode"]
            courses[code] = value
            names = {value["currentName"], *(item["rawName"] for item in value.get("nameVariants") or [])}
            for name in names:
                course_codes_by_name[normalize_source_label(name)].append(code)
        elif record["recordType"] == "teacher":
            teachers_by_name[normalize_source_label(value["sourceTeacherLabel"])].append(value["sourceTeacherLabel"])
        else:
            pair = (value["courseCode"], value["sourceTeacherLabel"])
            relations.add(pair)
            teachers_by_course[pair[0]].add(pair[1])
    for index in (course_codes_by_name, teachers_by_name):
        for key in index:
            index[key] = sorted(set(index[key]))

    required = read_jsonl(staging_root / "catalog-mapping-required.jsonl")
    resolved = {(row["legacy_course_id"], row["legacy_teacher_id"]) for row in read_jsonl(mapping_root / "resolved-mappings.jsonl")}
    additions = {
        (course_id, teacher_id)
        for row in read_jsonl(mapping_root / "catalog-addition-requests.jsonl")
        for course_id in row["legacy_course_ids"] for teacher_id in row["legacy_teacher_ids"]
    }
    relation_rows = read_jsonl(staging_root / "course-teachers.jsonl")
    relation_by_pair = {(row["course_id"], row["teacher_id"]): row for row in relation_rows}
    unresolved = [row for row in required if (row["legacy_course_id"], row["legacy_teacher_id"]) not in resolved | additions]

    lines = [
        "# 历史评价“课程名 + 教师”配对审核包 v1", "",
        "> 这不是审核评价正文，也不要求你辨认课号。程序已经自动确认所有唯一的“课程名 + 教师”任课关系；这里只保留仍然不唯一或找不到的配对。", "",
        "## 怎么填", "",
        "每项只在 `处理意见` 下写一句口语：`选第2个配对`、`老师名字应是某某`、`目录没有，需要新增`、`多个老师要拆开`、`信息无效，不要`、`看不出来`。", "",
        f"待审配对：**{len(unresolved)}**。", "",
    ]
    image_links = 0
    candidate_relations = 0
    zero_candidate_pairs = 0
    for number, row in enumerate(unresolved, 1):
        legacy_pair = (row["legacy_course_id"], row["legacy_teacher_id"])
        relation = relation_by_pair.get(legacy_pair)
        if not relation or not relation.get("provenance"):
            raise ValueError(f"unresolved pair lacks frozen provenance: {legacy_pair}")
        provenance = relation["provenance"][0]
        source = verified_evidence_path(evidence_root, provenance["context_source_file"], provenance["context_source_sha256"])
        relative = Path(os.path.relpath(source, out)).as_posix()
        course_codes = course_codes_by_name.get(normalize_source_label(row["legacy_course_name"]), [])
        teacher_labels = teachers_by_name.get(normalize_source_label(row["legacy_teacher_name"]), [])
        matches = sorted((code, label) for code in course_codes for label in teacher_labels if (code, label) in relations)
        related_teachers = sorted({label for code in course_codes for label in teachers_by_course.get(code, set())})
        source_teacher = row["legacy_teacher_name"]
        text_suggestions = [label for label in related_teachers if label in source_teacher or source_teacher in label]
        lines.extend([
            f"## {number:03d} · {legacy_pair[0]} + {legacy_pair[1]}", "",
            f"### 历史资料配对：{row['legacy_course_name']} + {row['legacy_teacher_name']}", "",
            f"原截图：`{provenance['worksheet']}` 第 {provenance['row']} 行；SHA-256 `{provenance['context_source_sha256']}`", "",
            f"![{legacy_pair[0]} + {legacy_pair[1]} 原始上下文截图](<{relative}>)", "",
        ])
        image_links += 1
        if matches:
            lines.extend(["### 现有目录中可能的任课关系", ""])
            for index, (code, label) in enumerate(matches, 1):
                lines.append(f"{index}. 课号 `{code}` · {courses[code]['currentName']} + 教师 {label}")
                candidate_relations += 1
            lines.append("")
        else:
            zero_candidate_pairs += 1
            lines.extend([
                "现有目录没有直接匹配的任课关系。", "",
                f"- 同名课程候选课号：{('、'.join(course_codes) or '（无）')}",
                f"- 同名教师候选：{('、'.join(teacher_labels) or '（无）')}",
                f"- 相关课程中与教师文字有包含关系的名字：{('、'.join(text_suggestions) or '（无）')}",
                f"- 相关课程全部目录教师（用于认错别字）：{('、'.join(related_teachers) or '（无）')}", "",
            ])
        lines.extend(["### 处理意见：", "", "", "---", ""])

    content = ("\n".join(lines) + "\n").encode("utf-8")
    out.mkdir(parents=True)
    review_path = out / "course-teacher-pair-review.md"
    review_path.write_bytes(content)
    manifest = {
        "contract_version": "legacy-course-teacher-pair-review-markdown-manifest-v1",
        "status": "awaiting_pair_decisions", "source_mapping_manifest_sha256": sha256(mapping_manifest_path),
        "approved_catalog_manifest_sha256": catalog_manifest_sha,
        "counts": {"tasks": len(unresolved), "image_links": image_links, "candidate_relations": candidate_relations, "zero_candidate_pairs": zero_candidate_pairs},
        "artifact": {"path": review_path.name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()},
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Build pair-level historical course-teacher review Markdown")
    for name in ("mapping-root", "staging-root", "catalog-root", "evidence-root", "out"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    result = build_pair_review(Path(args.mapping_root), Path(args.staging_root), Path(args.catalog_root), Path(args.evidence_root), Path(args.out))
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
