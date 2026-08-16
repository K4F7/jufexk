from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any

from compile_production_staging import read_json, read_jsonl, sha256, write_json


def escape_table(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def verified_alias_queue(mapping_root: Path) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    manifest_path = mapping_root / "manifest.json"
    manifest = read_json(manifest_path)
    declaration = (manifest.get("files") or {}).get("alias-exceptions.jsonl")
    alias_path = mapping_root / "alias-exceptions.jsonl"
    if manifest.get("contract_version") != "legacy-catalog-identity-mapping-manifest-v1" or not isinstance(declaration, dict):
        raise ValueError("invalid identity mapping package")
    if not alias_path.is_file() or sha256(alias_path) != declaration.get("sha256"):
        raise ValueError("alias queue integrity mismatch")
    rows = read_jsonl(alias_path)
    if len(rows) != declaration.get("rows") or len(rows) != (manifest.get("counts") or {}).get("alias_exceptions"):
        raise ValueError("alias queue count mismatch")
    return manifest, sha256(manifest_path), rows


def build_identity_review_markdown(mapping_root: Path, staging_root: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    mapping_manifest, mapping_manifest_sha, aliases = verified_alias_queue(mapping_root)
    staging_manifest_path = staging_root / "production-staging-manifest.json"
    staging_manifest = read_json(staging_manifest_path)
    if sha256(staging_manifest_path) != mapping_manifest.get("source_staging_manifest_sha256"):
        raise ValueError("staging manifest does not match identity mapping package")
    required_path = staging_root / "catalog-mapping-required.jsonl"
    evaluations_path = staging_root / "api-ready-evaluations.jsonl"
    for path in (required_path, evaluations_path):
        declaration = (staging_manifest.get("files") or {}).get(path.name)
        if not isinstance(declaration, dict) or sha256(path) != declaration.get("sha256"):
            raise ValueError(f"staging artifact integrity mismatch: {path.name}")
    required = read_jsonl(required_path)
    evaluations = read_jsonl(evaluations_path)
    course_pairs = Counter(row["legacy_course_id"] for row in required)
    teacher_pairs = Counter(row["legacy_teacher_id"] for row in required)
    course_evaluations = Counter(row["course_id"] for row in evaluations)
    teacher_evaluations = Counter(row["teacher_id"] for row in evaluations)

    course_count = sum(row.get("identity_kind") == "course" for row in aliases)
    teacher_count = len(aliases) - course_count
    lines = [
        "# 历史评价目录身份人工审核包 v1", "",
        "> 本文件只处理仍无法由冻结目录证据唯一确认的课程/教师身份。已批准的 68 条任课关系补充申请不在本表中。", "",
        "## 填写规则", "",
        "只编辑每行最后三列：`decision`、`target`、`note`。不要修改 `task_id` 或证据列。", "",
        "- `approve_alias`：映射到现有目录身份；`target` 必填。课程填课号，教师填原样来源教师名。",
        "- `catalog_addition_request`：无法映射到现有身份，提交目录补充申请；`target` 留空。",
        "- `reject`：历史身份或绑定不可用；`target` 留空。",
        "- `split_required`：仅教师复合标签使用，表示必须拆分后再审；`target` 留空。",
        "- 尚未决定的行保持 `decision` 为空。", "",
        f"待审合计：**{len(aliases)}**（课程 {course_count}，教师 {teacher_count}）。", "",
        "| task_id | kind | source_label | reason | catalog_candidates | relation_pairs | api_ready_evaluations | decision | target | note |",
        "|---|---|---|---|---|---:|---:|---|---|---|",
    ]
    for row in aliases:
        kind = row["identity_kind"]
        legacy_id = row["legacy_identity_id"]
        candidates = ", ".join(row.get("catalog_candidate_identities") or [])
        pairs = course_pairs[legacy_id] if kind == "course" else teacher_pairs[legacy_id]
        affected = course_evaluations[legacy_id] if kind == "course" else teacher_evaluations[legacy_id]
        values = [
            f"{kind}:{legacy_id}", kind, row["legacy_source_label"], row["reason"], candidates,
            pairs, affected, "", "", "",
        ]
        lines.append("| " + " | ".join(escape_table(value) for value in values) + " |")
    content = ("\n".join(lines) + "\n").encode("utf-8")
    out.mkdir(parents=True)
    review_path = out / "identity-review.md"
    review_path.write_bytes(content)
    manifest = {
        "contract_version": "legacy-identity-review-markdown-manifest-v1",
        "status": "awaiting_identity_decisions", "source_mapping_manifest_sha256": mapping_manifest_sha,
        "source_staging_manifest_sha256": mapping_manifest.get("source_staging_manifest_sha256"),
        "counts": {"tasks": len(aliases), "courses": course_count, "teachers": teacher_count},
        "artifact": {"path": review_path.name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()},
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def evidence_version(path: Path) -> int:
    match = re.search(r"full-\d+-v(\d+)", path.as_posix())
    return int(match.group(1)) if match else -1


def verified_evidence_path(evidence_root: Path, relative_path: str, expected_sha256: str) -> Path:
    matches = []
    for version_root in evidence_root.glob("full-*"):
        candidate = version_root / Path(relative_path)
        if candidate.is_file() and sha256(candidate) == expected_sha256:
            matches.append(candidate)
    if not matches:
        raise ValueError(f"no frozen source screenshot matches declared hash: {relative_path}")
    return sorted(matches, key=lambda path: (evidence_version(path), path.as_posix()))[-1]


def build_identity_review_markdown_with_images(mapping_root: Path, staging_root: Path, evidence_root: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    mapping_manifest, mapping_manifest_sha, aliases = verified_alias_queue(mapping_root)
    staging_manifest_path = staging_root / "production-staging-manifest.json"
    staging_manifest = read_json(staging_manifest_path)
    if sha256(staging_manifest_path) != mapping_manifest.get("source_staging_manifest_sha256"):
        raise ValueError("staging manifest does not match identity mapping package")
    entity_files = {"course": staging_root / "courses.jsonl", "teacher": staging_root / "teachers.jsonl"}
    entities: dict[str, dict[str, dict[str, Any]]] = {}
    for kind, path in entity_files.items():
        declaration = (staging_manifest.get("files") or {}).get(path.name)
        if not isinstance(declaration, dict) or sha256(path) != declaration.get("sha256"):
            raise ValueError(f"staging artifact integrity mismatch: {path.name}")
        id_field = f"{kind}_id"
        entities[kind] = {row[id_field]: row for row in read_jsonl(path)}
    required = read_jsonl(staging_root / "catalog-mapping-required.jsonl")
    evaluations = read_jsonl(staging_root / "api-ready-evaluations.jsonl")
    pair_counts = {
        "course": Counter(row["legacy_course_id"] for row in required),
        "teacher": Counter(row["legacy_teacher_id"] for row in required),
    }
    evaluation_counts = {
        "course": Counter(row["course_id"] for row in evaluations),
        "teacher": Counter(row["teacher_id"] for row in evaluations),
    }
    course_count = sum(row["identity_kind"] == "course" for row in aliases)
    lines = [
        "# 历史评价目录身份人工审核包（带原截图）v1", "",
        "> 每项图片均按冻结证据中的 SHA-256 定位到原始上下文截图；图片只是审核界面，机器权威仍是 manifest 与 JSONL。", "",
        "## 填写规则", "",
        "只填写每项末尾的 `decision`、`target`、`note`，不要修改 `task_id` 与证据字段。", "",
        "- `approve_alias`：确认映射到已有目录身份；课程 target 填课号，教师 target 填原样来源教师名。",
        "- `catalog_addition_request`：确认目录缺失；target 留空。",
        "- `reject`：来源身份无效或不应导入；target 留空。",
        "- `split_required`：教师来源标签包含多人，必须拆分；target 留空。", "",
        f"待审合计：**{len(aliases)}**（课程 {course_count}，教师 {len(aliases) - course_count}）。", "",
    ]
    image_links = 0
    unique_images: set[str] = set()
    for number, alias in enumerate(aliases, 1):
        kind = alias["identity_kind"]
        legacy_id = alias["legacy_identity_id"]
        entity = entities[kind].get(legacy_id)
        if not entity:
            raise ValueError(f"missing staging entity for review task: {kind}:{legacy_id}")
        candidates = ", ".join(alias.get("catalog_candidate_identities") or []) or "（无）"
        lines.extend([
            f"## {number:03d} · {kind}:{legacy_id}", "",
            f"- **source_label**: {alias['legacy_source_label']}",
            f"- **reason**: `{alias['reason']}`",
            f"- **catalog_candidates**: {candidates}",
            f"- **影响范围**: {pair_counts[kind][legacy_id]} 个任课关系；{evaluation_counts[kind][legacy_id]} 条 API-ready 评价", "",
        ])
        selected: list[dict[str, Any]] = []
        seen_evidence: set[tuple[str, str]] = set()
        for provenance in entity.get("provenance") or []:
            key = (str(provenance.get("context_source_file", "")), str(provenance.get("context_source_sha256", "")))
            if not all(key) or key in seen_evidence:
                continue
            seen_evidence.add(key)
            selected.append(provenance)
            if len(selected) == 3:
                break
        if not selected:
            raise ValueError(f"review task lacks context source provenance: {kind}:{legacy_id}")
        for index, provenance in enumerate(selected, 1):
            source = verified_evidence_path(evidence_root, provenance["context_source_file"], provenance["context_source_sha256"])
            relative = Path(os.path.relpath(source, out)).as_posix()
            lines.extend([
                f"**原始上下文截图 {index}** — `{provenance['worksheet']}` 第 {provenance['row']} 行；SHA-256 `{provenance['context_source_sha256']}`", "",
                f"![{kind}:{legacy_id} 原始上下文截图 {index}](<{relative}>)", "",
            ])
            image_links += 1
            unique_images.add(source.as_posix())
        lines.extend([
            "- **decision**: ",
            "- **target**: ",
            "- **note**: ", "",
            "---", "",
        ])
    content = ("\n".join(lines) + "\n").encode("utf-8")
    out.mkdir(parents=True)
    review_path = out / "identity-review-with-images.md"
    review_path.write_bytes(content)
    manifest = {
        "contract_version": "legacy-identity-review-markdown-with-images-manifest-v1",
        "status": "awaiting_identity_decisions", "source_mapping_manifest_sha256": mapping_manifest_sha,
        "source_staging_manifest_sha256": mapping_manifest.get("source_staging_manifest_sha256"),
        "counts": {"tasks": len(aliases), "courses": course_count, "teachers": len(aliases) - course_count, "image_links": image_links, "unique_source_images": len(unique_images)},
        "artifact": {"path": review_path.name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()},
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the remaining historical identity review as Markdown")
    parser.add_argument("--mapping-root", required=True)
    parser.add_argument("--staging-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--evidence-root")
    args = parser.parse_args()
    result = (
        build_identity_review_markdown_with_images(Path(args.mapping_root), Path(args.staging_root), Path(args.evidence_root), Path(args.out))
        if args.evidence_root else
        build_identity_review_markdown(Path(args.mapping_root), Path(args.staging_root), Path(args.out))
    )
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
