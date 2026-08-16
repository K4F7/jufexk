from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "legacy-catalog-identity-smoke/v1"


def normalize(value: str | None) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value or "")).casefold()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare(
    evaluations: list[dict[str, Any]],
    courses: list[dict[str, Any]],
    teachers: list[dict[str, Any]],
    relations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    course_codes_by_name: dict[str, set[str]] = defaultdict(set)
    for course in courses:
        names = [course["currentName"], *(variant["rawName"] for variant in course["nameVariants"])]
        for name in names:
            course_codes_by_name[normalize(name)].add(course["courseCode"])
    teacher_labels_by_name: dict[str, set[str]] = defaultdict(set)
    for teacher in teachers:
        teacher_labels_by_name[normalize(teacher["sourceTeacherLabel"])].add(teacher["sourceTeacherLabel"])
    teachers_by_course: dict[str, set[str]] = defaultdict(set)
    courses_by_teacher: dict[str, set[str]] = defaultdict(set)
    for relation in relations:
        teachers_by_course[relation["courseCode"]].add(relation["sourceTeacherLabel"])
        courses_by_teacher[normalize(relation["sourceTeacherLabel"])].add(relation["courseCode"])

    results = []
    for item in evaluations:
        reasons = set(item.get("production_reasons", []))
        if "review_uncertain" in reasons or not reasons.intersection({"course_unclear", "teacher_unclear"}):
            continue
        candidate_courses: set[str] = set()
        candidate_teachers: set[str] = set()
        if reasons == {"course_unclear"}:
            labels = teacher_labels_by_name.get(normalize(item.get("teacher_name")), set())
            for label in labels:
                candidate_courses.update(courses_by_teacher[normalize(label)])
            mode = "teacher_anchor" if labels else "anchor_not_in_pilot"
        elif reasons == {"teacher_unclear"}:
            codes = course_codes_by_name.get(normalize(item.get("course_name")), set())
            for code in codes:
                candidate_teachers.update(teachers_by_course[code])
            mode = "course_anchor" if codes else "anchor_not_in_pilot"
        else:
            mode = "no_known_anchor"
        results.append({
            "schema_version": SCHEMA_VERSION,
            "evaluation_id": item["evaluation_id"],
            "worksheet": item["worksheet"],
            "source_row": item["source_row"],
            "source_column": item["source_column"],
            "production_reasons": sorted(reasons),
            "known_course_name": item.get("course_name"),
            "known_teacher_name": item.get("teacher_name"),
            "comparison_mode": mode,
            "candidate_course_codes": sorted(candidate_courses),
            "candidate_teacher_labels": sorted(candidate_teachers),
            "decision": "manual_image_review_required" if mode in {"teacher_anchor", "course_anchor"} else "outside_pilot_coverage",
        })
    return sorted(results, key=lambda row: (row["worksheet"], row["source_row"], row["source_column"], row["evaluation_id"]))


def select_smoke(results: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen: set[tuple[str, int, str]] = set()
    modes = ("teacher_anchor", "course_anchor")
    while len(selected) < limit:
        added = False
        for mode in modes:
            match = next((row for row in results if row["comparison_mode"] == mode and (row["worksheet"], row["source_row"], mode) not in seen), None)
            if match is None:
                continue
            seen.add((match["worksheet"], match["source_row"], mode))
            selected.append(match)
            added = True
            if len(selected) == limit:
                break
        if not added:
            break
    return selected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quarantine", required=True, type=Path)
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=12)
    args = parser.parse_args()
    paths = {name: args.catalog / f"{name}.jsonl" for name in ("courses", "teachers", "relations")}
    results = compare(read_jsonl(args.quarantine), *(read_jsonl(paths[name]) for name in ("courses", "teachers", "relations")))
    smoke = select_smoke(results, args.limit)
    counts: dict[str, int] = defaultdict(int)
    for row in results:
        counts[row["comparison_mode"]] += 1
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "inputs": {"quarantine_sha256": sha256(args.quarantine), **{f"catalog_{name}_sha256": sha256(path) for name, path in paths.items()}},
        "counts": {"identity_only": len(results), **dict(sorted(counts.items())), "smoke_selected": len(smoke)},
        "policy": "Candidates are hints only; every selected identity requires source-image review.",
    }
    args.out.mkdir(parents=True, exist_ok=False)
    (args.out / "comparisons.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in results), encoding="utf-8")
    (args.out / "smoke-sample.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in smoke), encoding="utf-8")
    (args.out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
