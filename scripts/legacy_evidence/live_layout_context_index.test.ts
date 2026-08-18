import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileLiveLayout, type LiveLayoutSheetInput } from "./live_layout";
import {
  LIVE_LAYOUT_CONTEXT_INDEX_VERSION,
  LIVE_LAYOUT_CONTEXT_OUTPUT_RELATIVE,
  MISSING_CONTEXT,
  assertLiveLayoutContextOutputPath,
  compileLiveLayoutContextIndex,
  runLiveLayoutContextIndexCli,
  validateLiveLayoutContextIndex,
  writeLiveLayoutContextIndex,
  type LiveLayoutContextRead,
} from "./live_layout_context_index";
import { OTHER_SMOKE_MANIFEST_VERSION } from "./other_smoke";
import { SMOKE_MANIFEST_VERSION } from "./smoke_recapture";

type ReadKeys = keyof LiveLayoutContextRead;
type ForbiddenReadKeys = Extract<ReadKeys, "formula_bar_value" | "visible_course" | "visible_teacher" | "visible_cell_text" | "comment" | "body">;
const _noBodyFields: ForbiddenReadKeys extends never ? true : never = true;
void _noBodyFields;

describe("live-layout smoke context index", () => {
  it("indexes every #229 smoke row from the live layout without guessing teacher names", () => {
    const first = compileLiveLayoutContextIndex({ layout: confirmedLayout() });
    const second = compileLiveLayoutContextIndex({ layout: confirmedLayout() });

    expect(first.contract_version).toBe(LIVE_LAYOUT_CONTEXT_INDEX_VERSION);
    expect(first.layout_sha256).toBe(confirmedLayout().layout_sha256);
    expect(first.context_index_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.context_index_sha256).toBe(first.context_index_sha256);
    expect(first.wrote_tencent_or_business_db).toBe(false);
    expect(first.sheets.map((sheet) => [
      sheet.worksheet,
      sheet.course_column,
      sheet.teacher_column,
      sheet.rows.map((row) => [row.row, row.course_cell, row.teacher_cell, row.course_anchor_row]),
    ])).toEqual([
      ["主要课程", "A", "E", [[19, "A19", "E19", MISSING_CONTEXT], [20, "A20", "E20", MISSING_CONTEXT], [21, "A21", "E21", MISSING_CONTEXT], [22, "A22", "E22", MISSING_CONTEXT], [23, "A23", "E23", MISSING_CONTEXT], [24, "A24", "E24", MISSING_CONTEXT], [25, "A25", "E25", MISSING_CONTEXT], [26, "A26", "E26", MISSING_CONTEXT]]],
      ["数学课", "B", "C", [[8, "B8", "C8", MISSING_CONTEXT], [9, "B9", "C9", MISSING_CONTEXT], [10, "B10", "C10", MISSING_CONTEXT], [11, "B11", "C11", MISSING_CONTEXT], [12, "B12", "C12", MISSING_CONTEXT], [13, "B13", "C13", MISSING_CONTEXT], [14, "B14", "C14", MISSING_CONTEXT]]],
      ["美育", "A", "D", [[8, "A8", "D8", MISSING_CONTEXT], [9, "A9", "D9", MISSING_CONTEXT], [10, "A10", "D10", MISSING_CONTEXT], [11, "A11", "D11", MISSING_CONTEXT], [12, "A12", "D12", MISSING_CONTEXT], [13, "A13", "D13", MISSING_CONTEXT], [14, "A14", "D14", MISSING_CONTEXT]]],
      ["大英和视听说", "B", "E", [[8, "B8", "E8", MISSING_CONTEXT], [9, "B9", "E9", MISSING_CONTEXT], [10, "B10", "E10", MISSING_CONTEXT], [11, "B11", "E11", MISSING_CONTEXT], [12, "B12", "E12", MISSING_CONTEXT], [13, "B13", "E13", MISSING_CONTEXT], [14, "B14", "E14", MISSING_CONTEXT]]],
      ["思政课", "A", "F", [[8, "A8", "F8", MISSING_CONTEXT], [9, "A9", "F9", MISSING_CONTEXT], [10, "A10", "F10", MISSING_CONTEXT], [11, "A11", "F11", MISSING_CONTEXT], [12, "A12", "F12", MISSING_CONTEXT], [13, "A13", "F13", MISSING_CONTEXT], [14, "A14", "F14", MISSING_CONTEXT]]],
      ["外教", "A", "E", [[3, "A3", "E3", MISSING_CONTEXT], [4, "A4", "E4", MISSING_CONTEXT], [5, "A5", "E5", MISSING_CONTEXT], [6, "A6", "E6", MISSING_CONTEXT]]],
      ["MOOC", "B", "F", [[8, "B8", "F8", MISSING_CONTEXT], [9, "B9", "F9", MISSING_CONTEXT], [10, "B10", "F10", MISSING_CONTEXT], [11, "B11", "F11", MISSING_CONTEXT], [12, "B12", "F12", MISSING_CONTEXT], [13, "B13", "F13", MISSING_CONTEXT], [14, "B14", "F14", MISSING_CONTEXT]]],
      ["体育课", "A", "B", [[6, "A6", "B6", MISSING_CONTEXT], [7, "A7", "B7", MISSING_CONTEXT], [8, "A8", "B8", MISSING_CONTEXT], [9, "A9", "B9", MISSING_CONTEXT], [10, "A10", "B10", MISSING_CONTEXT], [11, "A11", "B11", MISSING_CONTEXT], [12, "A12", "B12", MISSING_CONTEXT], [13, "A13", "B13", MISSING_CONTEXT], [14, "A14", "B14", MISSING_CONTEXT]]],
    ]);
    expect(first.sheets.find((sheet) => sheet.worksheet === "外教")?.rows.every((row) => row.teacher_cell.startsWith("E"))).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/formula_bar_value|visible_course|visible_teacher|visible_cell_text|"comment"|"body"/);
    expect(JSON.stringify(first)).not.toMatch(/江邵玫|支莉|李强|艾晓玉/);
    validateLiveLayoutContextIndex(first);
    expect(() => validateLiveLayoutContextIndex({ ...first, context_index_sha256: "0".repeat(64) })).toThrow(/hash mismatch/);
    expect(() => validateLiveLayoutContextIndex({ ...first, comment: "leak" })).toThrow(/formula text|visible-cell|comment|review body/i);
  });

  it("writes a new #180 sports/english copy on live teacher columns B and E", () => {
    const index = compileLiveLayoutContextIndex({
      layout: confirmedLayout(),
      reads: [
        { worksheet: "体育课", row: 6, role: "course", address: "A6", nonempty: true },
        { worksheet: "体育课", row: 7, role: "course", address: "A6", nonempty: true },
        { worksheet: "体育课", row: 6, role: "teacher", address: "B6", nonempty: true },
        { worksheet: "体育课", row: 7, role: "teacher", address: "B7", nonempty: true },
        { worksheet: "大英和视听说", row: 8, role: "course", address: "B3", nonempty: true },
        { worksheet: "大英和视听说", row: 8, role: "teacher", address: "E8", nonempty: true },
      ],
    });
    const sports = index.sheets.find((sheet) => sheet.worksheet === "体育课")!;
    const english = index.sheets.find((sheet) => sheet.worksheet === "大英和视听说")!;

    expect(sports.teacher_column).toBe("B");
    expect(sports.course_column).toBe("A");
    expect(sports.rows.map((row) => row.row)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(sports.rows.find((row) => row.row === 6)).toMatchObject({
      course_cell: "A6",
      teacher_cell: "B6",
      course_anchor_row: 6,
    });
    expect(sports.rows.find((row) => row.row === 7)).toMatchObject({
      course_cell: "A6",
      teacher_cell: "B7",
      course_anchor_row: 6,
    });
    expect(sports.rows.find((row) => row.row === 8)).toMatchObject({
      course_cell: "A8",
      teacher_cell: "B8",
      course_anchor_row: MISSING_CONTEXT,
    });
    expect(english.teacher_column).toBe("E");
    expect(english.course_column).toBe("B");
    expect(english.rows.find((row) => row.row === 8)).toMatchObject({
      course_cell: "B3",
      teacher_cell: "E8",
      course_anchor_row: 3,
    });
    expect(english.rows.find((row) => row.row === 9)).toMatchObject({
      course_cell: "B9",
      teacher_cell: "E9",
      course_anchor_row: MISSING_CONTEXT,
    });
    expect(JSON.stringify(sports)).not.toMatch(/"teacher_column":"C"|"teacher_cell":"C/);
    expect(JSON.stringify(english)).not.toMatch(/"teacher_column":"G"|"teacher_cell":"G/);
    expect(JSON.stringify(index)).not.toMatch(/李强|支莉|大学英语|健美操/);
  });

  it("rejects obsolete 体育 C / 大英 G / 外教 F teacher reads and does not invent teachers", () => {
    expect(() => compileLiveLayoutContextIndex({
      layout: confirmedLayout(),
      reads: [{ worksheet: "体育课", row: 6, role: "teacher", address: "C6", nonempty: true }],
    })).toThrow(/体育课.*C/);
    expect(() => compileLiveLayoutContextIndex({
      layout: confirmedLayout(),
      reads: [{ worksheet: "大英和视听说", row: 8, role: "teacher", address: "G8", nonempty: true }],
    })).toThrow(/大英和视听说.*G/);
    expect(() => compileLiveLayoutContextIndex({
      layout: confirmedLayout(),
      reads: [{ worksheet: "外教", row: 3, role: "teacher", address: "F3", nonempty: true }],
    })).toThrow(/外教.*F/);
    expect(() => compileLiveLayoutContextIndex({
      layout: confirmedLayout(),
      reads: [{
        worksheet: "体育课",
        row: 6,
        role: "teacher",
        address: "B6",
        nonempty: true,
        formula_bar_value: "李强",
      } as LiveLayoutContextRead],
    })).toThrow(/formula text|visible-cell|comment|review body/i);
  });

  it("keeps merge-inherited course cells and uncovered rows as missing_context", () => {
    const index = compileLiveLayoutContextIndex({
      layout: confirmedLayout(),
      reads: [
        { worksheet: "主要课程", row: 19, role: "course", address: "A14", nonempty: true },
        { worksheet: "主要课程", row: 19, role: "teacher", address: "E19", nonempty: true },
        { worksheet: "主要课程", row: 20, role: "course", address: "A20", nonempty: false },
        { worksheet: "美育", row: 12, role: "course", address: "A12", nonempty: true },
        { worksheet: "美育", row: 12, role: "teacher", address: "D12", nonempty: true },
        { worksheet: "MOOC", row: 8, role: "course", address: "B8", nonempty: true },
        { worksheet: "外教", row: 5, role: "course", address: "A5", nonempty: false },
      ],
    });
    expect(index.sheets.find((sheet) => sheet.worksheet === "主要课程")?.rows.find((row) => row.row === 19)).toMatchObject({
      course_cell: "A14",
      teacher_cell: "E19",
      course_anchor_row: 14,
    });
    expect(index.sheets.find((sheet) => sheet.worksheet === "主要课程")?.rows.find((row) => row.row === 20)).toMatchObject({
      course_cell: "A14",
      teacher_cell: "E20",
      course_anchor_row: 14,
    });
    expect(index.sheets.find((sheet) => sheet.worksheet === "主要课程")?.rows.find((row) => row.row === 21)).toMatchObject({
      course_cell: "A21",
      teacher_cell: "E21",
      course_anchor_row: MISSING_CONTEXT,
    });
    expect(index.sheets.find((sheet) => sheet.worksheet === "美育")?.rows.find((row) => row.row === 12)).toMatchObject({
      course_cell: "A12",
      teacher_cell: "D12",
    });
    expect(index.sheets.find((sheet) => sheet.worksheet === "MOOC")?.rows.find((row) => row.row === 8)).toMatchObject({
      course_cell: "B8",
      teacher_cell: "F8",
    });
    expect(index.sheets.find((sheet) => sheet.worksheet === "外教")?.rows.find((row) => row.row === 5)).toMatchObject({
      course_cell: MISSING_CONTEXT,
      teacher_cell: "E5",
      course_anchor_row: MISSING_CONTEXT,
    });
    expect(JSON.stringify(index)).not.toMatch(/统计学|江邵玫|中国茶文化|中国民歌/);
  });

  it("leaves smoke-capture-manifest-v1 and other-smoke-capture-manifest-v1 hashes untouched", async () => {
    expect(SMOKE_MANIFEST_VERSION).toBe("smoke-capture-manifest-v1");
    expect(OTHER_SMOKE_MANIFEST_VERSION).toBe("other-smoke-capture-manifest-v1");
    const protectedPaths = [
      "scripts/legacy_evidence/output/smoke-20260818-v1/smoke-manifest.json",
      "scripts/legacy_evidence/output/other-smoke-20260819-v1/manifest.json",
    ];
    const before = await Promise.all(protectedPaths.map(fileSha256IfPresent));
    const index = compileLiveLayoutContextIndex({
      layout: confirmedLayout(),
      reads: [{ worksheet: "体育课", row: 6, role: "teacher", address: "B6", nonempty: true }],
    });
    const afterCompile = await Promise.all(protectedPaths.map(fileSha256IfPresent));
    expect(afterCompile).toEqual(before);

    expect(() => assertLiveLayoutContextOutputPath(join(LIVE_LAYOUT_CONTEXT_OUTPUT_RELATIVE, "context-index.json"))).not.toThrow();
    expect(() => assertLiveLayoutContextOutputPath("scripts/legacy_evidence/output/smoke-20260818-v1/context-index.json")).toThrow(/#180|#229|formula-bar|protected/i);
    expect(() => assertLiveLayoutContextOutputPath("scripts/legacy_evidence/output/other-smoke-20260819-v1/context-index.json")).toThrow(/#180|#229|formula-bar|protected/i);
    expect(() => assertLiveLayoutContextOutputPath("scripts/legacy_evidence/output/formula-bar-full-20260729-v1/context-index.json")).toThrow(/#180|#229|formula-bar|protected/i);

    const tempRoot = await mkdtemp(join(tmpdir(), "jufexk-live-layout-context-"));
    try {
      const allowed = resolve(tempRoot, LIVE_LAYOUT_CONTEXT_OUTPUT_RELATIVE, "context-index.json");
      await writeLiveLayoutContextIndex(allowed, index);
      const written = JSON.parse(await readFile(allowed, "utf8"));
      expect(written.context_index_sha256).toBe(index.context_index_sha256);
      expect(written.wrote_tencent_or_business_db).toBe(false);
      await expect(writeLiveLayoutContextIndex(
        resolve("scripts/legacy_evidence/output/smoke-20260818-v1/context-index.json"),
        index,
      )).rejects.toThrow(/#180|#229|formula-bar|protected/i);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }

    const afterWrite = await Promise.all(protectedPaths.map(fileSha256IfPresent));
    expect(afterWrite).toEqual(before);
  });

  it("strips formula-bar text when compiling through the CLI", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "jufexk-live-layout-context-cli-"));
    try {
      const layoutPath = join(tempRoot, "layout.json");
      const coursePath = join(tempRoot, "course-reads.json");
      const teacherPath = join(tempRoot, "teacher-reads.json");
      const outputPath = resolve(tempRoot, LIVE_LAYOUT_CONTEXT_OUTPUT_RELATIVE, "context-index.json");
      await writeJson(layoutPath, confirmedLayout());
      await writeJson(coursePath, [
        { worksheet: "体育课", row: 6, address: "A6", formula_bar_value: "健美操" },
      ]);
      await writeJson(teacherPath, [
        { worksheet: "体育课", row: 6, address: "B6", formula_bar_value: "李强" },
      ]);
      const result = await runLiveLayoutContextIndexCli(["compile", layoutPath, outputPath, coursePath, teacherPath]);
      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(result.wrote_tencent_or_business_db).toBe(false);
      expect(written.sheets.find((sheet: { worksheet: string }) => sheet.worksheet === "体育课").rows[0]).toMatchObject({
        course_cell: "A6",
        teacher_cell: "B6",
      });
      expect(JSON.stringify(written)).not.toMatch(/formula_bar_value|健美操|李强/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function confirmedLayout() {
  return compileLiveLayout({ sheets: confirmedSheets() });
}

function confirmedSheets(): LiveLayoutSheetInput[] {
  return [
    { worksheet: "主要课程", course_column: "A", teacher_column: "E", smoke_rows: [19, 26] },
    { worksheet: "数学课", course_column: "B", teacher_column: "C", smoke_rows: [8, 14] },
    { worksheet: "美育", course_column: "A", teacher_column: "D", smoke_rows: [8, 14] },
    { worksheet: "大英和视听说", course_column: "B", teacher_column: "E", smoke_rows: [8, 14] },
    { worksheet: "思政课", course_column: "A", teacher_column: "F", smoke_rows: [8, 14] },
    { worksheet: "外教", course_column: "A", teacher_column: "E", extra_columns: { F: "english_name" }, smoke_rows: [3, 6] },
    { worksheet: "MOOC", course_column: "B", teacher_column: "F", smoke_rows: [8, 14], g46_status: "blocked_locator" },
    { worksheet: "体育课", course_column: "A", teacher_column: "B", smoke_rows: [6, 14] },
  ];
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function fileSha256IfPresent(path: string) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}
