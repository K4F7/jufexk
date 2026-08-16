from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from build_identity_review_markdown import verified_evidence_path
from compile_production_staging import read_json, read_jsonl, sha256, write_json, write_jsonl
from map_catalog_identities import normalize_source_label, verified_catalog


def identity_key(value: str) -> str:
    return re.sub(r"[^0-9a-z\u3400-\u9fff]+", "", normalize_source_label(value))


def source_by_hash(evidence_root: Path, relative_path: str, expected_sha256: str) -> Path:
    try:
        return verified_evidence_path(evidence_root, relative_path, expected_sha256)
    except ValueError:
        matches = [path for path in evidence_root.glob("full-*/**/*") if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png"} and sha256(path) == expected_sha256]
        if not matches:
            raise
        return sorted(matches, key=lambda path: path.as_posix())[-1]


def build_review(policy_root: Path, manual_root: Path, staging_root: Path, catalog_root: Path, evidence_root: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    policy_manifest = read_json(policy_root / "manifest.json")
    policy_path = policy_root / "policy-decisions.jsonl"
    declared = policy_manifest["files"][policy_path.name]
    if sha256(policy_path) != declared["sha256"]:
        raise ValueError("policy decision integrity mismatch")
    policy = read_jsonl(policy_path)
    manual = read_jsonl(manual_root / "compiled-decisions.jsonl")
    _catalog_manifest, catalog_sha, catalog = verified_catalog(catalog_root)

    course_codes: dict[str, set[str]] = defaultdict(set)
    for record in catalog:
        if record["recordType"] != "course":
            continue
        value = record["value"]
        names = {value["currentName"], *(item["rawName"] for item in value.get("nameVariants") or [])}
        for name in names:
            course_codes[identity_key(name)].add(value["courseCode"])

    courses = {row["course_id"]: row for row in read_jsonl(staging_root / "courses.jsonl")}
    evaluations = read_jsonl(staging_root / "api-ready-evaluations.jsonl")
    affected = Counter(row["course_id"] for row in evaluations)
    requested = {row["legacy_course_id"]: row for row in policy if "course_identity" in (row.get("requested_additions") or [])}
    automatic, unresolved = [], []
    for legacy_id, row in sorted(requested.items()):
        matches = sorted(course_codes.get(identity_key(courses[legacy_id]["name"]), set()))
        if len(matches) == 1:
            automatic.append({"schema_version": "legacy-catalog-identity-reconciliation-v1", "identity_kind": "course", "legacy_identity_id": legacy_id, "decision": "bind_existing_course", "catalog_course_code": matches[0], "evidence": "approved_catalog_exact_name_or_variant"})
        else:
            unresolved.append((legacy_id, row))

    teacher_ids = {row["legacy_teacher_id"] for row in policy if "teacher_identity" in (row.get("requested_additions") or [])}
    manual_teacher_labels = {
        target["teacher_label"] for row in manual if row["decision"] != "reject"
        for target in row["teacher_decisions"] if "teacher_identity" in (target.get("requested_additions") or [])
    }
    lines = [
        "# 缺失目录身份精简审核包（带原截图）v1", "",
        "> 评价是否保留已经决定。本文件只处理正式目录身份；不会让你重新审核评价正文。", "",
        "## 已无人值守处理", "",
        f"- 课程：{len(automatic)} 项由批准目录的课程当前名/历史名称变体唯一绑定。",
        f"- 教师：{len(teacher_ids) + len(manual_teacher_labels)} 个来源目标沿用你已确认的“历史目录有这个老师就保留”政策，进入目录补充申请，不再逐项询问。", "",
        "## 怎么填下面的课程", "",
        "每项只在 `处理意见` 后写一句话：知道正式课号就写 `课号 100...`；不知道就写 `保留待补课号`；来源明显无效才写 `丢弃`。", "",
        f"待处理课程：**{len(unresolved)}**。", "",
    ]
    image_links = 0
    for number, (legacy_id, row) in enumerate(unresolved, 1):
        entity = courses[legacy_id]
        provenance = next(iter(entity.get("provenance") or []), None)
        if not provenance:
            raise ValueError(f"missing course provenance: {legacy_id}")
        source = source_by_hash(evidence_root, provenance["context_source_file"], provenance["context_source_sha256"])
        relative = Path(os.path.relpath(source, out)).as_posix()
        lines.extend([
            f"## {number:03d} · {legacy_id}", "",
            f"历史资料课程名：{row['legacy_course_name']}", "",
            f"影响：{affected[legacy_id]} 条 API-ready 评价。", "",
            f"原截图：`{provenance['worksheet']}` 第 {provenance['row']} 行；SHA-256 `{provenance['context_source_sha256']}`", "",
            f"![{legacy_id} 原始上下文截图](<{relative}>)", "",
            "### 处理意见：", "", "", "---", "",
        ])
        image_links += 1

    out.mkdir(parents=True)
    auto_artifact = write_jsonl(out / "auto-resolved-courses.jsonl", automatic)
    review = ("\n".join(lines) + "\n").encode("utf-8")
    (out / "manual-review.md").write_bytes(review)
    manifest = {
        "contract_version": "legacy-missing-catalog-identity-review-manifest-v1", "status": "awaiting_course_codes",
        "approved_catalog_manifest_sha256": catalog_sha, "source_policy_decisions_sha256": sha256(policy_path),
        "source_manual_decisions_sha256": sha256(manual_root / "compiled-decisions.jsonl"),
        "counts": {"course_identity_inputs": len(requested), "auto_resolved_courses": len(automatic), "manual_course_tasks": len(unresolved), "owner_approved_teacher_addition_targets": len(teacher_ids) + len(manual_teacher_labels), "image_links": image_links},
        "files": {"auto-resolved-courses.jsonl": auto_artifact, "manual-review.md": {"bytes": len(review), "sha256": hashlib.sha256(review).hexdigest()}},
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("policy-root", "manual-root", "staging-root", "catalog-root", "evidence-root", "out"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    result = build_review(*(Path(getattr(args, name.replace('-', '_'))) for name in ("policy-root", "manual-root", "staging-root", "catalog-root", "evidence-root", "out")))
    print(json.dumps({"status": result["status"], "counts": result["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
