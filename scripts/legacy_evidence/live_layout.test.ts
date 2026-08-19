import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIVE_LAYOUT_OUTPUT_RELATIVE,
  LIVE_LAYOUT_VERSION,
  assertLiveLayoutOutputPath,
  compileLiveLayout,
  validateLiveLayout,
  writeLiveLayout,
  type LiveLayoutSheetInput,
} from "./live_layout";

describe("legacy live layout contract", () => {
  it("compiles the eight confirmed sheets with a stable SHA-256 and no review bodies", () => {
    const first = compileLiveLayout({ sheets: confirmedSheets() });
    const second = compileLiveLayout({ sheets: confirmedSheets() });

    expect(first.contract_version).toBe(LIVE_LAYOUT_VERSION);
    expect(first.layout_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.layout_sha256).toBe(first.layout_sha256);
    expect(first.wrote_tencent_or_business_db).toBe(false);
    expect(first.sheets.map((sheet) => [
      sheet.worksheet,
      sheet.course_column,
      sheet.teacher_column,
      sheet.extra_columns ?? null,
      sheet.smoke_rows,
      sheet.g46_status ?? null,
    ])).toEqual([
      ["主要课程", "A", "E", null, [19, 26], null],
      ["数学课", "B", "C", null, [8, 14], null],
      ["美育", "A", "D", null, [8, 14], null],
      ["大英和视听说", "B", "E", null, [8, 14], null],
      ["思政课", "A", "F", null, [8, 14], null],
      ["外教", "A", "E", { F: "english_name" }, [3, 6], null],
      ["MOOC", "B", "F", null, [8, 14], "blocked_locator"],
      ["体育课", "A", "B", null, [6, 14], null],
    ]);
    expect(JSON.stringify(first)).not.toMatch(/formula_bar_value|visible_cell_text|"comment"|"body"/);
    validateLiveLayout(first);
    expect(() => validateLiveLayout({ ...first, layout_sha256: "0".repeat(64) })).toThrow(/hash mismatch/);
    expect(() => validateLiveLayout({ ...first, comment: "leak" })).toThrow(/formula text|visible-cell|comment|review body/i);
  });

  it("rejects the obsolete 体育 C and 大英 G teacher letters", () => {
    expect(() => compileLiveLayout({
      sheets: replaceSheet(confirmedSheets(), "体育课", { teacher_column: "C" }),
    })).toThrow(/体育课.*C/);
    expect(() => compileLiveLayout({
      sheets: replaceSheet(confirmedSheets(), "大英和视听说", { teacher_column: "G" }),
    })).toThrow(/大英和视听说.*G/);
  });

  it("rejects 外教 F as a teacher column and only accepts it as a remark role", () => {
    expect(() => compileLiveLayout({
      sheets: replaceSheet(confirmedSheets(), "外教", { teacher_column: "F", extra_columns: undefined }),
    })).toThrow(/外教.*F/);
    expect(() => compileLiveLayout({
      sheets: replaceSheet(confirmedSheets(), "外教", { extra_columns: { F: "course_intro" } }),
    })).toThrow(/english_name/);
  });

  it("rejects formula-bar text, visible cell text, comments, and review bodies", () => {
    const dirtyInputs = [
      { sheets: confirmedSheets(), formula_bar_value: "老师很好" },
      { sheets: confirmedSheets(), visible_cell_text: "老师很好" },
      { sheets: confirmedSheets(), comment: "现场备注" },
      { sheets: confirmedSheets(), body: "这门课给分松" },
    ];
    for (const input of dirtyInputs) {
      expect(() => compileLiveLayout(input as { sheets: LiveLayoutSheetInput[] })).toThrow(/formula text|visible-cell|comment|review body/i);
    }
    expect(() => compileLiveLayout({
      sheets: confirmedSheets(),
      notes: "老师很好",
    } as { sheets: LiveLayoutSheetInput[] })).toThrow(/unexpected fields|formula text|visible-cell|comment|review body/i);
  });

  it("refuses to write over #180, #229, or formula-bar packs and leaves those hashes untouched", async () => {
    const protectedPaths = [
      "scripts/legacy_evidence/output/smoke-20260818-v1/manifest.json",
      "scripts/legacy_evidence/output/smoke-rest-20260818-v1/manifest.json",
      "scripts/legacy_evidence/output/other-smoke-20260819-v1/manifest.json",
      "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/audit.json",
    ];
    const before = await Promise.all(protectedPaths.map(fileSha256IfPresent));
    const layout = compileLiveLayout({ sheets: confirmedSheets() });
    const afterCompile = await Promise.all(protectedPaths.map(fileSha256IfPresent));
    expect(afterCompile).toEqual(before);

    expect(() => assertLiveLayoutOutputPath(join(LIVE_LAYOUT_OUTPUT_RELATIVE, "live-layout.json"))).not.toThrow();
    expect(() => assertLiveLayoutOutputPath("scripts/legacy_evidence/output/smoke-20260818-v1/live-layout.json")).toThrow(/#180|#229|smoke-rest|formula-bar|protected/i);
    expect(() => assertLiveLayoutOutputPath("scripts/legacy_evidence/output/smoke-rest-20260818-v1/live-layout.json")).toThrow(/#180|#229|smoke-rest|formula-bar|protected/i);
    expect(() => assertLiveLayoutOutputPath("scripts/legacy_evidence/output/other-smoke-20260819-v1/live-layout.json")).toThrow(/#180|#229|smoke-rest|formula-bar|protected/i);
    expect(() => assertLiveLayoutOutputPath("scripts/legacy_evidence/output/formula-bar-full-20260729-v1/live-layout.json")).toThrow(/#180|#229|smoke-rest|formula-bar|protected/i);

    const tempRoot = await mkdtemp(join(tmpdir(), "jufexk-live-layout-"));
    try {
      const allowed = resolve(tempRoot, LIVE_LAYOUT_OUTPUT_RELATIVE, "live-layout.json");
      await writeLiveLayout(allowed, layout);
      const written = JSON.parse(await readFile(allowed, "utf8"));
      expect(written.layout_sha256).toBe(layout.layout_sha256);
      await expect(writeLiveLayout(resolve("scripts/legacy_evidence/output/smoke-20260818-v1/live-layout.json"), layout)).rejects.toThrow(/#180|#229|formula-bar|protected/i);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }

    const afterWrite = await Promise.all(protectedPaths.map(fileSha256IfPresent));
    expect(afterWrite).toEqual(before);
  });
});

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

function replaceSheet(
  sheets: LiveLayoutSheetInput[],
  worksheet: string,
  patch: Partial<LiveLayoutSheetInput>,
): LiveLayoutSheetInput[] {
  return sheets.map((sheet) => (sheet.worksheet === worksheet ? { ...sheet, ...patch } : sheet));
}

async function fileSha256IfPresent(path: string) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}
