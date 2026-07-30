import { describe, expect, it } from "vitest";
import { captureFormulaBarCell, type FormulaBarCellSource } from "./formula_bar";
import {
  buildFormulaBarSmokeGate,
  buildStrongSuspectTargetSet,
  captureFormulaBarSmoke,
  validateSmokeTargetSet,
  type FormulaBarSmokeTarget,
} from "./formula_bar_smoke";

const evaluations = [
  evaluation("eval-1", "主要课程", 10, "F", "same-a"),
  evaluation("eval-2", "主要课程", 10, "H", "same-a"),
  evaluation("eval-3", "大英和视听说", 5, "J", "same-b"),
  evaluation("eval-4", "大英和视听说", 5, "K", "same-b"),
  evaluation("eval-5", "大英和视听说", 5, "L", "same-b"),
  evaluation("eval-6", "MOOC", 3, "F", "unique"),
];

describe("formula-bar strong-suspect smoke gate", () => {
  it("derives the exact repeated-text scope in worksheet/row/column order with content hashes", () => {
    const targets = buildStrongSuspectTargetSet(evaluations, { groups: 2, targets: 5 });

    expect(targets).toMatchObject({
      contract_version: "formula-bar-smoke-targets-v1",
      source_rows: 6,
      group_count: 2,
      target_count: 5,
    });
    expect(targets.targets.map((target) => target.key)).toEqual([
      "主要课程|10|F",
      "主要课程|10|H",
      "大英和视听说|5|J",
      "大英和视听说|5|K",
      "大英和视听说|5|L",
    ]);
    expect(targets.targets[0]).toMatchObject({
      address: "F10",
      expected_visible_text: "same-a",
      expected_visible_text_sha256: "8504edd1cf7640f7d8fc63a9ddaed3c7475a860e548a8223ca4923234f85d1c6",
      existing_evaluation_ids: ["eval-1", "eval-2"],
    });
    expect(() => validateSmokeTargetSet(targets)).not.toThrow();
  });

  it("rejects duplicate source keys and a re-signed or stale target set", () => {
    expect(() => buildStrongSuspectTargetSet([
      ...evaluations,
      evaluation("eval-duplicate", "主要课程", 10, "F", "other"),
    ], { groups: 2, targets: 5 })).toThrow("duplicate historical evaluation source key");

    const targets: any = buildStrongSuspectTargetSet(evaluations, { groups: 2, targets: 5 });
    targets.targets[0].address = "G10";
    expect(() => validateSmokeTargetSet(targets)).toThrow("formula-bar smoke target hash mismatch");
  });

  it("passes only when every target has address-bound stable reads, an image, and the manual decisions agree", async () => {
    const targets = buildStrongSuspectTargetSet(evaluations, { groups: 2, targets: 5 });
    const evidence = await Promise.all(targets.targets.map((target, index) => captureFormulaBarCell(
      { worksheet: target.worksheet, address: target.address },
      sourceFor(target, index === 1 ? "" : target.expected_visible_text),
      { force_cell_image: true },
    )));
    const gate = buildFormulaBarSmokeGate(targets, evidence, [
      { key: targets.targets[0].key, terminal_status: "review_origin" },
      { key: targets.targets[1].key, terminal_status: "horizontal_overflow_blank" },
    ]);

    expect(gate).toMatchObject({
      contract_version: "formula-bar-smoke-gate-v1",
      conclusion: "pass",
      full_scan_allowed: true,
      read_only: true,
      counts: {
        planned: 5,
        captured: 5,
        address_bound: 5,
        stable_double_reads: 5,
        image_backed: 5,
        conflicts: 0,
        missing: 0,
        manual_expectations: 2,
        manual_mismatches: 0,
        terminal_statuses: {
          review_origin: 4,
          horizontal_overflow_blank: 1,
          ordinary_blank: 0,
          evidence_conflict: 0,
        },
      },
    });
    expect(gate.gate_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks the full scan for missing evidence, text conflicts, or manual disagreement", async () => {
    const targets = buildStrongSuspectTargetSet(evaluations, { groups: 2, targets: 5 });
    const first = await captureFormulaBarCell(
      { worksheet: targets.targets[0].worksheet, address: targets.targets[0].address },
      sourceFor(targets.targets[0], "stored source", "unrelated display"),
    );
    const gate = buildFormulaBarSmokeGate(targets, [first], [
      { key: first.key, terminal_status: "review_origin" },
    ]);

    expect(gate).toMatchObject({
      conclusion: "blocked",
      full_scan_allowed: false,
      counts: { captured: 1, conflicts: 1, missing: 4, manual_mismatches: 1 },
      conflict_keys: [first.key],
    });
  });

  it("accepts an explained visual correspondence only when bound to the exact record and screenshot hashes", async () => {
    const targets = buildStrongSuspectTargetSet(evaluations, { groups: 2, targets: 5 });
    const evidence = await Promise.all(targets.targets.map((target, index) => captureFormulaBarCell(
      { worksheet: target.worksheet, address: target.address },
      index === 0
        ? sourceFor(target, "stored source", "old transcription")
        : sourceFor(target, target.expected_visible_text),
    )));
    const conflict = evidence[0];
    const resolution = {
      key: conflict.key,
      evidence_record_sha256: conflict.record_sha256,
      cell_image_sha256: conflict.evidence.cell_image!.sha256,
      terminal_status: "review_origin" as const,
      reason: "visual_formula_correspondence_confirmed" as const,
    };

    const gate = buildFormulaBarSmokeGate(targets, evidence, [], [resolution]);
    expect(gate).toMatchObject({
      conclusion: "pass",
      counts: { raw_conflicts: 1, resolved_conflicts: 1, conflicts: 0 },
      manual_resolutions: [resolution],
    });
    expect(() => buildFormulaBarSmokeGate(targets, evidence, [], [{
      ...resolution,
      cell_image_sha256: "0".repeat(64),
    }])).toThrow("invalid or stale manual smoke resolution");
  });

  it("persists a stop conflict and does not navigate to later targets", async () => {
    const targets = buildStrongSuspectTargetSet(evaluations, { groups: 2, targets: 5 });
    const persisted: string[] = [];
    const captured = await captureFormulaBarSmoke(
      targets,
      (target) => sourceFor(target, target.expected_visible_text, target.expected_visible_text, "Z999"),
      async (target) => { persisted.push(target.key); },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ halt_batch: true, conflict_reason: "active_address_mismatch" });
    expect(persisted).toEqual([targets.targets[0].key]);
  });
});

function evaluation(
  evaluation_id: string,
  worksheet: string,
  source_row: number,
  source_column: string,
  comment: string,
) {
  return { evaluation_id, worksheet, source_row, source_column, comment };
}

function sourceFor(
  target: FormulaBarSmokeTarget,
  formulaValue: string,
  visibleText = target.expected_visible_text,
  activeAddress = target.address,
): FormulaBarCellSource {
  return {
    locateByAddressBox: async () => undefined,
    readActiveAddress: async () => activeAddress,
    readFormulaBar: async () => formulaValue,
    readVisibleCellText: async () => visibleText,
    captureEvidence: async ({ kind }) => ({
      kind,
      path: `${kind}/${target.worksheet}/${target.address}.png`,
      sha256: (kind === "cell" ? "a" : "b").repeat(64),
    }),
    now: () => "2026-07-29T08:00:00.000Z",
  };
}
