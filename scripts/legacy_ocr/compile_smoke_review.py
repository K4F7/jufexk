from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def analysis_cells(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict) or not isinstance(value.get("cells"), list):
        raise ValueError("analysis response must contain a cells array")
    return value["cells"]


def compile_cells(
    sample: list[dict[str, Any]],
    analysis_a: list[dict[str, Any]],
    analysis_b: list[dict[str, Any]],
    arbitration: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    expected = [item["key"] for item in sample]
    if len(set(expected)) != len(expected):
        raise ValueError("sample keys are not unique")

    def validate_side(cells: list[dict[str, Any]], side: str) -> dict[str, dict[str, Any]]:
        by_key = {item.get("key"): item for item in cells}
        if set(by_key) != set(expected) or len(by_key) != len(cells):
            raise ValueError(f"{side} key coverage mismatch")
        for key, item in by_key.items():
            if not isinstance(item.get("raw_transcription"), str):
                raise ValueError(f"{side} missing raw transcription for {key}")
            if item.get("corrected_text") != item["raw_transcription"] or item.get("edits") != [] or not isinstance(item.get("uncertainty_markers"), list):
                raise ValueError(f"{side} contract violation for {key}")
        return by_key

    a_by_key = validate_side(analysis_a, "analysis_a")
    b_by_key = validate_side(analysis_b, "analysis_b")
    arb_by_key = {
        f"{item.get('worksheet')}|{item.get('row')}|{item.get('column')}": item
        for item in arbitration
    }
    output = []
    for source in sample:
        key = source["key"]
        a = a_by_key[key]
        b = b_by_key[key]
        strict = (
            a["raw_transcription"] == b["raw_transcription"]
            and not a["uncertainty_markers"]
            and not b["uncertainty_markers"]
        )
        conclusion = "agreed" if strict else "unresolved"
        approved_text = a["raw_transcription"] if strict else ""
        arb = None
        if not strict:
            arb = arb_by_key.get(key)
            if arb and arb.get("decision") in {"analysis_a", "analysis_b"}:
                chosen = a if arb["decision"] == "analysis_a" else b
                if arb.get("selected_text") != chosen["raw_transcription"]:
                    raise ValueError(f"arbitration introduced a third transcription for {key}")
                conclusion = "arbitrated"
                approved_text = chosen["raw_transcription"]
            elif arb and arb.get("decision") != "unresolved":
                raise ValueError(f"invalid arbitration decision for {key}")
        output.append({
            "key": key,
            "conclusion": conclusion,
            "approved_text": approved_text,
            "analysis_a": a,
            "analysis_b": b,
            "arbitration": arb,
            "source": source,
        })
    unused = set(arb_by_key) - set(expected)
    if unused:
        raise ValueError(f"arbitration contains unexpected keys: {sorted(unused)}")
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile and validate isolated A/B smoke review evidence")
    parser.add_argument("--sample", required=True)
    parser.add_argument("--analysis-a", required=True)
    parser.add_argument("--analysis-b", required=True)
    parser.add_argument("--arbitration", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    sample_payload = json.loads(Path(args.sample).read_text(encoding="utf-8-sig"))
    a = analysis_cells(json.loads(Path(args.analysis_a).read_text(encoding="utf-8-sig")))
    b = analysis_cells(json.loads(Path(args.analysis_b).read_text(encoding="utf-8-sig")))
    arbitration = json.loads(Path(args.arbitration).read_text(encoding="utf-8-sig"))
    if not isinstance(arbitration, list):
        arbitration = arbitration.get("cells", [])
    cells = compile_cells(sample_payload["cells"], a, b, arbitration)
    counts = {
        "agreed": sum(item["conclusion"] == "agreed" for item in cells),
        "arbitrated": sum(item["conclusion"] == "arbitrated" for item in cells),
        "unresolved": sum(item["conclusion"] == "unresolved" for item in cells),
    }
    payload = {
        "contract_version": "ocr-first-smoke-review-v1",
        "manifest_sha256": sample_payload["manifest_sha256"],
        "status": "approved" if counts["unresolved"] == 0 else "completed_with_exceptions",
        "counts": counts,
        "cells": cells,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": payload["status"], **counts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
