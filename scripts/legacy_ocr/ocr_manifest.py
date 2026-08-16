from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable

from pipeline import Token, get_ocr_engine, run_ocr


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def cuda_provider_evidence() -> dict[str, list[str]]:
    engine = get_ocr_engine(True)
    evidence: dict[str, list[str]] = {}
    for name in ("text_det", "text_cls", "text_rec"):
        component = getattr(engine, name, None)
        wrapper = getattr(component, "session", None)
        session = getattr(wrapper, "session", None)
        providers = session.get_providers() if session is not None else []
        if not providers or providers[0] != "CUDAExecutionProvider":
            raise RuntimeError(f"RapidOCR {name} is not CUDA-first: {providers}")
        evidence[name] = list(providers)
    return evidence


def ocr_cuda(image: Path) -> tuple[list[Token], str]:
    return run_ocr(image, True)


def manifest_files(manifest: dict[str, Any]) -> dict[str, str]:
    files = manifest.get("files")
    if isinstance(files, dict):
        return files
    if isinstance(files, list):
        result: dict[str, str] = {}
        for item in files:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str) or not isinstance(item.get("sha256"), str):
                raise ValueError("manifest file entries must contain path and sha256 strings")
            if item["path"] in result:
                raise ValueError(f"duplicate manifest file path: {item['path']}")
            result[item["path"]] = item["sha256"]
        return result
    raise ValueError("manifest must contain a files object or array")


def run_manifest(
    manifest_path: Path,
    out: Path,
    runner: Callable[[Path], tuple[list[Token], str]] = ocr_cuda,
    *,
    provider_probe: Callable[[], dict[str, list[str]]] = cuda_provider_evidence,
    shard_count: int = 1,
    shard_index: int = 0,
    aggregate: bool = True,
) -> dict[str, Any]:
    if shard_count < 1:
        raise ValueError("shard_count must be at least 1")
    if shard_index < 0 or shard_index >= shard_count:
        raise ValueError("shard_index must be within shard_count")
    if aggregate and (shard_count != 1 or shard_index != 0):
        raise ValueError("aggregate output requires the unsharded run")

    manifest_path = manifest_path.resolve()
    input_root = manifest_path.parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    if manifest.get("status") != "complete":
        raise ValueError("manifest must be complete")
    files = manifest_files(manifest)

    entries: list[tuple[str, Path, str]] = []
    for relative, expected in sorted(files.items()):
        image = (input_root / relative).resolve()
        if input_root not in image.parents:
            raise ValueError(f"image escapes manifest root: {relative}")
        actual = sha256_file(image)
        if actual != expected:
            raise ValueError(f"hash mismatch for {relative}: expected {expected}, got {actual}")
        entries.append((relative, image, expected))

    started = time.time()
    evidence = provider_probe()
    pages_dir = out / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    shard_entries = [entry for index, entry in enumerate(entries) if index % shard_count == shard_index]
    for relative, image, input_hash in shard_entries:
        artifact_path = pages_dir / f"{input_hash}.json"
        existing = None
        if artifact_path.exists():
            existing = json.loads(artifact_path.read_text(encoding="utf-8-sig"))
        if existing and existing.get("status") == "completed" and existing.get("input_sha256") == input_hash:
            results.append(existing)
            continue

        attempts = int(existing.get("attempts", 0)) + 1 if existing else 1
        artifact: dict[str, Any] = {
            "source_file": relative,
            "sheet_name": relative.split("/", 1)[0],
            "input_sha256": input_hash,
            "attempts": attempts,
            "provider_evidence": evidence,
        }
        try:
            tokens, model = runner(image)
            artifact.update(
                status="completed",
                ocr_model=model,
                tokens=[asdict(token) for token in tokens],
                token_count=len(tokens),
                errors=[],
            )
        except Exception as exc:
            previous_errors = list(existing.get("errors", [])) if existing else []
            artifact.update(
                status="failed",
                ocr_model="RapidOCR CUDA",
                tokens=[],
                token_count=0,
                errors=[*previous_errors, {"attempt": attempts, "error": str(exc)}],
            )
        write_json_atomic(artifact_path, artifact)
        results.append(artifact)

    counts = {
        "completed": sum(item["status"] == "completed" for item in results),
        "failed": sum(item["status"] == "failed" for item in results),
    }
    summary = {
        "batch": manifest["batch"],
        "manifest_sha256": sha256_file(manifest_path),
        "provider_evidence": evidence,
        "shard": {"count": shard_count, "index": shard_index},
        "counts": counts,
        "token_count": sum(int(item.get("token_count", 0)) for item in results),
        "processing_seconds": round(time.time() - started, 3),
        "pages": [{key: item[key] for key in ("source_file", "input_sha256", "status", "attempts", "token_count", "errors")} for item in results],
    }
    if aggregate:
        write_json_atomic(out / "summary.json", summary)
        with (out / "raw_ocr_tokens.jsonl").open("w", encoding="utf-8") as handle:
            for item in results:
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Resumable CUDA RapidOCR over a frozen capture manifest")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--shard-count", type=int, default=1)
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--pages-only", action="store_true")
    args = parser.parse_args()
    summary = run_manifest(
        Path(args.manifest),
        Path(args.out),
        shard_count=args.shard_count,
        shard_index=args.shard_index,
        aggregate=not args.pages_only,
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["counts"]["failed"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
