import { describe, expect, it } from "vitest";
import type { CompiledCell, ReviewPackage } from "./review_package";
import {
  buildHumanQueue,
  compileApprovedFromDecisions,
  csvToDecisionItems,
  humanQueueCsv,
  humanQueueReason,
  isHumanQueueCandidate,
  parseDecisionRecords,
  parseHumanDecision,
  type LaneSource,
} from "./human_queue";

function cell(overrides: Partial<CompiledCell> & Pick<CompiledCell, "key">): CompiledCell {
  const [, row, column] = overrides.key.split("|");
  return {
    worksheet: overrides.worksheet ?? "MOOC",
    row: Number(row),
    column: column ?? "G",
    terminal_status: "review_origin",
    routing: "pending_review",
    unresolved_reason: null,
    recovery_condition: null,
    formula_bar_value: "公式栏原文",
    formula_bar_text_sha256: "a".repeat(64),
    formula_bar_visual_conflict: false,
    body_source: "formula_bar",
    context: { row: Number(row), course: "翻译理论与实践", teacher: "曾剑平", worksheet: "MOOC" },
    cell_image: "D:/evidence/G10-cell.jpg",
    conflict_image: null,
    ocr: null,
    conclusion: "agreed",
    selected: "analysis_a",
    approved: false,
    ...overrides,
  };
}

function pkg(cells: CompiledCell[], worksheet = "MOOC"): LaneSource {
  const compiled: ReviewPackage = {
    contract_version: "legacy-review-package-v1",
    input_sha256: "b".repeat(64),
    status: "completed_with_exceptions",
    planned_cells: cells.length,
    routed_cells: cells.filter((item) => item.routing !== "not_applicable").length,
    unresolved_cells: cells.filter((item) => item.conclusion === "unresolved").length,
    approved_cells: cells.filter((item) => item.approved).length,
    cells,
  };
  return {
    worksheet,
    package_path: `D:/pkg/${worksheet}/package.json`,
    inventory_status: "empty",
    pending_cells: 0,
    pending_verify_cells: 0,
    pkg: compiled,
  };
}

describe("human queue from closed review packages", () => {
  it("queues only unapproved, applicable cells and keeps the formula-bar body", () => {
    const queue = buildHumanQueue([
      pkg([
        cell({ key: "MOOC|10|G", approved: false, conclusion: "agreed" }),
        cell({ key: "MOOC|8|G", approved: true, conclusion: "agreed" }),
        cell({
          key: "MOOC|9|K",
          routing: "not_applicable",
          conclusion: "not_applicable",
          formula_bar_value: "",
          cell_image: null,
        }),
      ]),
    ]);
    expect(queue.queue_cells).toBe(1);
    expect(queue.auto_approved_cells).toBe(1);
    expect(queue.items[0]).toMatchObject({
      key: "MOOC|10|G",
      formula_bar_value: "公式栏原文",
      course: "翻译理论与实践",
      teacher: "曾剑平",
      reason: "verification_failed",
      decision: "",
      cell_image: "D:/evidence/G10-cell.jpg",
    });
    expect(queue.items[0].formula_bar_value).not.toContain("通顺");
  });

  it("classifies unresolved and mapping failures", () => {
    expect(humanQueueReason(cell({
      key: "主要课程|56|H",
      conclusion: "unresolved",
      unresolved_reason: "arbitration_unresolved",
    }))).toBe("unresolved");
    expect(humanQueueReason(cell({
      key: "主要课程|1|A",
      conclusion: "unresolved",
      unresolved_reason: "missing_context",
    }))).toBe("missing_context");
    expect(humanQueueReason(cell({
      key: "主要课程|155|J",
      conclusion: "arbitrated",
      approval: { key: "主要课程|155|J", approve: false, body_matches_source: true, mapping_supported: false, evidence: "no" },
    }))).toBe("mapping_unsupported");
    expect(isHumanQueueCandidate(cell({ key: "MOOC|8|G", approved: true }))).toBe(false);
  });

  it("does not mix an unfinished worksheet into the queue", () => {
    const queue = buildHumanQueue([
      {
        worksheet: "思政课",
        package_path: "D:/pkg/思政课/package.json",
        inventory_status: "ready",
        pending_cells: 0,
        pending_verify_cells: 1,
        pkg: pkg([cell({ key: "思政课|27|M", worksheet: "思政课" })]).pkg,
      },
      pkg([cell({ key: "MOOC|10|G" })], "MOOC"),
    ]);
    expect(queue.excluded_open_worksheets).toEqual([
      { worksheet: "思政课", reason: "1 pending image-text verification cells" },
    ]);
    expect(queue.items.map((item) => item.key)).toEqual(["MOOC|10|G"]);
  });

  it("writes a human table with a decision column and clickable image path", () => {
    const queue = buildHumanQueue([pkg([cell({ key: "MOOC|10|G" })])]);
    const csv = humanQueueCsv(queue);
    expect(csv).toContain("公式栏原文");
    expect(csv).toContain("决定");
    expect(csv).toContain("D:/evidence/G10-cell.jpg");
    expect(csv).not.toContain("MOOC|8|G");
  });

  it("compiles auto-approved cells plus explicit human decisions only", () => {
    const lanes = [
      pkg([
        cell({ key: "MOOC|8|G", approved: true }),
        cell({ key: "MOOC|10|G", approved: false }),
        cell({ key: "MOOC|10|H", approved: false }),
      ]),
    ];
    const compiled = compileApprovedFromDecisions(lanes, [
      { key: "MOOC|10|G", decision: "pass", note: "" },
      { key: "MOOC|10|H", decision: "reject", note: "画面不够" },
    ]);
    expect(compiled.auto_approved_cells).toBe(1);
    expect(compiled.human_passed_cells).toBe(1);
    expect(compiled.excluded_cells).toBe(1);
    expect(compiled.evaluations.map((item) => item.key)).toEqual(["MOOC|10|G", "MOOC|8|G"]);
    expect(compiled.evaluations.find((item) => item.key === "MOOC|10|G")?.body).toBe("公式栏原文");
    expect(compiled.excluded[0]).toMatchObject({ key: "MOOC|10|H", decision: "reject" });
    expect(compiled.courses).toEqual([{ course_label: "翻译理论与实践" }]);
  });

  it("reads 通过/驳回/跳过 from the human table, including multiline formula-bar text", () => {
    expect(parseHumanDecision("通过")).toBe("pass");
    const csv = humanQueueCsv(buildHumanQueue([pkg([cell({ key: "MOOC|10|G", formula_bar_value: "第一行\n第二行" })])]));
    expect(csv).toContain("第一行\n第二行");
    const decided = csv.replace("\"verification_failed\",\"\",\"\"", "\"verification_failed\",\"通过\",\"\"");
    expect(parseDecisionRecords(csvToDecisionItems(decided))).toEqual([
      { key: "MOOC|10|G", decision: "pass", note: "" },
    ]);
  });
});
