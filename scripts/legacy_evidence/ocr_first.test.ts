import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCellReviewWorkflow, type CellReviewRunnerRequest } from "./ocr_first";

describe("OCR-first cell review workflow", () => {
  it("builds a complete matrix with column-letter keys when display headers repeat", async () => {
    const root = resolve(tmpdir(), `jufexk-ocr-first-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(root, { recursive: true });
    const inputPath = join(root, "input.json");
    const outDir = join(root, "out");
    await writeFile(inputPath, JSON.stringify({
      worksheet: "体育课",
      rows: [6, 7],
      review_columns: [
        { column: "F", display_header: "学生评价7" },
        { column: "G", display_header: "学生评价7" },
      ],
      context_index: [
        { row: 6, course: "体育", teacher: "甲" },
        { row: 7, course: "体育", teacher: "乙" },
      ],
      ocr_cells: [],
    }, null, 2));

    try {
      const result = await runCellReviewWorkflow({ inputPath, outDir });
      expect(result).toMatchObject({ status: "completed", expected_cells: 4, routed_cells: 0 });
      const matrix = JSON.parse(await readFile(join(outDir, "matrix.json"), "utf8"));
      expect(matrix.cells.map((cell: { key: string }) => cell.key)).toEqual([
        "体育课|6|F", "体育课|6|G", "体育课|7|F", "体育课|7|G",
      ]);
      expect(matrix.cells.map((cell: { display_header: string }) => cell.display_header)).toEqual([
        "学生评价7", "学生评价7", "学生评价7", "学生评价7",
      ]);
      expect(new Set(matrix.cells.map((cell: { key: string }) => cell.key)).size).toBe(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("isolates a failed cell through retry, bisection, and ordered model fallback", async () => {
    const root = resolve(tmpdir(), `jufexk-ocr-first-retry-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(root, { recursive: true });
    const inputPath = join(root, "input.json");
    const outDir = join(root, "out");
    const columns = ["F", "G", "H", "I", "J", "K", "L", "M"];
    await writeFile(inputPath, JSON.stringify({
      worksheet: "体育课",
      rows: [6, 6],
      review_columns: columns.map((column) => ({ column, display_header: "学生评价7" })),
      context_index: [{ row: 6, course: "体育", teacher: "甲" }],
      ocr_cells: columns.map((column) => ({ row: 6, column, text: `原文${column}`, confidence: 0.99, tokens: [{ text: `原文${column}` }], crop: `C:/isolated/${column}.png` })),
    }, null, 2));
    const calls: CellReviewRunnerRequest[] = [];

    try {
      const result = await runCellReviewWorkflow({
        inputPath,
        outDir,
        runner: async (request) => {
          calls.push(structuredClone(request));
          if (request.cells.some((cell) => cell.key === "体育课|6|M") && request.model !== "gpt-5.4") throw new Error(`deliberate ${request.model} failure`);
          return {
            cells: request.cells.map((cell) => ({
              key: cell.key,
              raw_transcription: `原文${cell.source_column}`,
              corrected_text: `原文${cell.source_column}`,
              edits: [],
              uncertainty_markers: [],
            })),
          };
        },
      });

      expect(result).toMatchObject({ status: "completed", expected_cells: 8, routed_cells: 8, unresolved_cells: 0 });
      expect(Math.max(...calls.map((call) => call.cells.length))).toBe(8);
      expect(calls.filter((call) => call.side === "analysis_a").every((call) => call.cells.every((cell) => !("ocr" in cell)))).toBe(true);
      expect(calls.filter((call) => call.side === "analysis_b").every((call) => call.cells.every((cell) => "ocr" in cell))).toBe(true);
      expect(calls.every((call) => call.cells.every((cell) => cell.image.endsWith(`${cell.source_column}.png`)))).toBe(true);
      const singleBadAttempts = calls.filter((call) => call.cells.length === 1 && call.cells[0].key === "体育课|6|M" && call.side === "analysis_a");
      expect(singleBadAttempts.map((call) => call.model)).toEqual(["gpt-5.6-luna", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4"]);
      const matrix = JSON.parse(await readFile(join(outDir, "matrix.json"), "utf8"));
      expect(matrix.cells).toHaveLength(8);
      expect(matrix.cells.every((cell: { conclusion: string }) => cell.conclusion === "agreed")).toBe(true);
      const attempts = JSON.parse(await readFile(join(outDir, "attempts.json"), "utf8"));
      expect(attempts.some((attempt: { error?: string }) => attempt.error?.includes("deliberate gpt-5.5 failure"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes completed cell sides without calling the model again", async () => {
    const root = resolve(tmpdir(), `jufexk-ocr-first-resume-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(root, { recursive: true });
    const inputPath = join(root, "input.json");
    const outDir = join(root, "out");
    await writeFile(inputPath, JSON.stringify({
      worksheet: "数学课",
      rows: [8, 8],
      review_columns: [{ column: "F", display_header: "学生评价1" }],
      context_index: [{ row: 8, course: "高等数学", teacher: "甲" }],
      ocr_cells: [{ row: 8, column: "F", text: "讲得很好", confidence: 0.99 }],
    }, null, 2));
    let calls = 0;
    const successfulRunner = async (request: CellReviewRunnerRequest) => {
      calls += 1;
      return { cells: request.cells.map((cell) => ({ key: cell.key, raw_transcription: "讲得很好", corrected_text: "讲得很好", edits: [], uncertainty_markers: [] })) };
    };

    try {
      await runCellReviewWorkflow({ inputPath, outDir, runner: successfulRunner });
      expect(calls).toBe(2);
      const resumed = await runCellReviewWorkflow({
        inputPath,
        outDir,
        runner: async () => { throw new Error("runner must not be called for cached sides"); },
      });
      expect(resumed).toMatchObject({ status: "completed", unresolved_cells: 0 });
      expect(calls).toBe(2);
      const attempts = JSON.parse(await readFile(join(outDir, "attempts.json"), "utf8"));
      expect(attempts).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers completed sides from atomic attempt checkpoints", async () => {
    const root = resolve(tmpdir(), `jufexk-ocr-first-attempt-resume-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const inputPath = join(root, "input.json");
    const outDir = join(root, "out");
    await mkdir(outDir, { recursive: true });
    const input = {
      worksheet: "数学课", rows: [8, 8], review_columns: [{ column: "F", display_header: "学生评价1" }],
      context_index: [{ row: 8, course: "高等数学", teacher: "甲" }],
      ocr_cells: [{ row: 8, column: "F", text: "讲得很好", crop: "C:/isolated/F.png" }],
    };
    const rawInput = JSON.stringify(input);
    await writeFile(inputPath, rawInput);
    const key = "数学课|8|F";
    const responseCell = { key, raw_transcription: "讲得很好", corrected_text: "讲得很好", edits: [], uncertainty_markers: [] };
    await writeFile(join(outDir, "matrix.json"), JSON.stringify({
      contract_version: "ocr-first-cell-review-v2",
      input_sha256: createHash("sha256").update(rawInput).digest("hex"),
      cells: [{ key, status: "pending_review" }],
    }));
    await writeFile(join(outDir, "attempts.json"), JSON.stringify([
      { side: "analysis_a", status: "completed", raw_response: { cells: [responseCell] } },
      { side: "analysis_b", status: "completed", raw_response: { cells: [responseCell] } },
    ]));

    try {
      const result = await runCellReviewWorkflow({
        inputPath, outDir,
        runner: async () => { throw new Error("checkpointed side must not run again"); },
      });
      expect(result).toMatchObject({ status: "completed", routed_cells: 1, unresolved_cells: 0 });
      const attempts = JSON.parse(await readFile(join(outDir, "attempts.json"), "utf8"));
      expect(attempts).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("arbitrates disagreements without allowing a third transcription", async () => {
    const root = resolve(tmpdir(), `jufexk-ocr-first-arbitration-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(root, { recursive: true });
    const inputPath = join(root, "input.json");
    const outDir = join(root, "out");
    await writeFile(inputPath, JSON.stringify({
      worksheet: "数学课",
      rows: [8, 8],
      review_columns: [{ column: "F", display_header: "学生评价1" }],
      context_index: [{ row: 8, course: "高等数学", teacher: "甲" }],
      ocr_cells: [{ row: 8, column: "F", text: "讲得很好", crop: "C:/isolated/F.png" }],
    }, null, 2));
    const arbitrationCalls: unknown[] = [];

    try {
      const result = await runCellReviewWorkflow({
        inputPath,
        outDir,
        runner: async (request) => ({ cells: request.cells.map((cell) => ({
          key: cell.key,
          raw_transcription: request.side === "analysis_a" ? "讲得\n很好" : "讲得很好",
          corrected_text: request.side === "analysis_a" ? "讲得\n很好" : "讲得很好",
          edits: [], uncertainty_markers: [],
        })) }),
        arbitrator: async (request) => {
          arbitrationCalls.push(structuredClone(request));
          return { cells: request.cells.map((cell) => ({ key: cell.key, selected: "analysis_a" as const, reason: "crop visibly contains the line break" })) };
        },
      });
      expect(result).toMatchObject({ status: "completed", unresolved_cells: 0 });
      expect(arbitrationCalls).toHaveLength(1);
      const matrix = JSON.parse(await readFile(join(outDir, "matrix.json"), "utf8"));
      expect(matrix.cells[0]).toMatchObject({ conclusion: "arbitrated", selected: "analysis_a" });
      expect(matrix.cells[0].arbitration).not.toHaveProperty("raw_transcription");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries a null arbitration in a new Luna attempt", async () => {
    const root = resolve(tmpdir(), `jufexk-ocr-first-null-arbitration-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(root, { recursive: true });
    const inputPath = join(root, "input.json");
    const outDir = join(root, "out");
    await writeFile(inputPath, JSON.stringify({
      worksheet: "英语课", rows: [8, 8],
      review_columns: [{ column: "I", display_header: "学生评价" }],
      context_index: [{ row: 8, course: "英语", teacher: "甲" }],
      ocr_cells: [{ row: 8, column: "I", text: "评价", crop: "C:/isolated/I.png" }],
    }));
    let arbitrationCalls = 0;
    try {
      const result = await runCellReviewWorkflow({
        inputPath, outDir,
        runner: async (request) => ({ cells: request.cells.map((cell) => ({
          key: cell.key, raw_transcription: request.side === "analysis_a" ? "候选甲" : "候选乙",
          corrected_text: request.side === "analysis_a" ? "候选甲" : "候选乙", edits: [], uncertainty_markers: [],
        })) }),
        arbitrator: async (request) => {
          arbitrationCalls += 1;
          return { cells: request.cells.map((cell) => ({ key: cell.key, selected: arbitrationCalls === 1 ? null : "analysis_b" as const, reason: "visual check" })) };
        },
      });
      expect(result).toMatchObject({ status: "completed", unresolved_cells: 0 });
      expect(arbitrationCalls).toBe(2);
      const attempts = JSON.parse(await readFile(join(outDir, "attempts.json"), "utf8"));
      expect(attempts.filter((attempt: { side: string }) => attempt.side === "arbitration").map((attempt: { status: string }) => attempt.status)).toEqual(["completed_with_exceptions", "completed"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps missing captures explicit and never routes them as blank or to a model", async () => {
    const root = resolve(tmpdir(), `jufexk-ocr-first-capture-gap-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(root, { recursive: true });
    const inputPath = join(root, "input.json");
    const outDir = join(root, "out");
    await writeFile(inputPath, JSON.stringify({
      worksheet: "主要课程",
      rows: [122, 122],
      review_columns: [
        { column: "F", display_header: "学生评价1" },
        { column: "G", display_header: "学生评价2" },
      ],
      context_index: [{ row: 122, course: "课程", teacher: "教师" }],
      ocr_cells: [{ row: 122, column: "F", text: "可见评价", crop: "C:/isolated/F.png" }],
      capture_gaps: [{
        key: "主要课程|122|G", row: 122, column: "G",
        reason: "missing_review_capture", recovery_condition: "capture in a new manifest",
        manifest_sha256: "manifest-hash",
      }],
    }));
    const routedKeys: string[] = [];

    try {
      const result = await runCellReviewWorkflow({
        inputPath, outDir,
        runner: async (request) => {
          routedKeys.push(...request.cells.map((cell) => cell.key));
          return { cells: request.cells.map((cell) => ({
            key: cell.key, raw_transcription: "可见评价", corrected_text: "可见评价", edits: [], uncertainty_markers: [],
          })) };
        },
      });
      expect(result).toMatchObject({ status: "capture_blocked", expected_cells: 2, routed_cells: 1, unresolved_cells: 1, capture_gap_cells: 1 });
      expect(new Set(routedKeys)).toEqual(new Set(["主要课程|122|F"]));
      const matrix = JSON.parse(await readFile(join(outDir, "matrix.json"), "utf8"));
      expect(matrix.cells.find((cell: { key: string }) => cell.key === "主要课程|122|G")).toMatchObject({
        status: "capture_gap", conclusion: "unresolved", unresolved_reason: "missing_review_capture",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
