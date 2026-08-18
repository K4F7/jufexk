let meta = #{
    name: "legacy-matrix-freeze",
    description: "Unattended freeze orchestration: scan sheet extents, call locator/capture CLI, run composition QA, then freeze a new manifest. Does not click the grid or treat screenshots as review body.",
    when_to_use: "A read-only Tencent session already shows 只能查看 and you need to freeze a worksheet range. Do not use this to log in, click cells, or recapture the #180 pack.",
    phases: [
        #{ title: "Scan", detail: "determine last used row from the frozen sheet extents" },
        #{ title: "Locate", detail: "execute locator CLI per worksheet range" },
        #{ title: "QA", detail: "run freeze-time composition QA" },
        #{ title: "Freeze", detail: "write a new SHA-256 manifest" },
    ],
};

let scan_schema = #{
    "type": "object",
    "properties": #{
        "status": #{ "type": "string" },
        "output": #{ "type": "string" },
        "planned_cells": #{ "type": "number" },
        "planned_rows": #{ "type": "number" },
        "extent_sha256": #{ "type": "string" },
        "sheets": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "properties": #{
                    "worksheet": #{ "type": "string" },
                    "first_row": #{ "type": "number" },
                    "last_row": #{ "type": "number" },
                },
            },
        },
    },
};
let locate_schema = #{
    "type": "object",
    "properties": #{
        "status": #{ "type": "string" },
        "output": #{ "type": "string" },
        "worksheet": #{ "type": "string" },
        "first_row": #{ "type": "number" },
        "last_row": #{ "type": "number" },
        "planned_cells": #{ "type": "number" },
        "reused_cells": #{ "type": "number" },
        "stop_key": #{ "type": ["string", "null"] },
        "stop_reason": #{ "type": ["string", "null"] },
        "missing_keys": #{ "type": "array", "items": #{ "type": "string" } },
    },
};
let qa_schema = #{
    "type": "object",
    "properties": #{
        "status": #{ "type": "string" },
        "output": #{ "type": "string" },
        "qa_sha256": #{ "type": "string" },
        "issues": #{ "type": "array", "items": #{ "type": "string" } },
        "recapture_keys": #{ "type": "array", "items": #{ "type": "string" } },
    },
};
let freeze_schema = #{
    "type": "object",
    "properties": #{
        "status": #{ "type": "string" },
        "output": #{ "type": "string" },
        "planned_cells": #{ "type": "number" },
        "manifest_sha256": #{ "type": "string" },
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

fn cli_rules() {
    let text = "Run this exact command from the repository root and return its stdout JSON unchanged. ";
    text += "Do not screenshot. Do not click grid cells. Do not treat screenshots as review body. ";
    text += "Do not log in or write Tencent Docs, the business database, or Git. ";
    text += "Do not invent matrix keys. Do not overwrite #180 or formula-bar-full packs.\n";
    text
}

fn default_sheets() {
    ["主要课程", "数学课", "美育", "大英和视听说", "思政课", "MOOC", "体育课"]
}

fn sheet_list(worksheets, worksheet) {
    if worksheets != () && type_of(worksheets) == "array" && worksheets.len() > 0 {
        return worksheets;
    }
    if has_text(worksheet) {
        return [worksheet];
    }
    default_sheets()
}

fn scan_command(out_dir, sheets, first_row, last_row) {
    let command = "pnpm exec tsx scripts/legacy_evidence/matrix_freeze_cli.ts scan-extent --out ";
    command += out_dir;
    for sheet in sheets {
        if has_text(sheet) {
            command += " --worksheet ";
            command += sheet;
        }
    }
    if first_row != () { command += " --first-row "; command += first_row.to_string(); }
    if last_row != () { command += " --last-row "; command += last_row.to_string(); }
    command
}

fn locate_command(out_dir, worksheet, evidence_dir) {
    let command = "pnpm exec tsx scripts/legacy_evidence/matrix_freeze_cli.ts locate --out ";
    command += out_dir;
    command += " --worksheet ";
    command += worksheet;
    if has_text(evidence_dir) {
        command += " --evidence-dir ";
        command += evidence_dir;
    }
    command
}

fn qa_command(out_dir, evidence_dir) {
    let command = "pnpm exec tsx scripts/legacy_evidence/matrix_freeze_cli.ts qa --out ";
    command += out_dir;
    if has_text(evidence_dir) {
        command += " --evidence-dir ";
        command += evidence_dir;
    }
    command
}

fn freeze_command(out_dir, evidence_dir) {
    let command = "pnpm exec tsx scripts/legacy_evidence/matrix_freeze_cli.ts freeze-manifest --out ";
    command += out_dir;
    if has_text(evidence_dir) {
        command += " --evidence-dir ";
        command += evidence_dir;
    }
    command
}

let out_dir = if args == () { () } else { args.out_dir };
let view_only_ready = if args == () { () } else { args.view_only_ready };
let evidence_dir = if args == () { () } else { args.evidence_dir };
let first_row = if args == () { () } else { args.first_row };
let last_row = if args == () { () } else { args.last_row };
let run_review_package = if args == () { () } else { args.run_review_package };

if !has_text(out_dir) {
    pause("verification", "Pass args.out_dir — a new gitignored directory under scripts/legacy_evidence/output. Do not overwrite #180.");
}
if view_only_ready != true {
    pause("verification", "Declare args.view_only_ready=true after the Tencent sheet shows 只能查看. This workflow will not log in.");
}

let requested_worksheets = if args == () { () } else { args.worksheets };
let requested_worksheet = if args == () { () } else { args.worksheet };
let sheets = sheet_list(requested_worksheets, requested_worksheet);
phase("Scan");
let scan_prompt = cli_rules();
scan_prompt += scan_command(out_dir, sheets, first_row, last_row);
let scan_result = agent(scan_prompt, #{
    label: "scan-extent",
    capability_mode: "execute",
    output_schema: scan_schema,
});
if !usable(scan_result) {
    complete(#{
        summary: "Extent scan returned no usable output. Inspect the CLI and rerun the same out_dir.",
        status: "blocked",
        out_dir: out_dir,
    });
}

let locate_sheets = sheets;
if scan_result.output.sheets != () && type_of(scan_result.output.sheets) == "array" && scan_result.output.sheets.len() > 0 {
    locate_sheets = [];
    for item in scan_result.output.sheets {
        if item != () && has_text(item.worksheet) { locate_sheets.push(item.worksheet); }
    }
}

phase("Locate");
let locates = [];
let recapture = false;
for worksheet in locate_sheets {
    if !has_text(worksheet) { continue; }
    let locate_prompt = cli_rules();
    locate_prompt += locate_command(out_dir, worksheet, evidence_dir);
    let locate_result = agent(locate_prompt, #{
        label: "locate:" + worksheet,
        capability_mode: "execute",
        output_schema: locate_schema,
    });
    if usable(locate_result) {
        locates.push(locate_result.output);
        if locate_result.output.status == "recapture_required" { recapture = true; }
    } else {
        recapture = true;
        locates.push(#{ worksheet: worksheet, status: "blocked" });
    }
}

phase("QA");
let qa_prompt = cli_rules();
qa_prompt += qa_command(out_dir, evidence_dir);
let qa_result = agent(qa_prompt, #{
    label: "qa",
    capability_mode: "execute",
    output_schema: qa_schema,
});
let qa_status = if usable(qa_result) { qa_result.output.status } else { "blocked" };
if recapture || qa_status == "recapture_required" || qa_status == "blocked" {
    complete(#{
        summary: "Composition QA or locator left recapture_required. Keep this out_dir as the checkpoint; do not freeze.",
        status: "recapture_required",
        out_dir: out_dir,
        extent: scan_result.output,
        locates: locates,
        qa: if usable(qa_result) { qa_result.output } else { () },
    });
}

phase("Freeze");
let freeze_prompt = cli_rules();
freeze_prompt += freeze_command(out_dir, evidence_dir);
let freeze_result = agent(freeze_prompt, #{
    label: "freeze",
    capability_mode: "execute",
    output_schema: freeze_schema,
});
if !usable(freeze_result) {
    complete(#{
        summary: "Freeze CLI returned no usable output. Rerun the same out_dir; do not pretend the journal can resume after process death.",
        status: "blocked",
        out_dir: out_dir,
        qa: qa_result.output,
    });
}

let review_hint = ();
if run_review_package == true {
    review_hint = "Start /legacy-review-package against this new frozen out_dir. Do not screenshot or click the grid.";
}
complete(#{
    summary: "New matrix freeze manifest written. Locator and capture stayed in the CLI.",
    status: "completed",
    out_dir: out_dir,
    extent: scan_result.output,
    locates: locates,
    qa: qa_result.output,
    manifest: freeze_result.output,
    review_package_hint: review_hint,
});
