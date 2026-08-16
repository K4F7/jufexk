import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildFormatRepairPrompt, normalizeRecognitionEnvelope, runRecognitionTrial, stageRecognitionImages, validateRecognitionEnvelopeSchema, type RecognitionRunnerRequest } from "./recognition";

async function fixture() {
  const root = resolve(tmpdir(), `jufexk-recognition-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const input = join(root, "input");
  await mkdir(input, { recursive: true });
  const groups = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"].map((sheet, index) => ({
    sheet, rows: [8, 9] as [number, number], context_columns: "A:E", review_columns: "F:G",
    course_anchor: index === 0 ? "课程甲" : undefined,
  }));
  const files: string[] = [];
  const hashes: Record<string, string> = {};
  for (const group of groups) {
    for (const name of [`${group.sheet}_columns.png`, `${group.sheet}_rows008-009_context.png`, `${group.sheet}_rows008-009_reviews01.png`, `${group.sheet}_rows008-009_reviews02.png`, `${group.sheet}_rows008-009_reviews03.png`, `${group.sheet}_rows008-009_reviews04.png`]) {
      const relative = `${group.sheet}/${name}`;
      await mkdir(join(input, group.sheet), { recursive: true });
      await writeFile(join(input, relative), relative);
      files.push(relative);
      hashes[relative] = await sha256(join(input, relative));
    }
  }
  const manifestPath = join(input, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ batch: "test", status: "complete_with_validation_limitations", validation_limitations: ["columns require visual confirmation"], groups, files, hashes }, null, 2));
  return { root, manifestPath };
}

describe("read-only recognition trial", () => {
  it("stages recognition images inside the isolated runtime without changing bytes", async () => {
    const root = resolve(tmpdir(), `jufexk-recognition-stage-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const sourceDir = join(root, "source");
    const workDir = join(root, "runtime", "work");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "same.png"), "first");
    await mkdir(join(sourceDir, "nested"), { recursive: true });
    await writeFile(join(sourceDir, "nested", "same.png"), "second");
    try {
      const staged = await stageRecognitionImages([join(sourceDir, "same.png"), join(sourceDir, "nested", "same.png")], workDir);
      expect(staged).toEqual([join(workDir, "images", "01-same.png"), join(workDir, "images", "02-same.png")]);
      expect(await readFile(staged[0], "utf8")).toBe("first");
      expect(await readFile(staged[1], "utf8")).toBe("second");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("schema-validates every accepted envelope before semantic validation", () => {
    const request = { group: { sheet: "甲", rows: [8, 9], context_columns: "A:E", review_columns: "F:G" }, imageFiles: ["columns", "context", "reviews"], structuralData: {}, prompt: "", groupDir: "" } as RecognitionRunnerRequest;
    const envelope = accepted(request);
    expect(validateRecognitionEnvelopeSchema(envelope)).toEqual([]);
    const missingSelected = accepted(request);
    delete missingSelected.arbitration.cells[0].selected;
    expect(validateRecognitionEnvelopeSchema(missingSelected)).toContain("schema: invalid arbitration.cells item");
    delete envelope.arbitration.cells;
    envelope.analysis_a.context_index[0].row = "8";
    delete envelope.analysis_b.cells[0].edits;
    expect(validateRecognitionEnvelopeSchema(envelope).join(" ")).toMatch(/invalid arbitration|context_index item|cells item/);
  });

  it("rejects manifest paths outside the immutable batch", async () => {
    const { root, manifestPath } = await fixture();
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const original = manifest.files[0];
      manifest.files[0] = `../${original}`;
      manifest.hashes[`../${original}`] = manifest.hashes[original];
      delete manifest.hashes[original];
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(runRecognitionTrial({ manifestPath, outDir: join(root, "out"), runner: async (request) => accepted(request) })).rejects.toThrow(/path must stay inside the batch|expected 6 recognition files/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("limits repair instructions to same-session formatting", () => {
    const prompt = buildFormatRepairPrompt(["schema: missing arbitration"]);
    expect(prompt).toContain("formatting only");
    expect(prompt).toContain("Do not inspect images again");
    expect(prompt).toContain("schema: missing arbitration");
    expect(prompt).not.toContain("guess");
  });

  it("normalizes format-only aliases without changing raw transcription", () => {
    const raw = {
      capture_qa: { observed_rows: [19, 20, 21, 22, 23, 24, 25, 26] },
      subagents: [{ id: "a", status: "completed" }, { id: "b", status: "completed" }],
      analysis_a: { context_index: [{ context_row: 19, course: "统计学", teacher: "甲" }], cells: [{ key: "主要课程|19|学生评价1", status: "review", context_row: 19, raw_transcription: "原文！" }] },
      analysis_b: { context_index: [], cells: [] }, arbitration: [],
    };
    const normalized = normalizeRecognitionEnvelope({ sheet: "主要课程", rows: [19, 26], context_columns: "A:E", review_columns: "F:M", course_anchor: "统计学" }, raw);
    expect(normalized.capture_qa.observed_rows).toEqual([19, 26]);
    expect(normalized.subagents.analysis_a).toMatchObject({ task_id: "a", status: "completed" });
    expect(normalized.analysis_a.context_index[0]).toMatchObject({ row: 19, anchor: "统计学" });
    expect(normalized.analysis_a.cells[0]).toMatchObject({ row: 19, review_column: "学生评价1", raw_transcription: "原文！", corrected_text: "原文！", edits: [] });
    expect(normalized.arbitration).toEqual({ cells: [] });
  });

  it("accepts a null context anchor when the group has no declared course anchor", () => {
    const request = { group: { sheet: "甲", rows: [8, 9], context_columns: "A:E", review_columns: "F:G" }, imageFiles: ["columns", "context", "reviews"] } as RecognitionRunnerRequest;
    const source = accepted(request);
    source.analysis_a.context_index[0].anchor = null;
    source.analysis_b.context_index[0].anchor = null;
    expect(validateRecognitionEnvelopeSchema(source)).not.toContain("schema: invalid analysis_a.context_index item");
    expect(validateRecognitionEnvelopeSchema(source)).not.toContain("schema: invalid analysis_b.context_index item");
  });

  it("maps a string-only observed column list onto the manifest column letters", () => {
    const source = accepted({ group: { sheet: "甲", rows: [8, 9], context_columns: "A:E", review_columns: "F:G" }, imageFiles: ["columns", "context", "reviews"] } as RecognitionRunnerRequest);
    source.capture_qa.observed_review_columns = ["学生评价01", "学生评价02"];
    const normalized = normalizeRecognitionEnvelope({ sheet: "甲", rows: [8, 9], context_columns: "A:E", review_columns: "F:G" }, source);
    expect(normalized.capture_qa.observed_review_columns).toEqual([
      { column: "F", name: "学生评价01" },
      { column: "G", name: "学生评价02" },
    ]);
  });

  it("maps the review_column_names QA alias onto manifest column letters", () => {
    const source = accepted({ group: { sheet: "甲", rows: [8, 9], context_columns: "A:E", review_columns: "F:G" }, imageFiles: ["columns", "context", "reviews"] } as RecognitionRunnerRequest);
    delete source.capture_qa.observed_review_columns;
    source.capture_qa.review_column_names = ["学生评价01", "学生评价02"];
    const normalized = normalizeRecognitionEnvelope({ sheet: "甲", rows: [8, 9], context_columns: "A:E", review_columns: "F:G" }, source);
    expect(normalized.capture_qa.observed_review_columns).toEqual([
      { column: "F", name: "学生评价01" },
      { column: "G", name: "学生评价02" },
    ]);
  });

  it("maps column-letter cell keys to Capture QA review names without changing transcription", () => {
    const request = { group: { sheet: "甲", rows: [8, 9], context_columns: "A:E", review_columns: "F:G" }, imageFiles: ["columns", "context", "reviews"] } as RecognitionRunnerRequest;
    const source = accepted(request);
    source.analysis_a.cells[0].key = "甲|8|F";
    source.analysis_a.cells[0].review_column = "F";
    source.analysis_a.cells[0].raw_transcription = "原文不变";
    source.arbitration.cells[0].key = "甲|8|F";
    const normalized = normalizeRecognitionEnvelope(request.group, source);
    expect(normalized.analysis_a.cells[0]).toMatchObject({ key: "甲|8|评价1", review_column: "评价1", raw_transcription: "原文不变" });
    expect(normalized.arbitration.cells[0].key).toBe("甲|8|评价1");
  });

  it("blocks recognition when Capture QA rejects a group and preserves the QA artifact", async () => {
    const { root, manifestPath } = await fixture();
    try {
      const result = await runRecognitionTrial({ manifestPath, outDir: join(root, "out"), runner: async (request) => qaRejected(request) });
      expect(result.status).toBe(1);
      expect(result.groups[0]).toMatchObject({ status: "recapture_required" });
      const qa = JSON.parse(await readFile(join(root, "out", "groups", "甲", "capture_qa.json"), "utf8"));
      expect(qa.status).toBe("recapture_required");
      const status = JSON.parse(await readFile(join(root, "out", "groups", "甲", "status.json"), "utf8"));
      expect(status.status).toBe("recapture_required");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("accepts only a complete unique matrix with valid context references and strict agreement", async () => {
    const { root, manifestPath } = await fixture();
    try {
      const result = await runRecognitionTrial({ manifestPath, outDir: join(root, "out"), runner: async (request) => accepted(request) });
      expect(result.status).toBe(0);
      expect(result.groups.every((group) => group.status === "completed_with_exceptions")).toBe(true);
      expect(result.groups[0].counts).toEqual({ blank: 2, review: 1, unreadable: 1, out_of_range: 0, unresolved: 2, agreed: 0 });
      const inventory = JSON.parse(await readFile(join(root, "out", "groups", "甲", "inventory.json"), "utf8"));
      expect(inventory.cells).toHaveLength(4);
      expect(new Set(inventory.cells.map((cell: { key: string }) => cell.key)).size).toBe(4);
      expect(inventory.cells.find((cell: { status: string }) => cell.status === "review").conclusion).toBe("unresolved");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("fails a group on missing or duplicate keys instead of silently completing", async () => {
    const { root, manifestPath } = await fixture();
    try {
      const result = await runRecognitionTrial({ manifestPath, outDir: join(root, "out"), runner: async (request) => {
        const envelope = accepted(request);
        envelope.analysis_b.cells.pop();
        envelope.analysis_a.cells.push(envelope.analysis_a.cells[0]);
        return envelope;
      }});
      expect(result.status).toBe(1);
      expect(result.groups[0].status).toBe("failed");
      expect(result.groups[0].errors.join(" ")).toMatch(/duplicate|missing/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects cells whose explicit row or review column disagrees with the stable key", async () => {
    const { root, manifestPath } = await fixture();
    try {
      const result = await runRecognitionTrial({ manifestPath, outDir: join(root, "out"), sheets: ["甲"], runner: async (request) => {
        const envelope = accepted(request);
        envelope.analysis_a.cells[0].row = 9;
        envelope.analysis_a.cells[0].context_row = 9;
        envelope.analysis_b.cells[1].review_column = "伪造列";
        return envelope;
      }});
      expect(result.status).toBe(1);
      expect(result.groups[0].errors.join(" ")).toMatch(/key fields do not match/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects observed review-column letters outside the manifest range", async () => {
    const { root, manifestPath } = await fixture();
    try {
      const result = await runRecognitionTrial({ manifestPath, outDir: join(root, "out"), sheets: ["甲"], runner: async (request) => {
        const envelope = accepted(request);
        envelope.capture_qa.observed_review_columns[1].column = "H";
        return envelope;
      }});
      expect(result.status).toBe(1);
      expect(result.groups[0].errors.join(" ")).toMatch(/review columns do not match manifest range/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects wrong context rows and duplicate arbitration keys", async () => {
    const { root, manifestPath } = await fixture();
    try {
      const result = await runRecognitionTrial({ manifestPath, outDir: join(root, "out"), runner: async (request) => {
        const envelope = accepted(request);
        envelope.analysis_a.context_index = [
          { ...envelope.analysis_a.context_index[0], row: 7 },
          envelope.analysis_a.context_index[1],
        ];
        envelope.arbitration.cells.push(envelope.arbitration.cells[0]);
        return envelope;
      }});
      expect(result.status).toBe(1);
      expect(result.groups[0].errors.join(" ")).toMatch(/context index.*declared rows|arbitration duplicate key/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not agree when corrected text differs from immutable raw text", async () => {
    const { root, manifestPath } = await fixture();
    try {
      const result = await runRecognitionTrial({ manifestPath, outDir: join(root, "out"), runner: async (request) => {
        const envelope = accepted(request);
        for (const side of [envelope.analysis_a, envelope.analysis_b]) {
          const review = side.cells.find((cell: { status: string }) => cell.status === "review");
          review.edits = [];
          review.corrected_text = "讲得很好";
        }
        return envelope;
      }});
      expect(result.status).toBe(0);
      const inventory = JSON.parse(await readFile(join(root, "out", "groups", "甲", "inventory.json"), "utf8"));
      expect(inventory.cells.find((cell: { status: string }) => cell.status === "review").conclusion).toBe("unresolved");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("marks every cell in a row unresolved when row context conflicts", async () => {
    const { root, manifestPath } = await fixture();
    try {
      const result = await runRecognitionTrial({ manifestPath, outDir: join(root, "out"), runner: async (request) => {
        const envelope = accepted(request);
        envelope.analysis_b.context_index = structuredClone(envelope.analysis_b.context_index);
        envelope.analysis_b.context_index.find((item: { row: number }) => item.row === 9).teacher = "冲突教师";
        return envelope;
      }});
      expect(result.status).toBe(0);
      const inventory = JSON.parse(await readFile(join(root, "out", "groups", "甲", "inventory.json"), "utf8"));
      expect(inventory.cells.filter((cell: { row: number }) => cell.row === 9).every((cell: { conclusion: string }) => cell.conclusion === "unresolved")).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("never runs more than two worksheet groups concurrently", async () => {
    const { root, manifestPath } = await fixture();
    let active = 0;
    let peak = 0;
    try {
      const result = await runRecognitionTrial({ manifestPath, outDir: join(root, "out"), maxConcurrentGroups: 2, runner: async (request) => {
        active += 1; peak = Math.max(peak, active);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
        active -= 1;
        return accepted(request);
      }});
      expect(result.status).toBe(0);
      expect(peak).toBe(2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("can rerun only an explicitly selected worksheet group", async () => {
    const { root, manifestPath } = await fixture();
    const called: string[] = [];
    try {
      const result = await runRecognitionTrial({
        manifestPath,
        outDir: join(root, "out"),
        sheets: ["甲"],
        runner: async (request) => { called.push(request.group.sheet); return accepted(request); },
      });
      expect(result.status).toBe(0);
      expect(called).toEqual(["甲"]);
      expect(result.groups.map((group) => group.sheet)).toEqual(["甲"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

function qaRejected(request: RecognitionRunnerRequest): any {
  return { session_id: `qa-${request.group.sheet}`, capture_qa: { status: "recapture_required", worksheet: request.group.sheet, issues: ["row endpoint is cropped"], affected_files: request.imageFiles, observed_review_columns: [] } };
}

function accepted(request: RecognitionRunnerRequest): any {
  const columns = [{ column: "F", name: "评价1" }, { column: "G", name: "评价2" }];
  const context = [8, 9].map((row) => ({ row, course: `课程${request.group.sheet}`, teacher: `教师${row}`, course_evidence: request.imageFiles[1], teacher_evidence: request.imageFiles[1], anchor: row === 8 ? "visible" : "inherited" }));
  const cells = [8, 9].flatMap((row) => columns.map(({ name }, index) => ({
    key: `${request.group.sheet}|${row}|${name}`, row, review_column: name, context_row: row,
    status: row === 8 && index === 0 ? "review" : row === 9 && index === 1 ? "unreadable" : "blank",
    raw_transcription: row === 8 && index === 0 ? "讲的很好" : null,
    corrected_text: row === 8 && index === 0 ? "讲得很好" : null,
    edits: row === 8 && index === 0 ? [{ from: "的", to: "得", reason: "grammar" }] : [],
    uncertainty_markers: row === 9 && index === 1 ? ["[unclear]"] : [], evidence_files: request.imageFiles,
  })));
  return {
    session_id: `session-${request.group.sheet}`,
    capture_qa: { status: "accepted", worksheet: request.group.sheet, issues: [], affected_files: [], observed_rows: [8, 9], observed_review_columns: columns, course_anchor: { value: request.group.course_anchor ?? `课程${request.group.sheet}`, rows: [8, 9], evidence_file: request.imageFiles[1] } },
    subagents: { analysis_a: { task_id: "a", status: "completed" }, analysis_b: { task_id: "b", status: "completed" } },
    analysis_a: { context_index: context, cells }, analysis_b: { context_index: context, cells },
    arbitration: { cells: cells.map((cell) => ({ key: cell.key, conclusion: cell.status === "review" ? "agreed" : cell.status === "unreadable" ? "unresolved" : "not_applicable", selected: "analysis_a", reason: "same" })) },
  };
}

async function sha256(path: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
