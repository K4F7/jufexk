let meta = #{
    name: "legacy-review-package",
    description: "Unattended post-freeze review: CUDA RapidOCR, isolated A/B, arbitration, then an independent image-versus-text agent that may auto-approve. Does not write the business database.",
    when_to_use: "A formula-bar / capture manifest is already frozen and you need the post-freeze review package. Do not use this for screenshots or locator work.",
    phases: [
        #{ title: "Inventory", detail: "route frozen cells into batches of at most 8" },
        #{ title: "OCR", detail: "local GPU RapidOCR only; no CPU fallback" },
        #{ title: "Analyze", detail: "isolated A/B on pending batches" },
        #{ title: "Arbitrate", detail: "choose A or B or unresolved; no third draft" },
        #{ title: "Compile", detail: "write the review package" },
        #{ title: "Verify", detail: "independent image-versus-text approval" },
    ],
};

let inventory_schema = #{
    "type": "object",
    "properties": #{
        "status": #{ "type": "string" },
        "reason": #{ "type": "string" },
        "inventory_path": #{ "type": "string" },
        "input_sha256": #{ "type": "string" },
        "ocr_command": #{ "type": "string" },
        "planned_cells": #{ "type": "number" },
        "routed_cells": #{ "type": "number" },
        "pending_cells": #{ "type": "number" },
        "unresolved_cells": #{ "type": "number" },
        "ocr_missing_cells": #{ "type": "number" },
        "pending_verify_cells": #{ "type": "number" },
        "pending_verify": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "properties": #{
                    "task_id": #{ "type": "string" },
                    "worksheet": #{ "type": "string" },
                    "payload": #{ "type": "string" },
                    "keys": #{ "type": "array", "items": #{ "type": "string" } },
                },
            },
        },
        "pending_batches": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "properties": #{
                    "task_id": #{ "type": "string" },
                    "worksheet": #{ "type": "string" },
                    "payload_a": #{ "type": "string" },
                    "payload_b": #{ "type": "string" },
                    "keys": #{ "type": "array", "items": #{ "type": "string" } },
                },
            },
        },
    },
};
let analysis_schema = #{
    "type": "object",
    "properties": #{
        "cells": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "properties": #{
                    "key": #{ "type": "string" },
                    "visible_course": #{ "type": "string" },
                    "visible_teacher": #{ "type": "string" },
                    "course_status": #{ "type": "string" },
                    "teacher_status": #{ "type": "string" },
                    "overflow": #{ "type": "string" },
                    "visual_correspondence": #{ "type": "string" },
                    "uncertainty_markers": #{ "type": "array", "items": #{ "type": "string" } },
                },
            },
        },
    },
};
let verdict_schema = #{
    "type": "object",
    "properties": #{
        "cells": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "properties": #{
                    "key": #{ "type": "string" },
                    "selected": #{ "type": ["string", "null"] },
                    "reason": #{ "type": "string" },
                },
            },
        },
    },
};
let approval_schema = #{
    "type": "object",
    "properties": #{
        "cells": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "properties": #{
                    "key": #{ "type": "string" },
                    "approve": #{ "type": "boolean" },
                    "body_matches_source": #{ "type": "boolean" },
                    "mapping_supported": #{ "type": "boolean" },
                    "evidence": #{ "type": "string" },
                },
            },
        },
    },
};
let compile_schema = #{
    "type": "object",
    "properties": #{
        "status": #{ "type": "string" },
        "package_path": #{ "type": "string" },
        "planned_cells": #{ "type": "number" },
        "routed_cells": #{ "type": "number" },
        "unresolved_cells": #{ "type": "number" },
        "approved_cells": #{ "type": "number" },
    },
};

fn trimmed(value) {
    if type_of(value) == "string" {
        value.trim();
        value
    } else {
        ""
    }
}

fn has_text(value) {
    trimmed(value) != ""
}

fn usable(result) {
    result != () && result.success && result.output != ()
}

fn inventory_command(out_dir, evidence_dir, context_path, manifest_path, ocr_dir, worksheet, first_row, last_row, max_batches) {
    let command = "pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts inventory --out ";
    command += out_dir;
    if has_text(evidence_dir) { command += " --evidence-dir "; command += evidence_dir; }
    if has_text(context_path) { command += " --context "; command += context_path; }
    if has_text(manifest_path) { command += " --manifest "; command += manifest_path; }
    if has_text(ocr_dir) { command += " --ocr-dir "; command += ocr_dir; }
    if has_text(worksheet) { command += " --worksheet "; command += worksheet; }
    if first_row != () { command += " --first-row "; command += first_row.to_string(); }
    if last_row != () { command += " --last-row "; command += last_row.to_string(); }
    if max_batches != () { command += " --max-batches "; command += max_batches.to_string(); }
    command
}

fn wave_size(requested) {
    let cap = budget();
    let remaining = if cap == () || cap.remaining == () { 128 } else { cap.remaining };
    if remaining < 1 { return 0; }
    let room = remaining - 3;
    let n = 0;
    while (n + 1) * 3 <= room && n < 8 {
        n += 1;
    }
    if requested != () && requested < n { n = requested; }
    if n < 0 { n = 0; }
    n
}

fn isolation_rules() {
    let text = "Do not inspect repository files, issues, ADRs, CONTEXT.md, Git state, or any path not listed in the payload. ";
    text += "Use read_file on the payload JSON first, then on each listed image path. ";
    text += "Never guess. Never invent a third review body. Never change formula_bar_value. ";
    text += "The formula bar is the body authority; you only judge mapping, overflow, and visual correspondence.";
    text
}

fn analysis_prompt(side, payload_path, keys_json) {
    let prompt = "You are an isolated legacy-review cell agent for side ";
    prompt += side;
    prompt += ".\n";
    prompt += isolation_rules();
    prompt += "\nPayload file: ";
    prompt += payload_path;
    prompt += "\nRequired keys (return each exactly once): ";
    prompt += keys_json;
    prompt += "\n";
    if side == "analysis_a" {
        prompt += "You are side A. OCR evidence is intentionally absent. Do not seek it.\n";
    } else {
        prompt += "You are side B. Use the OCR evidence in the payload together with the crops.\n";
    }
    prompt += "For every key set: visible_course, visible_teacher, course_status (clear|blank|unclear|inherited_anchor), ";
    prompt += "teacher_status (clear|blank|unclear), overflow (none|extends_right|unreadable), ";
    prompt += "visual_correspondence (matches_formula|formula_truncated_visible|conflict|unreadable), ";
    prompt += "and uncertainty_markers. Empty uncertainty_markers is valid only after you have read the payload and images.";
    prompt
}

fn verify_and_apply(out_dir, pending_verify, last_inventory, last_package, wave, approval_schema, compile_schema) {
    phase("Verify");
    let jobs = [];
    for batch in pending_verify {
        if batch == () || !has_text(batch.task_id) { continue; }
        jobs.push(#{
            prompt: approval_prompt(batch.payload, json_encode(batch.keys)),
            label: "ok:" + batch.task_id,
            capability_mode: "read-only",
            output_schema: approval_schema,
        });
    }
    if jobs.len() == 0 { return last_package; }
    let results = parallel(jobs);
    let batches = [];
    let index = 0;
    for batch in pending_verify {
        if batch == () || !has_text(batch.task_id) { continue; }
        let result = results[index];
        index += 1;
        if usable(result) && result.output.cells != () {
            batches.push(#{ task_id: batch.task_id, keys: batch.keys, cells: result.output.cells });
        } else {
            batches.push(#{ task_id: batch.task_id, keys: batch.keys });
        }
    }
    let verdicts_path = out_dir + "/wave-" + (wave + 1).to_string() + "-approvals.json";
    let package_path = trimmed(last_inventory.inventory_path);
    if last_package != () && has_text(last_package.package_path) { package_path = last_package.package_path; }
    if !has_text(package_path) { package_path = out_dir + "/package.json"; }
    let apply_prompt = "Write this JSON exactly to ";
    apply_prompt += verdicts_path;
    apply_prompt += " and run this command from the repository root. Do not write Tencent Docs, the business database, or Git.\n";
    apply_prompt += "pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts approve --package ";
    apply_prompt += package_path;
    apply_prompt += " --verdicts ";
    apply_prompt += verdicts_path;
    apply_prompt += " --out ";
    apply_prompt += out_dir;
    apply_prompt += "\nJSON:\n";
    apply_prompt += json_encode(#{ batches: batches });
    let applied = agent(apply_prompt, #{
        label: "approve",
        capability_mode: "execute",
        output_schema: compile_schema,
    });
    if usable(applied) { applied.output } else { last_package }
}

fn approval_prompt(payload_path, keys_json) {
    let prompt = "You are an independent image-versus-text approval agent.\n";
    prompt += "Do not inspect repository files, issues, ADRs, CONTEXT.md, Git state, or any path not listed in the payload. ";
    prompt += "Use read_file on the payload JSON first, then on each listed image.\n";
    prompt += "Payload file: ";
    prompt += payload_path;
    prompt += "\nRequired keys: ";
    prompt += keys_json;
    prompt += "\nThe formula_bar_value is the candidate body. Do not invent a third transcription. ";
    prompt += "Set body_matches_source=true only if the images support that exact formula-bar text as the stored review (visible text may be truncated). ";
    prompt += "A systematic crop/formula mismatch may still have body_matches_source=true when the formula-bar text is the stored source. ";
    prompt += "Set mapping_supported=true only if the declared course and teacher are supported by the payload context or visible labels. ";
    prompt += "Set approve=true only when both flags are true and you cite concrete image evidence. ";
    prompt += "If you did not read the images, approve must be false. Empty evidence is not approval.";
    prompt
}

fn arbitration_prompt(payload_a, payload_b, keys_json, analysis_a_json, analysis_b_json) {
    let prompt = "You are an isolated legacy-review arbitration agent.\n";
    prompt += isolation_rules();
    prompt += "\nSide A payload: ";
    prompt += payload_a;
    prompt += "\nSide B payload: ";
    prompt += payload_b;
    prompt += "\nRequired keys: ";
    prompt += keys_json;
    prompt += "\nAnalysis A JSON: ";
    prompt += analysis_a_json;
    prompt += "\nAnalysis B JSON: ";
    prompt += analysis_b_json;
    prompt += "\nChoose analysis_a or analysis_b only when that side's mapping, overflow, and visual_correspondence ";
    prompt += "are supported by the images. Choose null when neither side can be verified. ";
    prompt += "Do not invent a third course, teacher, or review body. Do not use OCR.";
    prompt
}

let evidence_dir = if args == () { () } else { args.evidence_dir };
let out_dir = if args == () { () } else { args.out_dir };
let context_path = if args == () { () } else { args.context_path };
let manifest_path = if args == () { () } else { args.manifest_path };
let ocr_dir = if args == () { () } else { args.ocr_dir };
let worksheet = if args == () { () } else { args.worksheet };
let first_row = if args == () { () } else { args.first_row };
let last_row = if args == () { () } else { args.last_row };
let max_batches = if args == () { () } else { args.max_batches };
let inventory_path = if args == () { () } else { args.inventory_path };
if !has_text(out_dir) {
    pause("verification", "Pass args.out_dir — a gitignored directory for inventory, attempts, and the unapproved review package.");
}
if !has_text(inventory_path) && !has_text(evidence_dir) {
    pause("verification", "Pass args.evidence_dir or args.inventory_path. Capture and locator stay outside this workflow.");
}
if !has_text(inventory_path) && !has_text(context_path) {
    pause("verification", "Pass args.context_path — the frozen row context index JSON.");
}

let last_fingerprint = "";
let wave = 0;
let last_inventory = ();
let last_package = ();

while wave < 64 {
    let cap = budget();
    let remaining = if cap == () || cap.remaining == () { 128 } else { cap.remaining };
    if remaining < 1 {
        complete(#{
            summary: "Agent budget is exhausted. Rerun the same out_dir with a higher agent_budget.",
            status: "budget_exhausted",
            review_package: last_package,
            inventory: last_inventory,
            out_dir: out_dir,
        });
    }
    let this_wave = wave_size(max_batches);
    phase("Inventory");
    let inventory_prompt = "Build or refresh the deterministic review-package inventory. ";
    inventory_prompt += "Do not screenshot, click grid cells, or write Tencent Docs / the business database. ";
    inventory_prompt += "Do not invent matrix keys. Run this exact command from the repository root and return its stdout JSON unchanged:\n";
    inventory_prompt += inventory_command(out_dir, evidence_dir, context_path, manifest_path, ocr_dir, worksheet, first_row, last_row, this_wave);
    if has_text(inventory_path) {
        inventory_prompt = "Read ";
        inventory_prompt += inventory_path;
        inventory_prompt += " with read_file and return that object. Do not invent batches or keys.";
    }
    let inventory_result = agent(inventory_prompt, #{
        label: "inventory",
        capability_mode: "execute",
        output_schema: inventory_schema,
    });
    if !usable(inventory_result) {
        complete(#{
            summary: "Inventory host returned no usable output.",
            status: "blocked",
            out_dir: out_dir,
        });
    }
    last_inventory = inventory_result.output;
    let inv_status = last_inventory.status;
    if inv_status == "blocked" {
        complete(#{
            summary: "Inventory is blocked.",
            status: "blocked",
            reason: last_inventory.reason,
            inventory_path: last_inventory.inventory_path,
            out_dir: out_dir,
        });
    }

    if inv_status == "needs_ocr" {
        phase("OCR");
        let ocr_cmd = last_inventory.ocr_command;
        if !has_text(ocr_cmd) {
            complete(#{
                summary: "Inventory needs CUDA RapidOCR but did not emit ocr_command.",
                status: "needs_ocr",
                out_dir: out_dir,
            });
        }
        let ocr_prompt = "Run this exact local GPU RapidOCR command. Do not fall back to CPU. ";
        ocr_prompt += "If CUDAExecutionProvider is missing on det/cls/rec, stop and report failure. ";
        ocr_prompt += "Do not approve records. Command:\n";
        ocr_prompt += ocr_cmd;
        let ocr_result = agent(ocr_prompt, #{ label: "ocr", capability_mode: "execute" });
        if ocr_result == () || ocr_result.success != true {
            complete(#{
                summary: "CUDA RapidOCR failed. Fix GPU providers and rerun; do not fall back to CPU.",
                status: "needs_ocr",
                out_dir: out_dir,
            });
        }
        wave += 1;
        continue;
    }

    let pending = last_inventory.pending_batches;
    let pending_cells = last_inventory.pending_cells;
    let pending_verify = last_inventory.pending_verify;
    let pending_verify_cells = last_inventory.pending_verify_cells;
    if pending == () || type_of(pending) != "array" || pending.len() == 0 {
        if pending_verify != () && type_of(pending_verify) == "array" && pending_verify.len() > 0 {
            last_package = verify_and_apply(out_dir, pending_verify, last_inventory, last_package, wave, approval_schema, compile_schema);
            wave += 1;
            continue;
        }
        if (pending_cells != () && pending_cells > 0) || (pending_verify_cells != () && pending_verify_cells > 0) {
            complete(#{
                summary: "Pending cells remain but this wave could not emit batches. Rerun the same out_dir with a higher agent_budget.",
                status: "budget_exhausted",
                reason: last_inventory.reason,
                review_package: last_package,
                out_dir: out_dir,
            });
        }
        phase("Compile");
        complete(#{
            summary: if last_package == () { "No pending review batches." } else { "Frozen-scope review package finished unattended." },
            status: if last_package != () { "completed" } else if inv_status == () { "empty" } else { inv_status },
            reason: last_inventory.reason,
            inventory_path: last_inventory.inventory_path,
            review_package: last_package,
            out_dir: out_dir,
        });
    }

    let key_blob = "";
    for batch in pending {
        if batch != () && batch.keys != () { key_blob += json_encode(batch.keys); }
    }
    let current_fp = fingerprint(key_blob);
    if current_fp == last_fingerprint {
        complete(#{
            summary: "Inventory emitted the same pending keys twice. Inspect attempts.json before rerunning.",
            status: "no_progress",
            review_package: last_package,
            out_dir: out_dir,
        });
    }
    last_fingerprint = current_fp;
    log("Wave " + (wave + 1).to_string() + ": " + pending.len().to_string() + " pending batches, budget remaining " + budget().remaining.to_string());

    phase("Analyze");
    let jobs = [];
    for batch in pending {
        if batch == () || !has_text(batch.task_id) { continue; }
        let keys_json = json_encode(batch.keys);
        jobs.push(#{
            prompt: analysis_prompt("analysis_a", batch.payload_a, keys_json),
            label: "a:" + batch.task_id,
            capability_mode: "read-only",
            output_schema: analysis_schema,
        });
        jobs.push(#{
            prompt: analysis_prompt("analysis_b", batch.payload_b, keys_json),
            label: "b:" + batch.task_id,
            capability_mode: "read-only",
            output_schema: analysis_schema,
        });
    }
    if jobs.len() == 0 {
        complete(#{ summary: "Pending batches were missing task_id.", status: "blocked", out_dir: out_dir });
    }
    let analyzed = parallel(jobs);

    let analyses_a = #{};
    let analyses_b = #{};
    let arb_jobs = [];
    let arb_ids = [];
    let slot = 0;
    for batch in pending {
        if batch == () || !has_text(batch.task_id) { continue; }
        let side_a = analyzed[slot];
        let side_b = analyzed[slot + 1];
        slot += 2;
        if usable(side_a) { analyses_a[batch.task_id] = side_a.output; }
        if usable(side_b) { analyses_b[batch.task_id] = side_b.output; }
        if usable(side_a) && usable(side_b) {
            arb_ids.push(batch.task_id);
            arb_jobs.push(#{
                prompt: arbitration_prompt(batch.payload_a, batch.payload_b, json_encode(batch.keys), json_encode(side_a.output), json_encode(side_b.output)),
                label: "arb:" + batch.task_id,
                capability_mode: "read-only",
                output_schema: verdict_schema,
            });
        }
    }

    let analyses_arb = #{};
    if arb_jobs.len() > 0 {
        phase("Arbitrate");
        let verdicts = parallel(arb_jobs);
        let arb_index = 0;
        for task_id in arb_ids {
            let verdict = verdicts[arb_index];
            arb_index += 1;
            if usable(verdict) { analyses_arb[task_id] = verdict.output; }
        }
    }

    phase("Compile");
    let compile_body = #{
        analysis_a: analyses_a,
        analysis_b: analyses_b,
        arbitration: analyses_arb,
    };
    let compile_path = out_dir + "/wave-" + (wave + 1).to_string() + "-analyses.json";
    let compile_prompt = "Write this JSON exactly to ";
    compile_prompt += compile_path;
    compile_prompt += " and then run this command from the repository root. Do not write Tencent Docs or the business database. ";
    compile_prompt += "Do not write Tencent Docs, the business database, or Git.\n";
    compile_prompt += "pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts compile --inventory ";
    compile_prompt += trimmed(last_inventory.inventory_path);
    compile_prompt += " --analyses ";
    compile_prompt += compile_path;
    compile_prompt += " --out ";
    compile_prompt += out_dir;
    compile_prompt += "\nJSON:\n";
    compile_prompt += json_encode(compile_body);
    let compiled = agent(compile_prompt, #{
        label: "compile",
        capability_mode: "execute",
        output_schema: compile_schema,
    });
    if usable(compiled) { last_package = compiled.output; }
    wave += 1;
}

if last_package != () {
    complete(#{
        summary: "Stopped after 64 waves. Rerun the same out_dir to continue.",
        status: "wave_cap",
        review_package: last_package,
        out_dir: out_dir,
    });
}
complete(#{
    summary: "Stopped after 64 waves without a compiled package.",
    status: "wave_cap",
    inventory: last_inventory,
    out_dir: out_dir,
});
