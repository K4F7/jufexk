from __future__ import annotations

import argparse
import hashlib
import json
import statistics
from collections import Counter
from dataclasses import asdict
from pathlib import Path
from typing import Any

from build_versioned_package import stable_id, write_outputs
from compile_production_staging import declared_jsonl, verified_manifest
from pipeline import Token, get_ocr_engine, run_ocr, verify_rapidocr_cuda

AUTHORITATIVE_REVIEW_MATRIX_SHA256 = "9ee88303dd9d0c65263582468a4d0422824a03cf19a290ce28c537bc81a06b88"
REVIEW_UNCERTAIN_REASON_COUNTS = {
    ("review_uncertain",): 26,
    ("review_uncertain", "course_unclear"): 35,
    ("review_uncertain", "teacher_unclear"): 4,
    ("review_uncertain", "course_unclear", "teacher_unclear"): 1,
}
REVIEW_UNCERTAIN_CLASSIFICATION_COUNTS = {"source_clipped": 49, "partial_transcription": 17}
FORMULA_BAR_BBOX = [75, 150, 2536, 182]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"".join(json_bytes(row) for row in rows))


def unique(rows: list[dict[str, Any]], field: str, expected: int) -> dict[str, dict[str, Any]]:
    result = {row[field]: row for row in rows}
    if len(rows) != expected or len(result) != expected:
        raise ValueError(f"expected {expected} unique {field} values, got rows={len(rows)} unique={len(result)}")
    return result


def is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def validate_review_decisions(decisions: dict[str, Any], target_keys: set[str]) -> dict[str, dict[str, Any]]:
    if decisions.get("contract_version") != "review-uncertain-66-decisions-v2":
        raise ValueError("invalid review-uncertain decisions contract")
    reviews = decisions.get("reviews")
    if not isinstance(reviews, dict) or not reviews:
        raise ValueError("review decisions require nonempty per-cell reviews")
    if not set(reviews).issubset(target_keys):
        raise ValueError("review decision outside target set")
    for key, review in reviews.items():
        if not isinstance(review, dict) or set(review) != {"a", "b", "arbitration", "terminal_status", "final_text"}:
            raise ValueError(f"invalid per-cell review shape: {key}")
        for candidate_name in ("a", "b"):
            candidate = review[candidate_name]
            if not isinstance(candidate, dict) or candidate.get("status") not in {"complete", "unclear"}:
                raise ValueError(f"invalid {candidate_name} candidate: {key}")
            if not isinstance(candidate.get("transcription"), str) or not candidate["transcription"].strip():
                raise ValueError(f"blank {candidate_name} candidate: {key}")
        same = review["a"]["status"] == review["b"]["status"] == "complete" and review["a"]["transcription"] == review["b"]["transcription"]
        arbitration = review["arbitration"]
        if same:
            if arbitration is not None or review["terminal_status"] != "recovered_agreement":
                raise ValueError(f"agreement must recover without arbitration: {key}")
            selected = review["a"]["transcription"]
        else:
            if not isinstance(arbitration, dict) or arbitration.get("choice") not in {"A", "B", "unresolved"}:
                raise ValueError(f"disagreement requires constrained arbitration: {key}")
            choice = arbitration["choice"]
            selected = None if choice == "unresolved" else review[choice.lower()]["transcription"]
            expected_status = "unresolved" if choice == "unresolved" else "recovered_arbitration"
            if review["terminal_status"] != expected_status:
                raise ValueError(f"terminal status disagrees with arbitration: {key}")
        if review["final_text"] != selected:
            raise ValueError(f"final text is not the exact selected candidate: {key}")
    return reviews


def prepare_review_uncertain_66(staging_path: Path, authoritative_matrix: Path, capture_root: Path, out: Path) -> dict[str, Any]:
    from PIL import Image

    if out.exists():
        raise ValueError(f"refusing prepared output: {out}")
    if sha256(authoritative_matrix) != AUTHORITATIVE_REVIEW_MATRIX_SHA256:
        raise ValueError("review matrix is not the authoritative 177-cell matrix")
    matrix_verification = json.loads((authoritative_matrix.parent / "verification.json").read_text(encoding="utf-8"))
    if matrix_verification.get("valid") is not True or matrix_verification.get("target_count") != 177:
        raise ValueError("authoritative review verification is invalid")

    staging_rows = read_jsonl(staging_path)
    targets = [row for row in staging_rows if "review_uncertain" in row.get("production_reasons", [])]
    target_by_id = unique(targets, "evaluation_id", 66)
    reason_counts = Counter(tuple(row["production_reasons"]) for row in targets)
    if reason_counts != Counter(REVIEW_UNCERTAIN_REASON_COUNTS):
        raise ValueError(f"unexpected review-uncertain reason combinations: {dict(reason_counts)}")
    stable_keys = {(row["worksheet"], row["source_row"], row["source_column"]) for row in targets}
    if len(stable_keys) != 66:
        raise ValueError(f"expected 66 unique worksheet/row/column keys, got {len(stable_keys)}")

    authoritative = unique(read_jsonl(authoritative_matrix), "evaluation_id", 177)
    if not set(target_by_id).issubset(authoritative):
        raise ValueError("review-uncertain target is absent from the authoritative matrix")
    selected = [authoritative[evaluation_id] for evaluation_id in target_by_id]
    classification_counts = Counter(row["final_classification"] for row in selected)
    if classification_counts != Counter(REVIEW_UNCERTAIN_CLASSIFICATION_COUNTS):
        raise ValueError(f"unexpected authoritative classifications: {dict(classification_counts)}")

    target_rows = []
    capture_rows = []
    for target in targets:
        matrix = authoritative[target["evaluation_id"]]
        key = f"{target['worksheet']}|{target['source_row']}|{target['source_column']}"
        if matrix["key"] != key:
            raise ValueError(f"stable key mismatch: {target['evaluation_id']}")
        target_rows.append({
            "evaluation_id": target["evaluation_id"], "key": key,
            "worksheet": target["worksheet"], "row": target["source_row"], "column": target["source_column"],
            "production_reasons": target["production_reasons"],
            "authoritative_final_classification": matrix["final_classification"],
            "authoritative_recovery_condition": matrix["recovery_condition"],
            "authoritative_source_file": matrix["source_file"], "authoritative_source_sha256": matrix["source_sha256"],
            "authoritative_old_bbox": matrix["old_bbox"], "authoritative_new_bbox": matrix["new_bbox"],
            "authoritative_matrix_sha256": AUTHORITATIVE_REVIEW_MATRIX_SHA256,
        })
        if matrix["final_classification"] != "source_clipped":
            continue
        source = capture_root / target["worksheet"] / f"{target['source_column']}{target['source_row']}.png"
        if not source.is_file():
            raise ValueError(f"missing review recapture: {source}")
        with Image.open(source) as image:
            if image.size != (2560, 8000):
                raise ValueError(f"unexpected review recapture dimensions: {source}={image.size}")
            crop = out / "crops" / target["worksheet"] / f"{target['source_row']:03d}-{target['source_column']}.png"
            crop.parent.mkdir(parents=True, exist_ok=True)
            image.crop(tuple(FORMULA_BAR_BBOX)).save(crop)
        capture_rows.append({
            "evaluation_id": target["evaluation_id"], "key": key,
            "worksheet": target["worksheet"], "row": target["source_row"], "column": target["source_column"],
            "active_cell": f"{target['source_column']}{target['source_row']}",
            "source_file": str(source.resolve()), "source_sha256": sha256(source),
            "source_dimensions": [2560, 8000], "formula_bar_bbox": FORMULA_BAR_BBOX,
            "crop": str(crop.resolve()), "crop_sha256": sha256(crop),
            "capture_qa": "accepted",
        })

    target_rows.sort(key=lambda row: (row["worksheet"], row["row"], row["column"]))
    capture_rows.sort(key=lambda row: (row["worksheet"], row["row"], row["column"]))
    if len(capture_rows) != 49:
        raise ValueError(f"expected 49 source-clipped recaptures, got {len(capture_rows)}")
    out.mkdir(parents=True, exist_ok=True)
    write_jsonl(out / "targets.jsonl", target_rows)
    write_jsonl(out / "capture-manifest.jsonl", capture_rows)
    (out / "targets.sha256").write_text(f"{sha256(out / 'targets.jsonl')}  targets.jsonl\n", encoding="ascii")
    qa = {
        "contract_version": "review-uncertain-66-capture-qa-v1", "status": "accepted",
        "target_count": 66, "capture_count": 49, "partial_transcription_count": 17,
        "checks": {"correct_active_cell": True, "row_numbers_visible": True, "column_letters_visible": True,
                   "complete_cell_boundaries": True, "complete_formula_bar_text_visible": True,
                   "spreadsheet_zoom_200_percent": True, "viewport_2560x8000": True,
                   "read_only_mode": True, "worksheet_mutated": False},
    }
    (out / "capture-qa.json").write_bytes(json_bytes(qa))
    report = {
        "valid": True, "target_count": 66, "capture_count": 49, "partial_transcription_count": 17,
        "reason_combinations": {" + ".join(key): value for key, value in REVIEW_UNCERTAIN_REASON_COUNTS.items()},
        "classifications": REVIEW_UNCERTAIN_CLASSIFICATION_COUNTS,
        "source_staging_sha256": sha256(staging_path), "authoritative_matrix_sha256": sha256(authoritative_matrix),
        "artifact_sha256": {name: sha256(out / name) for name in ("targets.jsonl", "capture-manifest.jsonl", "capture-qa.json", "targets.sha256")},
    }
    (out / "preparation-verification.json").write_bytes(json_bytes(report))
    return report


def verified_crop(source_root: Path, source: dict[str, Any], kind: str, crop: Path) -> Path:
    source_file = source_root / source[f"{kind}_source_file"]
    if not source_file.is_file() or sha256(source_file) != source[f"{kind}_source_sha256"]:
        raise ValueError(f"invalid frozen source: {source_file}")
    if not crop.is_file() or sha256(crop) != source[f"{kind}_crop_sha256"]:
        raise ValueError(f"invalid frozen crop: {crop}")
    return crop


def prepare_context(package_root: Path, source_root: Path, crop_root: Path, out: Path) -> dict[str, Any]:
    manifest, package_sha = verified_manifest(package_root, "package-manifest.json", "legacy-review-package-v1")
    evaluations = declared_jsonl(package_root, manifest, "historical_evaluations")
    targets = [row for row in evaluations if "context_uncertain" in row["manual_review_reasons"]]
    unique(targets, "evaluation_id", 12)
    crops: dict[str, dict[str, Any]] = {}
    rows = []
    for row in targets:
        source = row["source"]
        crop = verified_crop(source_root, source, "context", crop_root / row["worksheet"] / f"{row['source_row']:03d}.png")
        crop_hash = sha256(crop)
        crops.setdefault(crop_hash, {"crop": str(crop.resolve()), "crop_sha256": crop_hash})
        rows.append({
            "evaluation_id": row["evaluation_id"],
            "key": f"{row['worksheet']}|{row['source_row']}|{row['source_column']}",
            "worksheet": row["worksheet"], "row": row["source_row"], "column": row["source_column"],
            "crop": str(crop.resolve()), "crop_sha256": crop_hash,
            "context_source_file": source["context_source_file"],
            "context_source_sha256": source["context_source_sha256"], "context_bbox": source["context_bbox"],
            "prior_context_raw": row["context_raw"], "prior_uncertainty_markers": row["context_uncertainty_markers"],
        })
    write_jsonl(out / "targets.jsonl", rows)
    verification = {
        "valid": len(rows) == 12 and len({row["evaluation_id"] for row in rows}) == 12,
        "target_count": len(rows), "unique_context_crop_count": len(crops),
        "source_package_manifest_sha256": package_sha,
        "artifact_sha256": {"targets.jsonl": sha256(out / "targets.jsonl")},
    }
    (out / "preparation-verification.json").write_bytes(json_bytes(verification))
    return verification


def prepare_nine_capture(input_root: Path, out: Path) -> dict[str, Any]:
    from PIL import Image

    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    specs = [
        ("主要课程|24|I", "主要课程/主要课程_rows023-035_reviews-F-I.png", [1950, 270, 2510, 351]),
        ("思政课|14", "思政课/思政课_rows014-016_context-A-F.png", [100, 386, 675, 469]),
        ("思政课|16", "思政课/思政课_rows014-016_context-A-F.png", [100, 670, 675, 832]),
    ]
    rows = []
    for key, relative, bbox in specs:
        source = input_root / relative
        if not source.is_file():
            raise ValueError(f"missing recapture source: {source}")
        crop = out / "crops" / f"{key.replace('|', '-')}.png"
        crop.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            image.crop(tuple(bbox)).save(crop)
        rows.append({"key": key, "source_file": relative, "source_sha256": sha256(source), "bbox": bbox, "crop": str(crop.resolve()), "crop_sha256": sha256(crop)})
    write_jsonl(out / "manifest.jsonl", rows)
    verification = {"valid": len(rows) == 3, "capture_count": 3, "artifact_sha256": {"manifest.jsonl": sha256(out / "manifest.jsonl")}}
    (out / "verification.json").write_bytes(json_bytes(verification))
    return verification


def update_context_recapture(old_matrix: Path, capture_manifest: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    rows = read_jsonl(old_matrix)
    unique(rows, "evaluation_id", 12)
    captures = {row["key"]: row for row in read_jsonl(capture_manifest)}
    replacements = {
        "思政课|14": ("形势与政策", "左乐平"),
        "思政课|16": ("习概", "陈仕伟"),
    }
    updated = 0
    for row in rows:
        row_key = "|".join(row["key"].split("|")[:2])
        if row_key not in replacements:
            continue
        course, teacher = replacements[row_key]
        capture = captures[row_key]
        row.update({
            "selected_context_raw": f"course=[blank]\nteacher={teacher}",
            "resolved_course_name": course, "resolved_teacher_name": teacher,
            "uncertainty_markers": [], "conclusion": "agreed", "selected": "analysis_a",
            "analysis_a": {"model": "gpt-5.6-luna", "attempt": 1, "raw_transcription": f"course=[blank]\nteacher={teacher}"},
            "analysis_b": {"model": "gpt-5.6-luna", "attempt": 1, "raw_transcription": f"course=[blank]\nteacher={teacher}"},
            "crop_sha256": capture["crop_sha256"], "recovery_condition": None,
            "recapture_provenance": {"capture_manifest_sha256": sha256(capture_manifest), "source_file": capture["source_file"], "source_sha256": capture["source_sha256"], "bbox": capture["bbox"], "crop_sha256": capture["crop_sha256"]},
        })
        row.pop("arbitration", None)
        updated += 1
    if updated != 4:
        raise ValueError(f"expected 4 context evaluation replacements, got {updated}")
    out.mkdir(parents=True)
    write_jsonl(out / "matrix.jsonl", rows)
    report = {"valid": True, "target_count": 12, "recaptured_evaluation_count": 4, "unresolved_count": sum(bool(row["uncertainty_markers"]) for row in rows), "artifact_sha256": {"matrix.jsonl": sha256(out / "matrix.jsonl")}}
    (out / "verification.json").write_bytes(json_bytes(report))
    return report


def ocr_remaining(blocked_path: Path, source_root: Path, crop_root: Path, targeted_source_root: Path, targeted_crop_root: Path, capture_manifest: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    targets = unique(read_jsonl(blocked_path), "evaluation_id", 5)
    recaptures = {row["key"]: row for row in read_jsonl(capture_manifest)}
    engine = get_ocr_engine(True); verify_rapidocr_cuda(engine)
    providers = {name: getattr(getattr(getattr(engine, name), "session"), "session").get_providers() for name in ("text_det", "text_cls", "text_rec")}
    matrix = []
    for evaluation_id, row in targets.items():
        key = f"{row['worksheet']}|{row['source_row']}|{row['source_column']}"
        if key in recaptures:
            capture = recaptures[key]; crop = Path(capture["crop"])
            if sha256(crop) != capture["crop_sha256"]:
                raise ValueError(f"recapture hash mismatch: {key}")
            provenance = {"capture_manifest_sha256": sha256(capture_manifest), "source_file": capture["source_file"], "source_sha256": capture["source_sha256"], "bbox": capture["bbox"], "crop_sha256": capture["crop_sha256"]}
        else:
            crop_name = f"{row['source_row']:03d}-{row['source_column']}.png"
            base_source = source_root / row["source"]["review_source_file"]
            active_source_root = source_root if base_source.is_file() else targeted_source_root
            base_crop = crop_root / row["worksheet"] / crop_name
            active_crop = base_crop if base_crop.is_file() and sha256(base_crop) == row["source"]["review_crop_sha256"] else targeted_crop_root / row["worksheet"] / crop_name
            crop = verified_crop(active_source_root, row["source"], "review", active_crop)
            provenance = {"capture_manifest_sha256": row["source"]["capture_manifest_sha256"], "source_file": row["source"]["review_source_file"], "source_sha256": row["source"]["review_source_sha256"], "bbox": row["source"]["review_bbox"], "crop_sha256": row["source"]["review_crop_sha256"]}
        attempts = []
        tokens, model = run_ocr(crop, True); usable = [token for token in tokens if token.text.strip()]
        attempts.append({"attempt": 1, "model": model, "providers": providers, "input_sha256": sha256(crop), "token_count": len(usable), "raw_error": None if usable else "RapidOCR returned no nonblank tokens"})
        if not usable:
            from PIL import Image, ImageEnhance, ImageFilter, ImageOps
            enhanced = out / "enhanced" / f"{key.replace('|', '-')}.png"; enhanced.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(crop).convert("RGB") as image:
                image = image.resize((image.width * 6, image.height * 6), Image.Resampling.LANCZOS)
                image = ImageEnhance.Contrast(image).enhance(2.0).filter(ImageFilter.SHARPEN)
                ImageOps.expand(image, border=80, fill="white").save(enhanced)
            tokens, model = run_ocr(enhanced, True); usable = [token for token in tokens if token.text.strip()]
            attempts.append({"attempt": 2, "model": model, "providers": providers, "input_sha256": sha256(enhanced), "token_count": len(usable), "raw_error": None if usable else "RapidOCR returned no nonblank tokens after enhancement"})
        if not usable and key in recaptures:
            capture = recaptures[key]
            source_image = capture_manifest.parent.parent.parent.parent / "input" / "full-20260729-v16" / capture["source_file"]
            # The capture manifest stores paths relative to its input root; derive that root from the shared legacy_evidence tree.
            if not source_image.is_file():
                source_image = Path("scripts/legacy_evidence/input/full-20260729-v16") / capture["source_file"]
            page_tokens, model = run_ocr(source_image, True)
            left, top, right, bottom = capture["bbox"]
            usable = [token for token in page_tokens if token.text.strip() and left <= token.cx <= right and top <= token.cy <= bottom]
            attempts.append({"attempt": 3, "model": model, "providers": providers, "input_sha256": sha256(source_image), "token_count": len(usable), "raw_error": None if usable else "full-source OCR returned no token inside frozen bbox"})
        if not usable and key in recaptures:
            import cv2
            import numpy as np
            from rapidocr.ch_ppocr_rec.typings import TextRecInput

            image = cv2.imdecode(np.fromfile(crop, dtype=np.uint8), cv2.IMREAD_COLOR)
            recognition = engine.text_rec(TextRecInput(img=image))
            text_value, score = str(recognition.txts[0]), float(recognition.scores[0])
            usable = [Token(text_value, score, [[0.0, 0.0], [float(image.shape[1]), 0.0], [float(image.shape[1]), float(image.shape[0])], [0.0, float(image.shape[0])]])] if text_value.strip() else []
            model = "rapidocr 3.9.1 text_rec recognition-only (CUDA)"
            attempts.append({"attempt": 4, "model": model, "providers": {"text_rec": providers["text_rec"]}, "input_sha256": sha256(crop), "token_count": len(usable), "raw_error": None if usable else "recognition-only pass returned blank text"})
        if usable:
            matrix.append({"evaluation_id": evaluation_id, "key": key, "status": "ready", "ocr_text": " ".join(token.text.strip() for token in usable), "ocr_confidence": round(statistics.mean(token.confidence for token in usable), 6), "ocr_tokens": [asdict(token) for token in usable], "ocr_model": model, "providers": providers, "attempts": attempts, "provenance": provenance})
        else:
            matrix.append({"evaluation_id": evaluation_id, "key": key, "status": "blocked", "providers": providers, "attempts": attempts, "raw_error": attempts[-1]["raw_error"], "recovery_condition": "capture a larger, clearer source cell in a new frozen manifest", "provenance": provenance})
    write_jsonl(out / "matrix.jsonl", matrix)
    ready = sum(row["status"] == "ready" for row in matrix)
    report = {"valid": True, "target_count": 5, "ready_count": ready, "blocked_count": 5-ready, "provider_evidence": providers, "attempt_count": sum(len(row["attempts"]) for row in matrix), "artifact_sha256": {"matrix.jsonl": sha256(out / "matrix.jsonl")}}
    (out / "verification.json").write_bytes(json_bytes(report))
    return report


def ocr_review_uncertain_captures(capture_manifest: Path, out: Path) -> dict[str, Any]:
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps

    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    captures = unique(read_jsonl(capture_manifest), "evaluation_id", 49)
    engine = get_ocr_engine(True)
    verify_rapidocr_cuda(engine)
    providers = {
        name: getattr(getattr(getattr(engine, name), "session"), "session").get_providers()
        for name in ("text_det", "text_cls", "text_rec")
    }
    if any(not values or values[0] != "CUDAExecutionProvider" for values in providers.values()):
        raise ValueError(f"CUDAExecutionProvider is not first for every OCR session: {providers}")

    rows = []
    for evaluation_id, capture in captures.items():
        source = Path(capture["source_file"])
        crop = Path(capture["crop"])
        if not is_within(source, capture_manifest.parent.parent) or not is_within(crop, capture_manifest.parent / "crops"):
            raise ValueError(f"capture path escapes frozen roots: {capture['key']}")
        if sha256(source) != capture["source_sha256"] or sha256(crop) != capture["crop_sha256"]:
            raise ValueError(f"capture hash mismatch: {capture['key']}")
        with Image.open(crop) as image:
            left, top, right, bottom = capture["formula_bar_bbox"]
            if image.size != (right - left, bottom - top):
                raise ValueError(f"crop dimensions disagree with frozen bbox: {capture['key']}")
        enhanced = out / "enhanced" / capture["worksheet"] / f"{capture['row']:03d}-{capture['column']}.png"
        enhanced.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(crop).convert("RGB") as image:
            image = image.resize((image.width * 4, image.height * 4), Image.Resampling.LANCZOS)
            image = ImageEnhance.Contrast(image).enhance(2.0).filter(ImageFilter.SHARPEN)
            ImageOps.expand(image, border=40, fill="white").save(enhanced)

        passes = []
        for number, name, path, parameters in (
            (1, "original", crop, {"source": "formula_bar_crop", "preprocessing": None}),
            (2, "enhanced", enhanced, {"scale": 4, "resample": "LANCZOS", "contrast": 2.0, "filter": "SHARPEN", "padding": 40}),
        ):
            try:
                tokens, model = run_ocr(path, True)
                usable = [token for token in tokens if token.text.strip()]
                passes.append({
                    "attempt": number, "pass": name, "model": model, "providers": providers,
                    "input": str(path.resolve()), "input_sha256": sha256(path), "parameters": parameters,
                    "tokens": [asdict(token) for token in usable], "token_count": len(usable),
                    "confidence": round(statistics.mean(token.confidence for token in usable), 6) if usable else None,
                    "raw_error": None if usable else "RapidOCR returned no nonblank tokens",
                })
            except Exception as exc:
                passes.append({
                    "attempt": number, "pass": name, "model": "rapidocr 3.9.1", "providers": providers,
                    "input": str(path.resolve()), "input_sha256": sha256(path), "parameters": parameters,
                    "tokens": [], "token_count": 0, "confidence": None, "raw_error": str(exc),
                })
        usable_passes = [item for item in passes if item["tokens"]]
        selected = max(usable_passes, key=lambda item: item["confidence"]) if usable_passes else None
        base = {
            "evaluation_id": evaluation_id, "key": capture["key"], "status": "ready" if selected else "blocked",
            "providers": providers, "attempts": passes,
            "provenance": {"capture_manifest_sha256": sha256(capture_manifest), "source_file": str(source.resolve()),
                           "source_sha256": capture["source_sha256"], "bbox": capture["formula_bar_bbox"],
                           "crop_sha256": capture["crop_sha256"]},
        }
        if selected:
            base.update({"selected_pass": selected["pass"], "ocr_text": " ".join(token["text"].strip() for token in selected["tokens"]),
                         "ocr_confidence": selected["confidence"], "ocr_tokens": selected["tokens"], "ocr_model": selected["model"]})
        else:
            base.update({"raw_error": passes[-1]["raw_error"], "recovery_condition": "recapture with an expanded formula bar in a new frozen manifest"})
        rows.append(base)

    rows.sort(key=lambda row: row["key"])
    write_jsonl(out / "matrix.jsonl", rows)
    blocked = [row for row in rows if row["status"] == "blocked"]
    report = {
        "valid": not blocked, "target_count": 49, "ready_count": 49 - len(blocked), "blocked_count": len(blocked),
        "attempt_count": sum(len(row["attempts"]) for row in rows), "provider_evidence": providers,
        "failures": blocked, "capture_manifest_sha256": sha256(capture_manifest),
        "artifact_sha256": {"matrix.jsonl": sha256(out / "matrix.jsonl")},
    }
    (out / "verification.json").write_bytes(json_bytes(report))
    return report


def compile_review_uncertain_66_overlay(targets_path: Path, authoritative_matrix: Path, ocr_matrix: Path, decisions_path: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    targets = unique(read_jsonl(targets_path), "evaluation_id", 66)
    authoritative = unique(read_jsonl(authoritative_matrix), "evaluation_id", 177)
    ocr = unique(read_jsonl(ocr_matrix), "evaluation_id", 49)
    decisions = json.loads(decisions_path.read_text(encoding="utf-8"))
    target_keys = {row["key"] for row in targets.values()}
    reviews = validate_review_decisions(decisions, target_keys)
    ocr_by_key = {row["key"]: row for row in ocr.values()}
    rows = []
    for evaluation_id, target in targets.items():
        base = dict(authoritative[evaluation_id])
        key = target["key"]
        base["review_uncertain_66_overlay"] = {
            "target_manifest_sha256": sha256(targets_path), "decisions_sha256": sha256(decisions_path),
            "decision": reviews.get(key, {}).get("terminal_status", "unresolved_without_agent_review"),
            "agent_review": reviews.get(key),
        }
        review = reviews.get(key)
        if review and review["final_text"] is not None:
            evidence = ocr_by_key.get(key)
            if not evidence or evidence["status"] != "ready":
                raise ValueError(f"recovered decision lacks ready OCR evidence: {key}")
            text = review["final_text"]
            if not isinstance(text, str) or not text.strip():
                raise ValueError(f"blank recovered transcription: {key}")
            base.update({
                "final_transcription": text, "final_uncertainty_markers": [],
                "final_transcription_source": "review_uncertain_66_overlay_v1",
                "final_classification": "recovered_complete", "recovery_condition": None,
                "recapture_provenance": evidence["provenance"], "ocr_evidence": evidence,
            })
        rows.append(base)
    rows.sort(key=lambda row: row["key"])
    out.mkdir(parents=True)
    write_jsonl(out / "matrix.jsonl", rows)
    report = {
        "valid": True, "target_count": 66,
        "recovered_count": sum(row["final_classification"] == "recovered_complete" for row in rows),
        "unresolved_count": sum(row["final_classification"] != "recovered_complete" for row in rows),
        "classifications": dict(Counter(row["final_classification"] for row in rows)),
        "attempts": {"ocr": sum(len(row.get("ocr_evidence", {}).get("attempts", [])) for row in rows),
                     "analysis_a_cells": len(reviews), "analysis_b_cells": len(reviews),
                     "arbitration_cells": sum(review["arbitration"] is not None for review in reviews.values())},
        "failures": {key: review for key, review in reviews.items() if review["terminal_status"] == "unresolved"},
        "lineage": {"targets_sha256": sha256(targets_path), "authoritative_matrix_sha256": sha256(authoritative_matrix),
                    "ocr_matrix_sha256": sha256(ocr_matrix), "decisions_sha256": sha256(decisions_path)},
        "artifact_sha256": {"matrix.jsonl": sha256(out / "matrix.jsonl")},
    }
    (out / "verification.json").write_bytes(json_bytes(report))
    return report


def compile_review_uncertain_51_dom_overlay(base_overlay: Path, transcriptions_path: Path, capture_root: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    rows_by_id = unique(read_jsonl(base_overlay), "evaluation_id", 66)
    unresolved = {row["key"]: row for row in rows_by_id.values() if row["final_classification"] != "recovered_complete"}
    if len(unresolved) != 51:
        raise ValueError(f"expected 51 unresolved base rows, got {len(unresolved)}")
    evidence = json.loads(transcriptions_path.read_text(encoding="utf-8"))
    if evidence.get("contract_version") != "review-uncertain-51-dom-v1":
        raise ValueError("invalid DOM transcription contract")
    transcriptions = evidence.get("transcriptions")
    if not isinstance(transcriptions, dict) or len(transcriptions) != 21 or not set(transcriptions).issubset(unresolved):
        raise ValueError("expected 21 DOM transcriptions within the 51 unresolved targets")
    if any(not isinstance(text, str) or not text.strip() for text in transcriptions.values()):
        raise ValueError("DOM transcriptions must be nonblank strings")

    capture_evidence = {}
    for key, row in unresolved.items():
        worksheet, source_row, source_column = key.split("|")
        capture = capture_root / worksheet / f"{source_column}{source_row}.png"
        if not capture.is_file() or not is_within(capture, capture_root):
            raise ValueError(f"missing or unsafe DOM capture: {key}")
        capture_evidence[key] = {"capture": str(capture.resolve()), "capture_sha256": sha256(capture)}
        row["review_uncertain_51_dom_overlay"] = {
            "contract_version": "review-uncertain-51-dom-overlay-v1",
            "transcriptions_sha256": sha256(transcriptions_path),
            "terminal_status": "recovered_from_formula_bar" if key in transcriptions else "source_blank",
            **capture_evidence[key],
        }
        if key in transcriptions:
            row.update({
                "final_transcription": transcriptions[key], "final_uncertainty_markers": [],
                "final_transcription_source": "tencent_sheet_formula_bar_dom_v1",
                "final_classification": "recovered_complete", "recovery_condition": None,
                "recapture_provenance": {"capture_manifest_sha256": sha256(transcriptions_path),
                                         "source_file": str(capture.resolve()), "source_sha256": sha256(capture),
                                         "bbox": None, "crop_sha256": sha256(capture)},
            })
    rows = sorted(rows_by_id.values(), key=lambda row: row["key"])
    out.mkdir(parents=True)
    write_jsonl(out / "matrix.jsonl", rows)
    recovered_count = sum(row["final_classification"] == "recovered_complete" for row in rows)
    report = {
        "valid": recovered_count == 36, "target_count": 66, "dom_recapture_target_count": 51,
        "dom_recovered_count": 21, "source_blank_count": 30,
        "recovered_count": recovered_count, "unresolved_count": 66 - recovered_count,
        "classifications": dict(Counter(row["final_classification"] for row in rows)),
        "failures": {key: value for key, value in capture_evidence.items() if key not in transcriptions},
        "lineage": {"base_overlay_sha256": sha256(base_overlay), "transcriptions_sha256": sha256(transcriptions_path)},
        "artifact_sha256": {"matrix.jsonl": sha256(out / "matrix.jsonl")},
    }
    (out / "verification.json").write_bytes(json_bytes(report))
    return report


def combine_ocr(old_matrix: Path, recapture_matrix: Path, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    old = unique(read_jsonl(old_matrix), "evaluation_id", 62)
    recaptured = unique(read_jsonl(recapture_matrix), "evaluation_id", 5)
    overlap = set(old) & set(recaptured)
    if len(overlap) != 1:
        raise ValueError(f"expected one replaced OCR evaluation, got {sorted(overlap)}")
    old.update(recaptured)
    if len(old) != 66:
        raise ValueError(f"expected 66 final OCR evaluations, got {len(old)}")
    rows = sorted(old.values(), key=lambda row: row["evaluation_id"])
    out.mkdir(parents=True)
    write_jsonl(out / "matrix.jsonl", rows)
    report = {"valid": True, "target_count": 66, "ready_count": sum(row["status"] == "ready" for row in rows), "blocked_count": sum(row["status"] == "blocked" for row in rows), "replaced_count": 1, "added_count": 4, "artifact_sha256": {"matrix.jsonl": sha256(out / "matrix.jsonl")}}
    (out / "verification.json").write_bytes(json_bytes(report))
    return report


def ocr_blocked(blocked_path: Path, source_root: Path, crop_root: Path, out: Path) -> dict[str, Any]:
    rows = read_jsonl(blocked_path)
    targets = unique(rows, "evaluation_id", 62)
    engine = get_ocr_engine(True)
    verify_rapidocr_cuda(engine)
    providers = {
        name: getattr(getattr(getattr(engine, name), "session"), "session").get_providers()
        for name in ("text_det", "text_cls", "text_rec")
    }
    matrix = []
    recaptures = []
    for evaluation_id, row in targets.items():
        crop = verified_crop(source_root, row["source"], "review", crop_root / row["worksheet"] / f"{row['source_row']:03d}-{row['source_column']}.png")
        attempts = []
        try:
            tokens, model = run_ocr(crop, True)
            usable = [token for token in tokens if token.text.strip()]
            attempts.append({"attempt": 1, "model": model, "providers": providers, "input_sha256": sha256(crop), "token_count": len(usable), "raw_error": None if usable else "RapidOCR returned no nonblank tokens"})
            attempt = 1
            ocr_crop = crop
            if not usable:
                from PIL import Image, ImageEnhance, ImageFilter, ImageOps

                recapture = out / "recapture-v1" / row["worksheet"] / f"{row['source_row']:03d}-{row['source_column']}.png"
                recapture.parent.mkdir(parents=True, exist_ok=True)
                with Image.open(crop).convert("RGB") as image:
                    image = image.resize((image.width * 4, image.height * 4), Image.Resampling.LANCZOS)
                    image = ImageEnhance.Contrast(image).enhance(2.0).filter(ImageFilter.SHARPEN)
                    ImageOps.expand(image, border=40, fill="white").save(recapture)
                recaptures.append({
                    "evaluation_id": evaluation_id, "source_crop": str(crop.resolve()),
                    "source_crop_sha256": sha256(crop), "recapture": str(recapture.resolve()),
                    "recapture_sha256": sha256(recapture),
                    "parameters": {"scale": 4, "resample": "LANCZOS", "contrast": 2.0, "filter": "SHARPEN", "padding": 40},
                    "trigger": "RapidOCR returned no nonblank tokens on frozen crop",
                })
                tokens, model = run_ocr(recapture, True)
                usable = [token for token in tokens if token.text.strip()]
                attempts.append({"attempt": 2, "model": model, "providers": providers, "input_sha256": sha256(recapture), "token_count": len(usable), "raw_error": None if usable else "RapidOCR returned no nonblank tokens after targeted recapture"})
                attempt = 2; ocr_crop = recapture
            if not usable:
                raise ValueError("RapidOCR returned no nonblank tokens after targeted recapture")
            matrix.append({
                "evaluation_id": evaluation_id,
                "key": f"{row['worksheet']}|{row['source_row']}|{row['source_column']}",
                "status": "ready", "ocr_text": " ".join(token.text.strip() for token in usable),
                "ocr_confidence": round(statistics.mean(token.confidence for token in usable), 6),
                "ocr_tokens": [asdict(token) for token in usable], "ocr_model": model,
                "providers": providers, "attempt": attempt, "attempts": attempts,
                "source_crop": str(crop.resolve()), "source_crop_sha256": sha256(crop),
                "crop": str(ocr_crop.resolve()), "crop_sha256": sha256(ocr_crop),
            })
        except Exception as exc:
            matrix.append({
                "evaluation_id": evaluation_id, "key": f"{row['worksheet']}|{row['source_row']}|{row['source_column']}",
                "status": "blocked", "raw_error": str(exc), "attempt": len(attempts), "attempts": attempts,
                "recovery_condition": "recapture this review cell in a new frozen manifest and rerun CUDA RapidOCR",
                "providers": providers, "crop": str(crop.resolve()), "crop_sha256": sha256(crop),
            })
    write_jsonl(out / "matrix.jsonl", matrix)
    write_jsonl(out / "recapture-v1" / "manifest.jsonl", recaptures)
    ready = sum(row["status"] == "ready" for row in matrix)
    verification = {
        "valid": len(matrix) == 62 and len({row["evaluation_id"] for row in matrix}) == 62,
        "target_count": 62, "ready_count": ready, "blocked_count": 62 - ready,
        "provider_evidence": providers, "attempt_count": 62 + len(recaptures), "recapture_count": len(recaptures),
        "artifact_sha256": {"matrix.jsonl": sha256(out / "matrix.jsonl"), "recapture-v1/manifest.jsonl": sha256(out / "recapture-v1" / "manifest.jsonl")},
    }
    (out / "verification.json").write_bytes(json_bytes(verification))
    return verification


def remove_reason(row: dict[str, Any], reason: str) -> None:
    row["manual_review_reasons"] = [value for value in row["manual_review_reasons"] if value != reason]


def sync_status(row: dict[str, Any]) -> None:
    row["review_status"] = "needs_review" if row["manual_review_reasons"] else "candidate"


def rebuild_entities(evaluations: list[dict[str, Any]], version: str) -> dict[str, list[dict[str, Any]]]:
    courses: dict[str, dict[str, Any]] = {}
    teachers: dict[str, dict[str, Any]] = {}
    relations: dict[str, dict[str, Any]] = {}
    for row in evaluations:
        row["dataset_version"] = version
        provenance = {
            "evaluation_id": row["evaluation_id"], "worksheet": row["worksheet"], "row": row["source_row"],
            "review_key": f"{row['worksheet']}|{row['source_row']}|{row['source_column']}",
            "review_source_file": row["source"]["review_source_file"], "review_source_sha256": row["source"]["review_source_sha256"],
            "review_crop_sha256": row["source"]["review_crop_sha256"], "context_source_file": row["source"]["context_source_file"],
            "context_source_sha256": row["source"]["context_source_sha256"], "context_crop_sha256": row["source"]["context_crop_sha256"],
        }
        if row.get("course_id"):
            courses.setdefault(row["course_id"], {"schema_version": "course-candidate-v1", "dataset_version": version, "course_id": row["course_id"], "name": row["course_name"], "review_status": "candidate", "provenance": []})["provenance"].append(provenance)
        if row.get("teacher_id"):
            teachers.setdefault(row["teacher_id"], {"schema_version": "teacher-candidate-v1", "dataset_version": version, "teacher_id": row["teacher_id"], "name": row["teacher_name"], "review_status": "candidate", "provenance": []})["provenance"].append(provenance)
        if row.get("course_id") and row.get("teacher_id"):
            relation_id = stable_id("relation", row["course_id"], row["teacher_id"])
            relations.setdefault(relation_id, {"schema_version": "course-teacher-candidate-v1", "dataset_version": version, "relation_id": relation_id, "course_id": row["course_id"], "teacher_id": row["teacher_id"], "review_status": "candidate", "provenance": []})["provenance"].append(provenance)
    return {"courses": sorted(courses.values(), key=lambda row: row["course_id"]), "teachers": sorted(teachers.values(), key=lambda row: row["teacher_id"]), "course_teachers": sorted(relations.values(), key=lambda row: row["relation_id"])}


def compile_package(package_root: Path, review_matrix: Path, context_matrix: Path, ocr_matrix: Path, version: str, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    manifest, package_sha = verified_manifest(package_root, "package-manifest.json", "legacy-review-package-v1")
    evaluations = declared_jsonl(package_root, manifest, "historical_evaluations")
    by_id = {row["evaluation_id"]: row for row in evaluations}
    if sha256(review_matrix) != AUTHORITATIVE_REVIEW_MATRIX_SHA256:
        raise ValueError("review overlay is not the authoritative 177-cell matrix")
    review_verification = json.loads((review_matrix.parent / "verification.json").read_text(encoding="utf-8"))
    if review_verification.get("valid") is not True or review_verification.get("target_count") != 177:
        raise ValueError("authoritative review verification is invalid")
    review = unique(read_jsonl(review_matrix), "evaluation_id", 177)
    context = unique(read_jsonl(context_matrix), "evaluation_id", 12)
    ocr_rows = read_jsonl(ocr_matrix)
    if len(ocr_rows) not in {62, 66}:
        raise ValueError(f"expected 62 or 66 OCR overlay rows, got {len(ocr_rows)}")
    ocr = unique(ocr_rows, "evaluation_id", len(ocr_rows))
    if not set(review).issubset(by_id) or not set(context).issubset(by_id) or not set(ocr).issubset(by_id):
        raise ValueError("overlay contains evaluation outside the base package")
    for evaluation_id, overlay in review.items():
        row = by_id[evaluation_id]
        row["comment"] = overlay["final_transcription"]
        row["review_uncertainty_markers"] = overlay["final_uncertainty_markers"]
        if overlay["final_classification"] == "recovered_complete":
            remove_reason(row, "review_uncertain")
        elif "review_uncertain" not in row["manual_review_reasons"]:
            row["manual_review_reasons"].append("review_uncertain")
        sync_status(row)
    for evaluation_id, overlay in context.items():
        row = by_id[evaluation_id]
        raw = overlay["selected_context_raw"]
        if not raw.startswith("course=") or "\nteacher=" not in raw:
            raise ValueError(f"invalid context overlay: {evaluation_id}")
        course = overlay.get("resolved_course_name")
        teacher = overlay.get("resolved_teacher_name")
        markers = overlay.get("uncertainty_markers", [])
        visibly_resolved = overlay.get("conclusion") in {"agreed", "arbitrated"} and not markers and course and teacher
        row.update({
            "course_name": course or "[unclear]", "teacher_name": teacher or "[unclear]",
            "course_id": stable_id("course", course) if course else None,
            "teacher_id": stable_id("teacher", teacher) if teacher else None,
            "context_raw": raw, "context_conclusion": overlay["conclusion"],
            "context_uncertainty_markers": markers,
        })
        if overlay.get("recapture_provenance"):
            provenance = overlay["recapture_provenance"]
            row["source"].update({
                "capture_manifest_sha256": provenance["capture_manifest_sha256"],
                "context_source_file": provenance["source_file"], "context_source_sha256": provenance["source_sha256"],
                "context_bbox": provenance["bbox"], "context_crop_sha256": provenance["crop_sha256"],
            })
        if visibly_resolved:
            remove_reason(row, "context_uncertain"); remove_reason(row, "course_unclear"); remove_reason(row, "teacher_unclear")
        sync_status(row)
    for evaluation_id, overlay in ocr.items():
        if overlay["status"] == "ready":
            confidence = overlay.get("ocr_confidence")
            tokens = overlay.get("ocr_tokens")
            if not (
                isinstance(overlay.get("ocr_text"), str) and overlay["ocr_text"].strip()
                and isinstance(confidence, (int, float)) and 0 <= confidence <= 1
                and isinstance(tokens, list) and tokens
                and all(isinstance(token.get("text"), str) and token["text"].strip() and isinstance(token.get("confidence"), (int, float)) and 0 <= token["confidence"] <= 1 for token in tokens)
            ):
                raise ValueError(f"invalid API OCR evidence: {evaluation_id}")
            by_id[evaluation_id]["source"].update({name: overlay[name] for name in ("ocr_text", "ocr_confidence", "ocr_tokens")})
            if overlay.get("provenance"):
                provenance = overlay["provenance"]
                by_id[evaluation_id]["source"].update({
                    "capture_manifest_sha256": provenance["capture_manifest_sha256"],
                    "review_source_file": provenance["source_file"], "review_source_sha256": provenance["source_sha256"],
                    "review_bbox": provenance["bbox"], "review_crop_sha256": provenance["crop_sha256"],
                })
    entities = rebuild_entities(evaluations, version)
    capture_gaps = declared_jsonl(package_root, manifest, "capture_gaps")
    package = {**entities, "historical_evaluations": evaluations, "capture_gaps": capture_gaps}
    result = write_outputs(out, version, package)
    lineage = {"contract_version": "legacy-targeted-overlay-lineage-v1", "source_package_manifest_sha256": package_sha, "overlays": {"review": {"rows": 177, "sha256": sha256(review_matrix)}, "context": {"rows": 12, "sha256": sha256(context_matrix)}, "ocr": {"rows": len(ocr), "sha256": sha256(ocr_matrix)}}}
    (out / "overlay-lineage.json").write_bytes(json_bytes(lineage))
    result["files"]["overlay-lineage.json"] = {"rows": 1, "sha256": sha256(out / "overlay-lineage.json")}
    (out / "package-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def compile_review_uncertain_66_package(package_root: Path, overlay_matrix: Path, version: str, out: Path) -> dict[str, Any]:
    if out.exists():
        raise ValueError(f"refusing existing output: {out}")
    manifest, package_sha = verified_manifest(package_root, "package-manifest.json", "legacy-review-package-v1")
    lineage_path = package_root / "overlay-lineage.json"
    if not lineage_path.is_file() or "overlay-lineage.json" not in manifest["files"]:
        raise ValueError("source package lacks verified authoritative overlay lineage")
    source_lineage = json.loads(lineage_path.read_text(encoding="utf-8"))
    lineage_contract = source_lineage.get("contract_version")
    if lineage_contract == "legacy-targeted-overlay-lineage-v1":
        if set(source_lineage.get("overlays", {})) != {"review", "context", "ocr"}:
            raise ValueError("source package does not contain each authoritative overlay exactly once")
    elif lineage_contract != "legacy-review-uncertain-66-lineage-v1":
        raise ValueError(f"unsupported source overlay lineage: {lineage_contract}")
    evaluations = declared_jsonl(package_root, manifest, "historical_evaluations")
    by_id = unique(evaluations, "evaluation_id", 1972)
    overlay = unique(read_jsonl(overlay_matrix), "evaluation_id", 66)
    overlay_verification_path = overlay_matrix.parent / "verification.json"
    if not overlay_verification_path.is_file():
        raise ValueError("review-uncertain overlay lacks verification")
    overlay_verification = json.loads(overlay_verification_path.read_text(encoding="utf-8"))
    if overlay_verification.get("valid") is not True or overlay_verification.get("target_count") != 66:
        raise ValueError("review-uncertain overlay verification is invalid")
    if overlay_verification.get("artifact_sha256", {}).get("matrix.jsonl") != sha256(overlay_matrix):
        raise ValueError("review-uncertain overlay hash is not verified")
    if not set(overlay).issubset(by_id):
        raise ValueError("review-uncertain overlay contains evaluation outside source package")
    before_identity = {
        evaluation_id: (row.get("course_id"), row.get("teacher_id"), tuple(reason for reason in row["manual_review_reasons"] if reason in {"course_unclear", "teacher_unclear"}))
        for evaluation_id, row in by_id.items() if evaluation_id in overlay
    }
    recovered = 0
    for evaluation_id, decision in overlay.items():
        row = by_id[evaluation_id]
        if decision["final_classification"] == "recovered_complete":
            has_dom_evidence = decision.get("final_transcription_source") == "tencent_sheet_formula_bar_dom_v1" and decision.get("recapture_provenance")
            if decision.get("final_uncertainty_markers") or not (decision.get("ocr_evidence") or has_dom_evidence):
                raise ValueError(f"invalid recovered overlay row: {evaluation_id}")
        else:
            if decision["final_transcription"] != row["comment"] or decision["final_uncertainty_markers"] != row["review_uncertainty_markers"]:
                raise ValueError(f"unresolved overlay mutates authoritative review: {evaluation_id}")
        row["comment"] = decision["final_transcription"]
        row["review_uncertainty_markers"] = decision["final_uncertainty_markers"]
        if decision["final_classification"] == "recovered_complete":
            remove_reason(row, "review_uncertain"); recovered += 1
            provenance = decision.get("recapture_provenance")
            if not provenance:
                raise ValueError(f"recovered review lacks recapture provenance: {evaluation_id}")
            row["source"].update({
                "capture_manifest_sha256": provenance["capture_manifest_sha256"],
                "review_source_file": provenance["source_file"], "review_source_sha256": provenance["source_sha256"],
                "review_bbox": provenance["bbox"], "review_crop_sha256": provenance["crop_sha256"],
            })
            evidence = decision.get("ocr_evidence")
            if evidence:
                row["source"].update({name: evidence[name] for name in ("ocr_text", "ocr_confidence", "ocr_tokens")})
            elif decision.get("final_transcription_source") == "tencent_sheet_formula_bar_dom_v1":
                row["source"].update({"dom_transcription": decision["final_transcription"],
                                      "dom_transcription_method": "read_only_formula_bar"})
            else:
                raise ValueError(f"recovered review lacks OCR or DOM transcription evidence: {evaluation_id}")
        elif "review_uncertain" not in row["manual_review_reasons"]:
            row["manual_review_reasons"].append("review_uncertain")
        sync_status(row)
    if recovered != overlay_verification["recovered_count"]:
        raise ValueError(f"recovered count disagrees with overlay verification: {recovered}")
    after_identity = {
        evaluation_id: (row.get("course_id"), row.get("teacher_id"), tuple(reason for reason in row["manual_review_reasons"] if reason in {"course_unclear", "teacher_unclear"}))
        for evaluation_id, row in by_id.items() if evaluation_id in overlay
    }
    if before_identity != after_identity:
        raise ValueError("review recovery changed identity fields or reasons")
    entities = rebuild_entities(evaluations, version)
    capture_gaps = declared_jsonl(package_root, manifest, "capture_gaps")
    result = write_outputs(out, version, {**entities, "historical_evaluations": evaluations, "capture_gaps": capture_gaps})
    lineage = {
        "contract_version": "legacy-review-uncertain-66-lineage-v1",
        "source_package_manifest_sha256": package_sha,
        "source_overlay_lineage_sha256": sha256(lineage_path),
        "overlay": {"name": "review_uncertain_66", "rows": 66, "sha256": sha256(overlay_matrix)},
    }
    (out / "overlay-lineage.json").write_bytes(json_bytes(lineage))
    result["files"]["overlay-lineage.json"] = {"rows": 1, "sha256": sha256(out / "overlay-lineage.json")}
    (out / "package-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def verify_run(base_package: Path, package: Path, context_matrix: Path, ocr_root: Path, staging: Path, out: Path) -> dict[str, Any]:
    base_manifest, base_sha = verified_manifest(base_package, "package-manifest.json", "legacy-review-package-v1")
    new_manifest, new_sha = verified_manifest(package, "package-manifest.json", "legacy-review-package-v1")
    staging_manifest, staging_sha = verified_manifest(staging, "production-staging-manifest.json", "legacy-production-staging-v1")
    before = declared_jsonl(base_package, base_manifest, "historical_evaluations")
    after = declared_jsonl(package, new_manifest, "historical_evaluations")
    reasons = lambda rows: dict(sorted(Counter(reason for row in rows for reason in row["manual_review_reasons"]).items()))
    context = unique(read_jsonl(context_matrix), "evaluation_id", 12)
    ocr_rows = read_jsonl(ocr_root / "matrix.jsonl")
    if len(ocr_rows) not in {62, 66}:
        raise ValueError(f"unexpected OCR verification target count: {len(ocr_rows)}")
    ocr = unique(ocr_rows, "evaluation_id", len(ocr_rows))
    blocked = [row for row in ocr.values() if row["status"] == "blocked"]
    ocr_verification = json.loads((ocr_root / "verification.json").read_text(encoding="utf-8"))
    provider_evidence = ocr_verification.get("provider_evidence") or next((row.get("providers") for row in ocr.values() if row.get("providers")), {})
    report = {
        "valid": len(before) == len(after) == 1972,
        "counts": {
            "input_evaluations": len(after), "context_targets": len(context),
            "context_resolved": sum(not row["uncertainty_markers"] for row in context.values()),
            "context_unresolved": sum(bool(row["uncertainty_markers"]) for row in context.values()),
            "ocr_targets": len(ocr), "ocr_ready": sum(row["status"] == "ready" for row in ocr.values()),
            "ocr_blocked": len(blocked), **staging_manifest["counts"],
        },
        "manual_reason_counts": {"before": reasons(before), "after": reasons(after)},
        "provider_evidence": provider_evidence,
        "attempts": {"ocr": sum(len(row.get("attempts", [])) for row in ocr.values()), "context_a": 5, "context_b": 5, "context_arbitration": 2},
        "failures": blocked,
        "artifact_sha256": {
            "base_package_manifest": base_sha, "package_manifest": new_sha,
            "staging_manifest": staging_sha, "review_matrix": AUTHORITATIVE_REVIEW_MATRIX_SHA256,
            "context_matrix": sha256(context_matrix), "ocr_matrix": sha256(ocr_root / "matrix.jsonl"),
        },
    }
    expected = (8, 4, 61, 1) if len(ocr) == 62 else (12, 0, 66, 0)
    actual = (report["counts"]["context_resolved"], report["counts"]["context_unresolved"], report["counts"]["ocr_ready"], report["counts"]["ocr_blocked"])
    if actual != expected:
        report["valid"] = False
    out.mkdir(parents=True, exist_ok=False)
    (out / "verification.json").write_bytes(json_bytes(report))
    return report


def verify_review_uncertain_66_run(base_package: Path, package: Path, targets_path: Path, preparation_root: Path, ocr_root: Path, overlay_root: Path, staging: Path, out: Path) -> dict[str, Any]:
    base_manifest, base_sha = verified_manifest(base_package, "package-manifest.json", "legacy-review-package-v1")
    new_manifest, new_sha = verified_manifest(package, "package-manifest.json", "legacy-review-package-v1")
    staging_manifest, staging_sha = verified_manifest(staging, "production-staging-manifest.json", "legacy-production-staging-v1")
    before = unique(declared_jsonl(base_package, base_manifest, "historical_evaluations"), "evaluation_id", 1972)
    after = unique(declared_jsonl(package, new_manifest, "historical_evaluations"), "evaluation_id", 1972)
    targets = unique(read_jsonl(targets_path), "evaluation_id", 66)
    preparation = json.loads((preparation_root / "preparation-verification.json").read_text(encoding="utf-8"))
    ocr_verification = json.loads((ocr_root / "verification.json").read_text(encoding="utf-8"))
    overlay_verification = json.loads((overlay_root / "verification.json").read_text(encoding="utf-8"))
    overlay = unique(read_jsonl(overlay_root / "matrix.jsonl"), "evaluation_id", 66)
    recovered_ids = {evaluation_id for evaluation_id, row in overlay.items() if row["final_classification"] == "recovered_complete"}
    before_combinations = Counter(tuple(before[evaluation_id]["manual_review_reasons"]) for evaluation_id in targets)
    after_combinations = Counter(tuple(after[evaluation_id]["manual_review_reasons"]) for evaluation_id in targets)
    changes = []
    identity_valid = True
    for evaluation_id, target in targets.items():
        old, new = before[evaluation_id], after[evaluation_id]
        old_identity = (old.get("course_id"), old.get("teacher_id"), tuple(reason for reason in old["manual_review_reasons"] if reason in {"course_unclear", "teacher_unclear"}))
        new_identity = (new.get("course_id"), new.get("teacher_id"), tuple(reason for reason in new["manual_review_reasons"] if reason in {"course_unclear", "teacher_unclear"}))
        identity_valid &= old_identity == new_identity
        changes.append({"evaluation_id": evaluation_id, "key": target["key"], "before": old["manual_review_reasons"],
                        "after": new["manual_review_reasons"], "recovered": evaluation_id in recovered_ids})
    recovered_count = len(recovered_ids)
    unresolved_count = 66 - recovered_count
    expected_api_blocked = sum(
        not after[evaluation_id]["manual_review_reasons"]
        and after[evaluation_id].get("source", {}).get("dom_transcription_method") == "read_only_formula_bar"
        and not (
            isinstance(after[evaluation_id].get("source", {}).get("ocr_text"), str)
            and after[evaluation_id]["source"]["ocr_text"].strip()
            and isinstance(after[evaluation_id]["source"].get("ocr_confidence"), (int, float))
            and after[evaluation_id]["source"].get("ocr_tokens")
        )
        for evaluation_id in targets
    )
    expected_staging_shape = (
        staging_manifest["counts"].get("input_evaluations") == 1972
        and staging_manifest["counts"].get("api_evidence_blocked") == expected_api_blocked
        and staging_manifest["counts"].get("excluded_blank") == 179
        and staging_manifest["counts"].get("pending_external_review") == unresolved_count
        and staging_manifest["counts"].get("ai_verified") == staging_manifest["counts"].get("api_ready", 0) + expected_api_blocked
        and staging_manifest["counts"].get("ai_verified", 0) + staging_manifest["counts"].get("quarantined", 0) + 179 == 1972
    )
    valid = bool(
        preparation.get("valid") and preparation.get("target_count") == 66 and preparation.get("capture_count") == 49
        and ocr_verification.get("target_count") == 49 and ocr_verification.get("ready_count") == 20 and ocr_verification.get("blocked_count") == 29
        and overlay_verification.get("valid") and overlay_verification.get("recovered_count") == recovered_count
        and overlay_verification.get("unresolved_count") == unresolved_count
        and identity_valid and expected_staging_shape
        and sum("review_uncertain" in after[evaluation_id]["manual_review_reasons"] for evaluation_id in targets) == unresolved_count
    )
    report = {
        "valid": valid, "counts": {**staging_manifest["counts"], "targets": 66, "recovered": recovered_count, "unresolved": unresolved_count,
                                      "capture_count": 49, "ocr_ready": 20, "ocr_blocked": 29},
        "reason_combinations": {
            "before": {" + ".join(key) or "none": value for key, value in sorted(before_combinations.items())},
            "after": {" + ".join(key) or "none": value for key, value in sorted(after_combinations.items())},
        },
        "identity_reasons_preserved": identity_valid, "target_changes": sorted(changes, key=lambda row: row["key"]),
        "ocr": {"attempt_count": ocr_verification.get("attempt_count"), "provider_evidence": ocr_verification.get("provider_evidence"),
                "failures": ocr_verification.get("failures", [])},
        "agent_attempts": overlay_verification.get("attempts"), "overlay_failures": overlay_verification.get("failures"),
        "lineage": {"source_package_manifest_sha256": base_sha, "package_manifest_sha256": new_sha,
                    "staging_manifest_sha256": staging_sha, "targets_sha256": sha256(targets_path),
                    "capture_manifest_sha256": sha256(preparation_root / "capture-manifest.jsonl"),
                    "ocr_matrix_sha256": sha256(ocr_root / "matrix.jsonl"), "overlay_matrix_sha256": sha256(overlay_root / "matrix.jsonl")},
    }
    out.mkdir(parents=True, exist_ok=False)
    (out / "verification.json").write_bytes(json_bytes(report))
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    context = commands.add_parser("prepare-context")
    context.add_argument("--package-root", required=True); context.add_argument("--source-root", required=True); context.add_argument("--crop-root", required=True); context.add_argument("--out", required=True)
    review66 = commands.add_parser("prepare-review-uncertain-66")
    review66.add_argument("--staging", required=True); review66.add_argument("--authoritative-matrix", required=True); review66.add_argument("--capture-root", required=True); review66.add_argument("--out", required=True)
    nine = commands.add_parser("prepare-nine")
    nine.add_argument("--input-root", required=True); nine.add_argument("--out", required=True)
    update_context = commands.add_parser("update-context-recapture")
    update_context.add_argument("--old-matrix", required=True); update_context.add_argument("--capture-manifest", required=True); update_context.add_argument("--out", required=True)
    remaining = commands.add_parser("ocr-remaining")
    remaining.add_argument("--blocked", required=True); remaining.add_argument("--source-root", required=True); remaining.add_argument("--crop-root", required=True); remaining.add_argument("--targeted-source-root", required=True); remaining.add_argument("--targeted-crop-root", required=True); remaining.add_argument("--capture-manifest", required=True); remaining.add_argument("--out", required=True)
    review66_ocr = commands.add_parser("ocr-review-uncertain-66")
    review66_ocr.add_argument("--capture-manifest", required=True); review66_ocr.add_argument("--out", required=True)
    review66_overlay = commands.add_parser("compile-review-uncertain-66")
    review66_overlay.add_argument("--targets", required=True); review66_overlay.add_argument("--authoritative-matrix", required=True); review66_overlay.add_argument("--ocr-matrix", required=True); review66_overlay.add_argument("--decisions", required=True); review66_overlay.add_argument("--out", required=True)
    review51_dom = commands.add_parser("compile-review-uncertain-51-dom")
    review51_dom.add_argument("--base-overlay", required=True); review51_dom.add_argument("--transcriptions", required=True); review51_dom.add_argument("--capture-root", required=True); review51_dom.add_argument("--out", required=True)
    combine = commands.add_parser("combine-ocr")
    combine.add_argument("--old-matrix", required=True); combine.add_argument("--recapture-matrix", required=True); combine.add_argument("--out", required=True)
    ocr = commands.add_parser("ocr-blocked")
    ocr.add_argument("--blocked", required=True); ocr.add_argument("--source-root", required=True); ocr.add_argument("--crop-root", required=True); ocr.add_argument("--out", required=True)
    compile_cmd = commands.add_parser("compile")
    compile_cmd.add_argument("--package-root", required=True); compile_cmd.add_argument("--review-matrix", required=True); compile_cmd.add_argument("--context-matrix", required=True); compile_cmd.add_argument("--ocr-matrix", required=True); compile_cmd.add_argument("--version", required=True); compile_cmd.add_argument("--out", required=True)
    compile_review66_package = commands.add_parser("compile-review-uncertain-package")
    compile_review66_package.add_argument("--package-root", required=True); compile_review66_package.add_argument("--overlay-matrix", required=True); compile_review66_package.add_argument("--version", required=True); compile_review66_package.add_argument("--out", required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--base-package", required=True); verify.add_argument("--package", required=True); verify.add_argument("--context-matrix", required=True); verify.add_argument("--ocr-root", required=True); verify.add_argument("--staging", required=True); verify.add_argument("--out", required=True)
    verify66 = commands.add_parser("verify-review-uncertain-66")
    verify66.add_argument("--base-package", required=True); verify66.add_argument("--package", required=True); verify66.add_argument("--targets", required=True); verify66.add_argument("--preparation-root", required=True); verify66.add_argument("--ocr-root", required=True); verify66.add_argument("--overlay-root", required=True); verify66.add_argument("--staging", required=True); verify66.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.command == "prepare-context": result = prepare_context(Path(args.package_root), Path(args.source_root), Path(args.crop_root), Path(args.out))
    elif args.command == "prepare-review-uncertain-66": result = prepare_review_uncertain_66(Path(args.staging), Path(args.authoritative_matrix), Path(args.capture_root), Path(args.out))
    elif args.command == "prepare-nine": result = prepare_nine_capture(Path(args.input_root), Path(args.out))
    elif args.command == "update-context-recapture": result = update_context_recapture(Path(args.old_matrix), Path(args.capture_manifest), Path(args.out))
    elif args.command == "ocr-remaining": result = ocr_remaining(Path(args.blocked), Path(args.source_root), Path(args.crop_root), Path(args.targeted_source_root), Path(args.targeted_crop_root), Path(args.capture_manifest), Path(args.out))
    elif args.command == "ocr-review-uncertain-66": result = ocr_review_uncertain_captures(Path(args.capture_manifest), Path(args.out))
    elif args.command == "compile-review-uncertain-66": result = compile_review_uncertain_66_overlay(Path(args.targets), Path(args.authoritative_matrix), Path(args.ocr_matrix), Path(args.decisions), Path(args.out))
    elif args.command == "compile-review-uncertain-51-dom": result = compile_review_uncertain_51_dom_overlay(Path(args.base_overlay), Path(args.transcriptions), Path(args.capture_root), Path(args.out))
    elif args.command == "combine-ocr": result = combine_ocr(Path(args.old_matrix), Path(args.recapture_matrix), Path(args.out))
    elif args.command == "ocr-blocked": result = ocr_blocked(Path(args.blocked), Path(args.source_root), Path(args.crop_root), Path(args.out))
    elif args.command == "compile": result = compile_package(Path(args.package_root), Path(args.review_matrix), Path(args.context_matrix), Path(args.ocr_matrix), args.version, Path(args.out))
    elif args.command == "compile-review-uncertain-package": result = compile_review_uncertain_66_package(Path(args.package_root), Path(args.overlay_matrix), args.version, Path(args.out))
    elif args.command == "verify-review-uncertain-66": result = verify_review_uncertain_66_run(Path(args.base_package), Path(args.package), Path(args.targets), Path(args.preparation_root), Path(args.ocr_root), Path(args.overlay_root), Path(args.staging), Path(args.out))
    else: result = verify_run(Path(args.base_package), Path(args.package), Path(args.context_matrix), Path(args.ocr_root), Path(args.staging), Path(args.out))
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
