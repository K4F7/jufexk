from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path
from typing import Any

from review_uncertain_geometry import clipping_directions, read_jsonl, sha256_file, write_jsonl


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def final_classification(markers: list[Any], resolved: bool) -> str:
    if not resolved:
        return "source_clipped" if clipping_directions(markers) else "partial_transcription"
    if not markers:
        return "recovered_complete"
    return "source_clipped" if clipping_directions(markers) else "partial_transcription"


def selected_analysis(cell: dict[str, Any]) -> dict[str, Any] | None:
    selected = cell.get("selected")
    candidate = cell.get(selected) if isinstance(selected, str) else None
    return candidate if isinstance(candidate, dict) else None


def recovery_ref(attempt: dict[str, Any]) -> dict[str, Any]:
    return {
        "task_id": attempt["task_id"],
        "side": attempt["side"],
        "model": attempt["model"],
        "attempt": attempt["attempt"],
        "status": attempt["status"],
        "input_sha256": attempt["input_sha256"],
    }


def build(root: Path) -> dict[str, Any]:
    targets = {item["key"]: item for item in read_jsonl(root / "targets.jsonl")}
    geometry = {item["key"]: item for item in read_jsonl(root / "geometry-classification.jsonl")}
    groups = read_json(root / "agent-groups.json")["groups"]
    agent_cells: dict[str, dict[str, Any]] = {}
    attempts: list[dict[str, Any]] = []
    agent_keys_expected = {key for key, item in geometry.items() if item["classification"] == "expandable"}

    for group in groups:
        output = Path(group["output"])
        matrix_path = output / "matrix.json"
        attempts_path = output / "attempts.json"
        if not matrix_path.exists() or not attempts_path.exists():
            raise ValueError(f"agent group output missing: {group['group_id']}")
        matrix = read_json(matrix_path)
        for cell in matrix["cells"]:
            if cell.get("status") != "review":
                continue
            if cell["key"] in agent_cells:
                raise ValueError(f"duplicate agent cell: {cell['key']}")
            agent_cells[cell["key"]] = cell
        for attempt in read_json(attempts_path):
            attempts.append({**attempt, "group_id": group["group_id"], "attempts_file_sha256": sha256_file(attempts_path)})
    if set(agent_cells) != agent_keys_expected:
        raise ValueError(f"agent coverage mismatch: missing={sorted(agent_keys_expected - set(agent_cells))[:8]}")

    history: dict[tuple[str, str], list[dict[str, Any]]] = collections.defaultdict(list)
    attempt_rows = []
    for attempt in sorted(attempts, key=lambda item: (item.get("started_at", ""), item["group_id"], item["task_id"])):
        chains = {}
        for key in attempt["cell_keys"]:
            chain_key = (key, attempt["side"])
            current = recovery_ref(attempt)
            history[chain_key].append(current)
            chains[key] = history[chain_key].copy()
        attempt_rows.append({
            **attempt,
            "raw_error": attempt.get("error"),
            "recovery_chain_by_key": chains,
        })
    write_jsonl(root / "attempts.jsonl", attempt_rows)

    matrix_rows = []
    for key in sorted(targets):
        target = targets[key]
        geo = geometry[key]
        agent = agent_cells.get(key)
        analysis = selected_analysis(agent) if agent else None
        if analysis:
            transcription = analysis["raw_transcription"]
            markers = analysis.get("uncertainty_markers", [])
            resolved = True
            source = "expanded_agent_selection"
        else:
            transcription = target["prior_raw_transcription"]
            markers = target["prior_uncertainty_markers"]
            resolved = geo["classification"] == "already_complete"
            source = "v15_prior_selection"
        classification = final_classification(markers, resolved)
        recovery_condition = None
        if classification == "source_clipped":
            recovery_condition = "capture a new frozen manifest version with the full rendered cell overflow visible"
        if agent and agent.get("conclusion") == "unresolved":
            recovery_condition = "restore model quota and re-run isolated arbitration, or recapture in a new frozen manifest if the text remains clipped"
        matrix_rows.append({
            "key": key,
            "evaluation_id": target["evaluation_id"],
            "worksheet": target["worksheet"],
            "row": target["row"],
            "column": target["column"],
            "geometry_classification": geo["classification"],
            "source_file": target["source_file"],
            "source_sha256": target["source_sha256"],
            "source_manifest_sha256": target["source_manifest_sha256"],
            "old_bbox": target["old_bbox"],
            "old_crop_sha256": target["old_crop_sha256"],
            "new_bbox": geo["new_bbox"],
            "new_crop": geo["new_crop"],
            "new_crop_sha256": geo["new_crop_sha256"],
            "prior_raw_transcription": target["prior_raw_transcription"],
            "prior_uncertainty_markers": target["prior_uncertainty_markers"],
            "analysis_a": agent.get("analysis_a") if agent else None,
            "analysis_b": agent.get("analysis_b") if agent else None,
            "arbitration": agent.get("arbitration") if agent else None,
            "agent_conclusion": agent.get("conclusion") if agent else "not_run_already_complete",
            "agent_unresolved_reason": agent.get("unresolved_reason") if agent else None,
            "final_transcription": transcription,
            "final_uncertainty_markers": markers,
            "final_transcription_source": source,
            "final_classification": classification,
            "recovery_condition": recovery_condition,
        })
    write_jsonl(root / "matrix.jsonl", matrix_rows)

    classification_counts = collections.Counter(row["final_classification"] for row in matrix_rows)
    geometry_counts = collections.Counter(row["geometry_classification"] for row in matrix_rows)
    model_counts = collections.Counter(row["model"] for row in attempt_rows)
    failed_attempts = [row for row in attempt_rows if row["status"] == "failed"]
    unresolved = [row for row in matrix_rows if row["agent_conclusion"] == "unresolved"]
    hash_errors = []
    for row in matrix_rows:
        if row["new_crop"] and sha256_file(Path(row["new_crop"])) != row["new_crop_sha256"]:
            hash_errors.append(row["key"])
    valid_hash = re.compile(r"^[0-9a-f]{64}$")
    invalid_attempt_hashes = [row["task_id"] for row in attempt_rows if not valid_hash.fullmatch(row["input_sha256"])]
    max_batch = max((len(row["cell_keys"]) for row in attempt_rows), default=0)
    verification = {
        "valid": (
            len(matrix_rows) == 177
            and len({row["key"] for row in matrix_rows}) == 177
            and set(targets) == set(geometry) == {row["key"] for row in matrix_rows}
            and set(agent_cells) == agent_keys_expected
            and max_batch <= 8
            and not hash_errors
            and not invalid_attempt_hashes
        ),
        "target_count": len(matrix_rows),
        "unique_key_count": len({row["key"] for row in matrix_rows}),
        "worksheet_row_count": len({(row["worksheet"], row["row"]) for row in matrix_rows}),
        "agent_target_count": len(agent_keys_expected),
        "agent_completed_count": len(agent_cells) - len(unresolved),
        "agent_unresolved_count": len(unresolved),
        "geometry_counts": dict(geometry_counts),
        "final_classification_counts": dict(classification_counts),
        "attempt_count": len(attempt_rows),
        "failed_attempt_count": len(failed_attempts),
        "arbitration_attempt_count": sum(row["side"] == "arbitration" for row in attempt_rows),
        "model_counts": dict(model_counts),
        "fallback_attempt_count": sum(row["model"] != "gpt-5.6-luna" for row in attempt_rows),
        "max_batch_size": max_batch,
        "batch_size_valid": max_batch <= 8,
        "crop_hash_errors": hash_errors,
        "invalid_attempt_hashes": invalid_attempt_hashes,
        "unresolved": [
            {
                "key": row["key"],
                "reason": row["agent_unresolved_reason"],
                "recovery_condition": row["recovery_condition"],
                "failed_attempts": [
                    {field: attempt.get(field) for field in ("task_id", "side", "model", "attempt", "input_sha256", "raw_error")}
                    for attempt in failed_attempts if row["key"] in attempt["cell_keys"]
                ],
            }
            for row in unresolved
        ],
    }
    artifact_paths = [root / name for name in ("targets.jsonl", "geometry-classification.jsonl", "attempts.jsonl", "matrix.jsonl")]
    verification["artifact_sha256"] = {path.name: sha256_file(path) for path in artifact_paths}
    write_json(root / "verification.json", verification)

    summary = f"""# v15 review_uncertain rerun v2

- Targets: {len(matrix_rows)}/177 unique cells across {verification['worksheet_row_count']} worksheet rows.
- Geometry: {geometry_counts.get('expandable', 0)} expandable, {geometry_counts.get('source_clipped', 0)} source-clipped at the frozen image boundary, {geometry_counts.get('already_complete', 0)} already complete crops.
- Final: {classification_counts.get('recovered_complete', 0)} completely recovered, {classification_counts.get('partial_transcription', 0)} partial transcriptions, {classification_counts.get('source_clipped', 0)} source-clipped.
- Agents: {verification['agent_completed_count']}/{verification['agent_target_count']} selected conclusions; {verification['agent_unresolved_count']} unresolved after recovery.
- Attempts: {verification['attempt_count']} total, {verification['failed_attempt_count']} failed, {verification['arbitration_attempt_count']} arbitration, {verification['fallback_attempt_count']} fallback; maximum batch size {max_batch}.
- Models: {json.dumps(dict(model_counts), ensure_ascii=False, sort_keys=True)}.
- Verification: {'valid' if verification['valid'] else 'invalid'}.

No database writes, Tencent spreadsheet writes, Git commits, or Excel generation were performed.
"""
    (root / "SUMMARY.md").write_text(summary, encoding="utf-8")
    return verification


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile and verify the v15 review_uncertain rerun")
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    verification = build(Path(args.root))
    print(json.dumps(verification, ensure_ascii=False))
    return 0 if verification["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
