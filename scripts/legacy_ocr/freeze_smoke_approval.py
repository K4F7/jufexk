from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def freeze(sample_path: Path, workflows: Path) -> dict[str, Any]:
    sample = load_json(sample_path)
    expected = {cell["worksheet"]: cell["key"] for cell in sample["cells"]}
    if len(expected) != 8 or len(set(expected.values())) != 8:
        raise ValueError("smoke sample must contain one unique cell for each of 8 worksheets")

    groups: list[dict[str, Any]] = []
    all_attempts: list[dict[str, Any]] = []
    for worksheet, key in sorted(expected.items()):
        out = workflows / worksheet / "out"
        status = load_json(out / "status.json")
        validation = load_json(out / "validation.json")
        matrix = load_json(out / "matrix.json")
        attempts = load_json(out / "attempts.json")
        cells = matrix.get("cells", [])
        if status != {"status": "completed", "expected_cells": 1, "routed_cells": 1, "unresolved_cells": 0}:
            raise ValueError(f"{worksheet}: workflow status is not approved")
        if not validation.get("valid") or not validation.get("references_valid"):
            raise ValueError(f"{worksheet}: validation failed")
        if len(cells) != 1 or cells[0].get("key") != key or cells[0].get("conclusion") not in {"agreed", "arbitrated"}:
            raise ValueError(f"{worksheet}: matrix does not contain one resolved sample cell")
        if any(item.get("status") == "failed" for item in attempts):
            raise ValueError(f"{worksheet}: failed attempt remains in smoke gate")
        all_attempts.extend(attempts)
        groups.append({
            "worksheet": worksheet,
            "key": key,
            "conclusion": cells[0]["conclusion"],
            "selected": cells[0]["selected"],
            "attempt_count": len(attempts),
            "sessions": [item.get("session_id") for item in attempts],
        })

    models: dict[str, int] = {}
    for attempt in all_attempts:
        model = attempt["model"]
        models[model] = models.get(model, 0) + 1
    null_arbitrations = sum(
        item.get("side") == "arbitration"
        and any(cell.get("selected") is None for cell in item.get("raw_response", {}).get("cells", []))
        for item in all_attempts
    )
    return {
        "contract_version": "ocr-first-smoke-approval-v1",
        "status": "approved",
        "manifest_sha256": sample["manifest_sha256"],
        "sample_sha256": hashlib.sha256(sample_path.read_bytes()).hexdigest(),
        "group_count": len(groups),
        "resolved_cells": len(groups),
        "unresolved_cells": 0,
        "attempt_count": len(all_attempts),
        "failed_attempts": 0,
        "models": models,
        "fallback_attempts": sum(item["model"] != "gpt-5.6-luna" for item in all_attempts),
        "recovered_null_arbitrations": null_arbitrations,
        "groups": groups,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and freeze the eight-group OCR-first smoke gate")
    parser.add_argument("--sample", required=True)
    parser.add_argument("--workflows", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    payload = freeze(Path(args.sample), Path(args.workflows))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: payload[key] for key in ("status", "group_count", "resolved_cells", "attempt_count", "fallback_attempts")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
