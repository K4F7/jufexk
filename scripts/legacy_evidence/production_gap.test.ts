import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFormulaBarMatrixPlan, buildFrozenFormulaBarMatrixPlan } from "./formula_bar_locator";
import {
  buildProductionGapInventory,
  classifyProductionGapCell,
  loadFormulaBarGapEvidence,
  parseProductionGapArgs,
  pickFormulaBarGapFields,
  renderProductionGapMarkdown,
  runProductionGap,
  sourceKeyFromRecord,
  writeProductionGapInventory,
  type FormulaBarGapEvidence,
} from "./production_gap";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

describe("production gap inventory", () => {
  it("classifies production, packaged, never packaged, and blank cells from a custom plan", () => {
    const plan = tinyPlan();
    const inventory = buildProductionGapInventory({
      plan,
      evidence: [
        gap("主要课程|19|F", "review_origin", true, false, HASH_A),
        gap("主要课程|19|G", "ordinary_blank", false, false, HASH_B),
        gap("主要课程|20|F", "review_origin", true, false, HASH_C),
        gap("思政课|8|G", "review_origin", true, false, HASH_C),
        gap("体育课|6|D", "evidence_conflict", null, true, HASH_A),
        gap("数学课|8|D", "review_origin", true, false, HASH_B),
        gap("数学课|8|E", "horizontal_overflow_blank", false, false, HASH_C),
      ],
      production: [
        { name: "v2", records: [identity("主要课程", 19, "F")] },
      ],
      unimported: [
        { name: "catalog-identity-unresolved", records: [identity("数学课", 8, "D"), identity("数学课", 8, "E")] },
      ],
    });

    expect(inventory.cells.map((cell) => [cell.key, cell.partition, cell.course_anchor])).toEqual([
      ["主要课程|19|F", "in_production", "missing_context"],
      ["主要课程|19|G", "not_a_review", "missing_context"],
      ["主要课程|20|F", "never_packaged", "missing_context"],
      ["思政课|8|G", "never_packaged", "missing_context"],
      ["体育课|6|D", "never_packaged", "missing_context"],
      ["数学课|8|D", "packaged_not_imported", "missing_context"],
      ["数学课|8|E", "not_a_review", "missing_context"],
    ]);
    expect(inventory.sheets.map((sheet) => [
      sheet.worksheet,
      sheet.planned_cells,
      sheet.nonempty_cells,
      sheet.in_production,
      sheet.packaged_not_imported,
      sheet.never_packaged,
      sheet.halt_batch,
      sheet.course_anchor,
    ])).toEqual([
      ["主要课程", 3, 2, 1, 0, 1, 0, "missing_context"],
      ["思政课", 1, 1, 0, 0, 1, 0, "missing_context"],
      ["体育课", 1, 0, 0, 0, 1, 1, "missing_context"],
      ["数学课", 2, 1, 0, 1, 0, 0, "missing_context"],
    ]);
    expect(inventory.later_capture.smoke).toMatchObject({
      worksheets: ["思政课", "体育课"],
      cell_count: 2,
      keys: ["思政课|8|G", "体育课|6|D"],
    });
    expect(inventory.later_capture.non_smoke).toMatchObject({
      worksheets: ["主要课程", "数学课"],
      cell_count: 1,
      keys: ["主要课程|20|F"],
    });
    expect(inventory.never_packaged_rows).toEqual([
      { worksheet: "主要课程", rows: [20] },
      { worksheet: "思政课", rows: [8] },
      { worksheet: "体育课", rows: [6] },
      { worksheet: "数学课", rows: [] },
    ]);
    expect(inventory.course_anchor).toBe("missing_context");
    expect(inventory.cells).toHaveLength(plan.planned_cells);
  });

  it("treats empty unimported cells as not_a_review and keeps production ahead of unimported", () => {
    expect(classifyProductionGapCell({
      evidence: gap("主要课程|19|G", "ordinary_blank", false, false, HASH_A),
      inProduction: false,
      inUnimported: true,
    })).toBe("not_a_review");
    expect(classifyProductionGapCell({
      evidence: gap("主要课程|19|F", "review_origin", true, false, HASH_A),
      inProduction: true,
      inUnimported: true,
    })).toBe("in_production");
    expect(classifyProductionGapCell({
      evidence: gap("MOOC|8|G", "evidence_conflict", null, true, HASH_A),
      inProduction: false,
      inUnimported: false,
    })).toBe("never_packaged");
    expect(classifyProductionGapCell({
      evidence: gap("外教|3|G", "ordinary_blank", true, false, HASH_A),
      inProduction: false,
      inUnimported: false,
    })).toBe("never_packaged");
  });

  it("reads nested evaluation identities and never serializes comment", () => {
    expect(sourceKeyFromRecord({
      evaluation: { worksheet: "思政课", source_row: 8, source_column: "g", comment: "FIXTURE_COMMENT" },
    })).toBe("思政课|8|G");
    expect(sourceKeyFromRecord({
      worksheet: "主要课程",
      source_row: "19",
      source_column: "F",
      comment: "FIXTURE_COMMENT",
    })).toBe("主要课程|19|F");

    const inventory = buildProductionGapInventory({
      plan: tinyPlan(["主要课程|19|F"]),
      evidence: [gap("主要课程|19|F", "review_origin", true, false, HASH_A)],
      production: [{
        name: "v2",
        records: [{
          worksheet: "主要课程",
          source_row: 19,
          source_column: "F",
          comment: "FIXTURE_COMMENT",
          evaluation: { comment: "NESTED_COMMENT" },
        }],
      }],
      unimported: [],
    });
    const encoded = JSON.stringify(inventory);
    expect(encoded).not.toMatch(/FIXTURE_COMMENT|NESTED_COMMENT|"comment"|formula_bar_value|visible_cell_text/);
    expect(renderProductionGapMarkdown(inventory)).not.toMatch(/FIXTURE_COMMENT|"comment"/);
  });

  it("does not create or delete matrix keys and does not invent PE row ranges", () => {
    const plan = tinyPlan(["体育课|100|D", "体育课|100|E"]);
    const inventory = buildProductionGapInventory({
      plan,
      evidence: [
        gap("体育课|100|D", "review_origin", true, false, HASH_A),
        gap("体育课|100|E", "ordinary_blank", false, false, HASH_B),
        gap("体育课|6|D", "review_origin", true, false, HASH_C),
      ],
      production: [
        { name: "pe", records: [identity("体育课", 6, "D"), identity("体育课", 100, "D")] },
      ],
      unimported: [],
    });

    expect(inventory.cells.map((cell) => cell.key)).toEqual(["体育课|100|D", "体育课|100|E"]);
    expect(inventory.cells).toHaveLength(2);
    expect(inventory.production_unique_keys).toBe(2);
    expect(inventory.production_missing_from_formula).toBe(1);
    expect(inventory.production_missing_from_formula_keys).toEqual(["体育课|6|D"]);
    expect(inventory.never_packaged_rows).toEqual([{ worksheet: "体育课", rows: [] }]);
    expect(JSON.stringify(inventory)).not.toMatch(/first_row|last_row|smoke_rows|6-14/);
  });

  it("lists cross-batch duplicate production keys without bodies", () => {
    const inventory = buildProductionGapInventory({
      plan: tinyPlan(["主要课程|19|F", "主要课程|19|G"]),
      evidence: [
        gap("主要课程|19|F", "review_origin", true, false, HASH_A),
        gap("主要课程|19|G", "review_origin", true, false, HASH_B),
      ],
      production: [
        { name: "v2", records: [identity("主要课程", 19, "F"), identity("主要课程", 19, "F")] },
        { name: "issue111", records: [identity("主要课程", 19, "F")] },
      ],
      unimported: [],
    });

    expect(inventory.production_records).toBe(3);
    expect(inventory.production_unique_keys).toBe(1);
    expect(inventory.duplicate_production_keys).toEqual([
      { key: "主要课程|19|F", batches: ["v2", "issue111"] },
    ]);
    expect(inventory.cells[0].production_batches).toEqual(["v2", "issue111"]);
    expect(inventory.cells[1].production_batches).toEqual([]);
  });

  it("keeps a stable inventory hash for the same inputs", () => {
    const input = {
      plan: tinyPlan(),
      evidence: [
        gap("主要课程|19|F", "review_origin", true, false, HASH_A),
        gap("主要课程|19|G", "ordinary_blank", false, false, HASH_B),
        gap("主要课程|20|F", "review_origin", true, false, HASH_C),
        gap("思政课|8|G", "review_origin", true, false, HASH_C),
        gap("体育课|6|D", "evidence_conflict", null, true, HASH_A),
        gap("数学课|8|D", "review_origin", true, false, HASH_B),
        gap("数学课|8|E", "horizontal_overflow_blank", false, false, HASH_C),
      ],
      production: [{ name: "v2", records: [identity("主要课程", 19, "F")] }],
      unimported: [{ name: "catalog-relation-unavailable", records: [identity("数学课", 8, "D")] }],
    };
    const first = buildProductionGapInventory(input);
    const second = buildProductionGapInventory(input);
    expect(first.inventory_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.inventory_sha256).toBe(first.inventory_sha256);
    expect(buildProductionGapInventory({
      ...input,
      production: [{ name: "v2", records: [identity("主要课程", 19, "G")] }],
    }).inventory_sha256).not.toBe(first.inventory_sha256);
  });

  it("defaults to the frozen 14,985-cell plan and refuses missing evidence", () => {
    const frozen = buildFrozenFormulaBarMatrixPlan();
    expect(frozen.planned_cells).toBe(14_985);
    expect(() => buildProductionGapInventory({
      evidence: [],
      production: [],
      unimported: [],
    })).toThrow("missing formula-bar evidence: 主要课程|19|F");
  });

  it("picks only allowed formula-bar fields and ignores extra files", () => {
    expect(pickFormulaBarGapFields({
      key: "主要课程|19|F",
      terminal_status: "review_origin",
      formula_bar_nonempty: true,
      halt_batch: false,
      record_sha256: HASH_A,
      formula_bar_value: "SECRET_FORMULA",
      visible_cell_text: "SECRET_VISIBLE",
      comment: "FIXTURE_COMMENT",
    })).toEqual({
      key: "主要课程|19|F",
      terminal_status: "review_origin",
      formula_bar_nonempty: true,
      halt_batch: false,
      record_sha256: HASH_A,
    });
    expect(pickFormulaBarGapFields({ contract_version: "formula-bar-locator-checkpoint-v1" })).toBeNull();
  });

  it("rejects other-excluded as an unimported package", () => {
    expect(() => parseProductionGapArgs([
      "--formula-bar-dir", "evidence",
      "--unimported", "other-excluded=other-excluded.jsonl",
      "--out", "out",
    ])).toThrow("do not pass other-excluded as --unimported");
    expect(() => buildProductionGapInventory({
      plan: tinyPlan(["主要课程|19|F"]),
      evidence: [gap("主要课程|19|F", "ordinary_blank", false, false, HASH_A)],
      production: [],
      unimported: [{ name: "other-excluded", records: [] }],
    })).toThrow("do not pass other-excluded as --unimported");
  });

  it("writes both inventory files from the CLI helper without review bodies", async () => {
    const root = await mkdtemp(join(tmpdir(), "production-gap-"));
    try {
      const evidenceDir = join(root, "formula-bar", "主要课程");
      const outDir = join(root, "out");
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(join(evidenceDir, "F19.json"), `${JSON.stringify({
        key: "主要课程|19|F",
        terminal_status: "review_origin",
        formula_bar_nonempty: true,
        halt_batch: false,
        record_sha256: HASH_A,
        formula_bar_value: "SECRET_FORMULA",
        visible_cell_text: "SECRET_VISIBLE",
      }, null, 2)}\n`);
      await writeFile(join(root, "v2.jsonl"), `${JSON.stringify({
        worksheet: "主要课程",
        source_row: 19,
        source_column: "F",
        comment: "FIXTURE_COMMENT",
      })}\n`);
      const result = await runProductionGap({
        formulaBarDir: join(root, "formula-bar"),
        production: [{ name: "v2", path: join(root, "v2.jsonl") }],
        unimported: [],
        outDir,
        plan: tinyPlan(["主要课程|19|F"]),
      });
      const jsonText = await readFile(join(outDir, "production-gap-inventory.json"), "utf8");
      const markdown = await readFile(join(outDir, "production-gap-inventory.md"), "utf8");
      const parsed = JSON.parse(jsonText);
      expect(result.jsonPath).toBe(join(outDir, "production-gap-inventory.json"));
      expect(result.markdownPath).toBe(join(outDir, "production-gap-inventory.md"));
      expect(parsed.inventory_sha256).toBe(result.inventory.inventory_sha256);
      expect(markdown).toContain(result.inventory.inventory_sha256);
      expect(parsed.cells[0]).toMatchObject({
        key: "主要课程|19|F",
        partition: "in_production",
        production_batches: ["v2"],
        course_anchor: "missing_context",
      });
      expect(`${jsonText}\n${markdown}`).not.toMatch(/SECRET_FORMULA|SECRET_VISIBLE|FIXTURE_COMMENT|"comment"/);
      const loaded = await loadFormulaBarGapEvidence(join(root, "formula-bar"));
      expect(loaded).toEqual([gap("主要课程|19|F", "review_origin", true, false, HASH_A)]);
      await writeProductionGapInventory(join(root, "out2"), result.inventory);
      const again = await readFile(join(root, "out2", "production-gap-inventory.json"), "utf8");
      expect(JSON.parse(again).inventory_sha256).toBe(result.inventory.inventory_sha256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not call readFormulaBarEvidence or hardcode private production paths", async () => {
    const library = await readFile(new URL("./production_gap.ts", import.meta.url), "utf8");
    const cli = await readFile(new URL("./production_gap_cli.ts", import.meta.url), "utf8");
    expect(library).not.toMatch(/readFormulaBarEvidence/);
    expect(cli).not.toMatch(/readFormulaBarEvidence/);
    expect(`${library}\n${cli}`).not.toMatch(/D:\\\\19016|jufexk-production-inputs|other-excluded\.jsonl/);
  });
});

function tinyPlan(keys: string[] = [
  "主要课程|19|F",
  "主要课程|19|G",
  "主要课程|20|F",
  "思政课|8|G",
  "体育课|6|D",
  "数学课|8|D",
  "数学课|8|E",
]) {
  const sheets = new Map<string, Map<number, string[]>>();
  for (const key of keys) {
    const [worksheet, rowText, column] = key.split("|");
    const rows = sheets.get(worksheet) ?? new Map<number, string[]>();
    const columns = rows.get(Number(rowText)) ?? [];
    columns.push(column);
    rows.set(Number(rowText), columns);
    sheets.set(worksheet, rows);
  }
  return buildFormulaBarMatrixPlan([...sheets.entries()].map(([worksheet, rows]) => ({
    worksheet,
    rows: [...rows.entries()].map(([row, columns]) => ({ row, columns })),
  })));
}

function gap(
  key: string,
  terminal_status: FormulaBarGapEvidence["terminal_status"],
  formula_bar_nonempty: boolean | null,
  halt_batch: boolean,
  record_sha256: string,
): FormulaBarGapEvidence {
  return { key, terminal_status, formula_bar_nonempty, halt_batch, record_sha256 };
}

function identity(worksheet: string, source_row: number, source_column: string) {
  return { worksheet, source_row, source_column };
}
