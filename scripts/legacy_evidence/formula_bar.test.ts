import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureFormulaBarCell,
  hashFormulaBarEvidenceContent,
  readFormulaBarEvidence,
  type FormulaBarCellSource,
  validateFormulaBarEvidence,
  writeFormulaBarEvidence,
} from "./formula_bar";
import { createTencentSheetFormulaBarSource } from "./formula_bar_tencent";

const CELL_IMAGE = {
  kind: "cell" as const,
  path: "captures/Main/L51.png",
  sha256: "1".repeat(64),
};

function source(overrides: Partial<FormulaBarCellSource> = {}): FormulaBarCellSource {
  return {
    locateByAddressBox: async () => undefined,
    readActiveAddress: async () => "L51",
    readFormulaBar: async () => "clear and complete",
    readVisibleCellText: async () => "clear and",
    captureEvidence: async () => CELL_IMAGE,
    now: () => "2026-07-29T08:00:00.000Z",
    ...overrides,
  };
}

describe("single-cell formula-bar evidence", () => {
  it("classifies a nonempty formula value as a review origin when the visible text is truncated", async () => {
    const result = await captureFormulaBarCell(
      { worksheet: "Main", address: "L51" },
      source(),
    );

    expect(result).toMatchObject({
      contract_version: "formula-bar-cell-evidence-v1",
      key: "Main|51|L",
      worksheet: "Main",
      row: 51,
      column: "L",
      target_address: "L51",
      active_addresses: ["L51", "L51"],
      formula_bar_value: "clear and complete",
      formula_bar_text_sha256: "0a6521af0e901eb4aaf5ec44b8ee58636a014dda189b82ca062f30e9f2fc382a",
      formula_bar_nonempty: true,
      visible_cell_text: "clear and",
      correspondence: "visible_text_matches_formula",
      terminal_status: "review_origin",
      halt_batch: false,
      read_only: true,
      evidence: { cell_image: CELL_IMAGE, conflict_image: null },
    });
    expect(result.formula_bar_reads.map((read) => read.value)).toEqual([
      "clear and complete",
      "clear and complete",
    ]);
    expect(result.record_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("classifies visible text with an empty formula value as a horizontal overflow blank", async () => {
    const result = await captureFormulaBarCell(
      { worksheet: "Main", address: "M51" },
      source({
        readActiveAddress: async () => "M51",
        readFormulaBar: async () => "",
        readVisibleCellText: async () => "complete",
      }),
    );

    expect(result).toMatchObject({
      key: "Main|51|M",
      formula_bar_value: "",
      formula_bar_text_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      formula_bar_nonempty: false,
      visible_cell_text: "complete",
      correspondence: "formula_empty_visible_text",
      terminal_status: "horizontal_overflow_blank",
      halt_batch: false,
    });
  });

  it("halts with conflict evidence when the active address does not match the target", async () => {
    let formulaReads = 0;
    const conflictImage = {
      kind: "conflict" as const,
      path: "conflicts/Main/L51-address.png",
      sha256: "2".repeat(64),
    };

    const result = await captureFormulaBarCell(
      { worksheet: "Main", address: "L51" },
      source({
        readActiveAddress: async () => "M51",
        readFormulaBar: async () => {
          formulaReads += 1;
          return "stale value";
        },
        captureEvidence: async ({ kind }) => {
          expect(kind).toBe("conflict");
          return conflictImage;
        },
      }),
    );

    expect(formulaReads).toBe(0);
    expect(result).toMatchObject({
      active_addresses: ["M51"],
      formula_bar_reads: [],
      formula_bar_value: null,
      terminal_status: "evidence_conflict",
      conflict_reason: "active_address_mismatch",
      halt_batch: true,
      evidence: { cell_image: null, conflict_image: conflictImage },
    });
  });

  it("halts after the first formula read if the active address drifts before the second read", async () => {
    const addresses = ["L51", "M51"];
    let formulaReads = 0;
    const conflictImage = { kind: "conflict" as const, path: "conflicts/address-drift.png", sha256: "5".repeat(64) };
    const result = await captureFormulaBarCell(
      { worksheet: "Main", address: "L51" },
      source({
        readActiveAddress: async () => addresses.shift() ?? "M51",
        readFormulaBar: async () => { formulaReads += 1; return "first value"; },
        captureEvidence: async () => conflictImage,
      }),
    );

    expect(formulaReads).toBe(1);
    expect(result).toMatchObject({
      active_addresses: ["L51", "M51"],
      formula_bar_reads: [{ sequence: 1, value: "first value" }],
      terminal_status: "evidence_conflict",
      conflict_reason: "active_address_mismatch",
      halt_batch: true,
    });
  });

  it("halts when consecutive formula-bar reads return different values", async () => {
    const values = ["old value", "new value"];
    const conflictImage = {
      kind: "conflict" as const,
      path: "conflicts/Main/L51-double-read.png",
      sha256: "3".repeat(64),
    };

    const result = await captureFormulaBarCell(
      { worksheet: "Main", address: "L51" },
      source({
        readFormulaBar: async () => values.shift() ?? "",
        captureEvidence: async () => conflictImage,
      }),
    );

    expect(result).toMatchObject({
      active_addresses: ["L51", "L51"],
      formula_bar_value: null,
      terminal_status: "evidence_conflict",
      conflict_reason: "formula_bar_reads_mismatch",
      halt_batch: true,
      evidence: { cell_image: null, conflict_image: conflictImage },
    });
    expect(result.formula_bar_reads).toMatchObject([
      { sequence: 1, value: "old value" },
      { sequence: 2, value: "new value" },
    ]);
    expect(result.formula_bar_reads[0].sha256).not.toBe(result.formula_bar_reads[1].sha256);
  });

  it("records a content conflict when visible cell text does not correspond to the formula value", async () => {
    const conflictImage = {
      kind: "conflict" as const,
      path: "conflicts/Main/L51-text.png",
      sha256: "4".repeat(64),
    };

    const result = await captureFormulaBarCell(
      { worksheet: "Main", address: "L51" },
      source({
        readFormulaBar: async () => "stored source text",
        readVisibleCellText: async () => "unrelated display",
        captureEvidence: async ({ kind }) => kind === "cell" ? CELL_IMAGE : conflictImage,
      }),
    );

    expect(result).toMatchObject({
      formula_bar_value: "stored source text",
      visible_cell_text: "unrelated display",
      correspondence: "visible_text_conflicts_with_formula",
      terminal_status: "evidence_conflict",
      conflict_reason: "visible_text_formula_mismatch",
      halt_batch: false,
      evidence: { cell_image: CELL_IMAGE, conflict_image: conflictImage },
    });
  });

  it("distinguishes an ordinary blank from a horizontal overflow blank", async () => {
    let captures = 0;
    const result = await captureFormulaBarCell(
      { worksheet: "Main", address: "N51" },
      source({
        readActiveAddress: async () => "N51",
        readFormulaBar: async () => "",
        readVisibleCellText: async () => "",
        captureEvidence: async () => { captures += 1; return CELL_IMAGE; },
      }),
    );

    expect(result).toMatchObject({
      formula_bar_nonempty: false,
      visible_cell_text: "",
      correspondence: "both_empty",
      terminal_status: "ordinary_blank",
      conflict_reason: null,
      halt_batch: false,
      cell_image_reason: null,
      evidence: { cell_image: null, conflict_image: null },
    });
    expect(captures).toBe(0);
  });

  it("captures an empty cell only when its scope explicitly requires an image", async () => {
    let captures = 0;
    const result = await captureFormulaBarCell(
      { worksheet: "Main", address: "N51" },
      source({
        readActiveAddress: async () => "N51",
        readFormulaBar: async () => "",
        readVisibleCellText: async () => "",
        captureEvidence: async () => { captures += 1; return CELL_IMAGE; },
      }),
      { force_cell_image: true },
    );

    expect(captures).toBe(1);
    expect(result).toMatchObject({
      terminal_status: "ordinary_blank",
      cell_image_reason: "forced_scope",
      evidence: { cell_image: CELL_IMAGE },
    });
  });

  it("writes an atomic verifiable contract and rejects tampered formula text", async () => {
    const root = await mkdtemp(join(tmpdir(), "jufexk-formula-bar-"));
    const evidencePath = join(root, "L51.json");
    const imageReference = {
      kind: "cell" as const,
      path: "L51.png",
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    };
    try {
      await writeFile(join(root, imageReference.path), Uint8Array.from([1, 2, 3]));
      const result = await captureFormulaBarCell(
        { worksheet: "Main", address: "L51" },
        source({ captureEvidence: async () => imageReference }),
      );
      await writeFormulaBarEvidence(evidencePath, result);
      await expect(readFormulaBarEvidence(evidencePath)).resolves.toEqual(result);

      const tampered = JSON.parse(await readFile(evidencePath, "utf8"));
      tampered.formula_bar_value = "modified";
      await writeFile(evidencePath, JSON.stringify(tampered));
      await expect(readFormulaBarEvidence(evidencePath)).rejects.toThrow("formula-bar evidence hash mismatch");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an internally re-signed contract with an invalid read sequence", async () => {
    const result: any = await captureFormulaBarCell(
      { worksheet: "Main", address: "L51" },
      source(),
    );
    result.formula_bar_reads = [result.formula_bar_reads[0]];
    result.record_sha256 = hashFormulaBarEvidenceContent(result);

    expect(() => validateFormulaBarEvidence(result)).toThrow(
      "confirmed formula-bar evidence requires two address-bound identical reads",
    );
  });

  it("uses only the Tencent address box and read-only formula bar in the live adapter", async () => {
    const actions: string[] = [];
    const addressLocator = {
      count: async () => 1,
      press: async (key: string) => { actions.push(`press:${key}`); },
      evaluate: async (_callback: (element: unknown, arg?: unknown) => unknown, arg?: unknown) => {
        if (arg !== undefined) {
          actions.push(`native:${String(arg)}`);
          return undefined;
        }
        return "L51";
      },
    };
    const formulaLocator = {
      count: async () => 1,
      textContent: async () => "clear and complete",
      getAttribute: async (name: string) => name === "contenteditable" ? "false" : null,
    };
    const viewOnlyLocator = {
      count: async () => 1,
      isVisible: async () => true,
    };
    const tab = {
      playwright: {
        locator: (selector: string) => {
          actions.push(`locator:${selector}`);
          return selector === "input.bar-label" ? addressLocator : formulaLocator;
        },
        getByRole: (role: string, options: { name: string; exact: boolean }) => {
          actions.push(`role:${role}:${options.name}:${options.exact}`);
          return viewOnlyLocator;
        },
      },
      screenshot: async () => Uint8Array.from([1, 2, 3]),
    };
    const liveSource = createTencentSheetFormulaBarSource({
      tab,
      readVisibleCellText: async () => "clear and",
      writeScreenshot: async ({ kind }) => ({
        kind,
        path: "captures/Main/L51.png",
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      }),
      now: () => "2026-07-29T08:00:00.000Z",
    });

    const result = await captureFormulaBarCell({ worksheet: "Main", address: "L51" }, liveSource);

    expect(result.terminal_status).toBe("review_origin");
    expect(actions).toEqual([
      "locator:input.bar-label",
      "locator:#alloy-simple-text-editor",
      "role:button:只能查看:true",
      "native:L51",
      "press:Enter",
    ]);
  });

  it("selects the requested worksheet before addressing a live cell", async () => {
    const actions: string[] = [];
    const addressLocator = {
      count: async () => 1,
      press: async (key: string) => { actions.push(`press:${key}`); },
      evaluate: async (_callback: (element: unknown, arg?: unknown) => unknown, arg?: unknown) => {
        if (arg !== undefined) {
          actions.push(`native:${String(arg)}`);
          return undefined;
        }
        return "L51";
      },
    };
    const formulaLocator = {
      count: async () => 1,
      textContent: async () => "clear and complete",
      getAttribute: async () => "false",
    };
    const liveSource = createTencentSheetFormulaBarSource({
      tab: {
        playwright: {
          locator: (selector: string) => selector === "input.bar-label" ? addressLocator : formulaLocator,
          getByRole: () => ({ count: async () => 1, isVisible: async () => true }),
        },
        screenshot: async () => Uint8Array.from([1, 2, 3]),
      },
      selectWorksheet: async (worksheet) => { actions.push(`sheet:${worksheet}`); },
      settleAfterLocate: async (target) => { actions.push(`settle:${target.address}`); },
      readVisibleCellText: async () => "clear and",
      writeScreenshot: async ({ kind }) => ({
        kind,
        path: "capture.png",
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      }),
      now: () => "2026-07-29T08:00:00.000Z",
    });

    await captureFormulaBarCell({ worksheet: "大英和视听说", address: "L51" }, liveSource);

    expect(actions).toEqual(["sheet:大英和视听说", "native:L51", "press:Enter", "settle:L51"]);
  });

  it("replays one page-side snapshot as two address-bound formula reads", async () => {
    let snapshotCalls = 0;
    const liveSource = createTencentSheetFormulaBarSource({
      tab: {
        playwright: {
          locator: (selector: string) => selector === "input.bar-label"
            ? {
              count: async () => 1,
              press: async () => undefined,
              evaluate: async (_callback: (element: unknown, arg?: unknown) => unknown, arg?: unknown) => {
                if (arg !== undefined) return undefined;
                throw new Error("uncached address read");
              },
            }
            : {
              count: async () => 1,
              textContent: async () => { throw new Error("uncached formula read"); },
              getAttribute: async () => "false",
            },
          getByRole: () => ({ count: async () => 1, isVisible: async () => true }),
        },
        screenshot: async () => Uint8Array.from([1, 2, 3]),
      },
      readFormulaBarSnapshot: async () => {
        snapshotCalls += 1;
        return {
          active_addresses: ["L51", "L51"],
          formula_bar_values: ["clear and complete", "clear and complete"],
        };
      },
      readVisibleCellText: async () => "clear and",
      writeScreenshot: async ({ kind }) => ({
        kind,
        path: "capture.png",
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      }),
      now: () => "2026-07-29T08:00:00.000Z",
    });

    const result = await captureFormulaBarCell({ worksheet: "Main", address: "L51" }, liveSource);

    expect(result.active_addresses).toEqual(["L51", "L51"]);
    expect(result.formula_bar_reads.map((read) => read.value)).toEqual([
      "clear and complete",
      "clear and complete",
    ]);
    expect(snapshotCalls).toBe(1);
  });

  it("allows the live runner to prepare the rendered frame before the evidence screenshot", async () => {
    const actions: string[] = [];
    const locator = {
      count: async () => 1,
      press: async () => undefined,
      evaluate: async () => "L51",
      textContent: async () => "value",
      getAttribute: async () => "false",
    };
    const liveSource = createTencentSheetFormulaBarSource({
      tab: {
        playwright: {
          locator: () => locator,
          getByRole: () => ({ count: async () => 1, isVisible: async () => true }),
        },
        screenshot: async () => { actions.push("screenshot"); return Uint8Array.from([1, 2, 3]); },
      },
      readVisibleCellText: async () => "value",
      prepareEvidenceCapture: async ({ kind }) => { actions.push(`prepare:${kind}`); },
      writeScreenshot: async ({ kind }) => {
        actions.push(`write:${kind}`);
        return {
          kind,
          path: "capture.png",
          sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
        };
      },
      now: () => "2026-07-29T08:00:00.000Z",
    });

    await captureFormulaBarCell({ worksheet: "Main", address: "L51" }, liveSource);

    expect(actions).toEqual(["prepare:cell", "screenshot", "write:cell"]);
  });

  it("refuses Tencent capture when the view-only control is absent", async () => {
    let addressWrites = 0;
    const inertLocator = {
      count: async () => 1,
      press: async () => undefined,
      evaluate: async (_callback: (element: unknown, arg?: unknown) => unknown, arg?: unknown) => {
        if (arg !== undefined) addressWrites += 1;
        return "L51";
      },
      textContent: async () => "value",
    };
    const liveSource = createTencentSheetFormulaBarSource({
      tab: {
        playwright: {
          locator: () => inertLocator,
          getByRole: () => ({ count: async () => 0, isVisible: async () => false }),
        },
        screenshot: async () => Uint8Array.from([1, 2, 3]),
      },
      readVisibleCellText: async () => "value",
      writeScreenshot: async () => CELL_IMAGE,
      now: () => "2026-07-29T08:00:00.000Z",
    });

    await expect(captureFormulaBarCell({ worksheet: "Main", address: "L51" }, liveSource))
      .rejects.toThrow("Tencent sheet is not visibly read-only");
    expect(addressWrites).toBe(0);
  });
});
