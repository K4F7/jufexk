import { describe, expect, it } from "vitest";
import {
  LOCATOR_CLICK_GRID,
  classifyLocator,
  type LocatorClassificationInput,
} from "./locator_classification";

const FORMULA_BAR_TEXT = "公式栏原文：老师讲得很清楚，作业量适中，期末突击也能过。";
const REVIEW_BODY = "评价正文：课堂节奏偏快，但答疑认真，给分按平时表现。";

type InputKeys = keyof LocatorClassificationInput;
type ForbiddenInputKeys = Extract<InputKeys, "formula_bar_value" | "formula_bar_text" | "review_body" | "body" | "visible_cell_text" | "comment">;
const _noBodyFields: ForbiddenInputKeys extends never ? true : never = true;
void _noBodyFields;

function classify(overrides: Partial<LocatorClassificationInput> & Pick<LocatorClassificationInput, "target" | "active_addresses">) {
  return classifyLocator({
    formula_bar_nonempty: true,
    role: "review",
    worksheet: "数学课",
    move: "address_box",
    ...overrides,
  });
}

describe("locator classification", () => {
  it("accepts a cell only when both active addresses match the target", () => {
    const result = classify({
      target: "A7",
      active_addresses: ["A7", "A7"],
      role: "course",
      worksheet: "数学课",
    });

    expect(result).toEqual({
      kind: "accepted",
      target: "A7",
      active: "A7",
      click_grid: false,
      wrote_tencent_or_business_db: false,
    });
    expect(result.click_grid).toBe(LOCATOR_CLICK_GRID);
    expect(LOCATOR_CLICK_GRID).toBe(false);
  });

  it("classifies a course-name landing on the confirmed 课程锚点 as merge_inherit and keeps target and active", () => {
    const result = classify({
      target: "A7",
      active_addresses: ["A6", "A6"],
      formula_bar_nonempty: true,
      role: "course",
      worksheet: "数学课",
    });

    expect(result).toEqual({
      kind: "merge_inherit",
      target: "A7",
      active: "A6",
      course_anchor: "A6",
      click_grid: false,
      wrote_tencent_or_business_db: false,
    });
    expect(result).not.toHaveProperty("halt_batch");
    expect(result.kind).not.toBe("accepted");
    expect(result.kind).not.toBe("stop_return_address_box");
    expect(result.kind).not.toBe("blocked_locator");
  });

  it("does not inherit a course-name miss that is not the confirmed 课程锚点", () => {
    const result = classify({
      target: "A7",
      active_addresses: ["A6", "A6"],
      role: "course",
      confirmed_course_anchor: "A5",
    });

    expect(result.kind).toBe("stop_return_address_box");
    expect(result).not.toHaveProperty("course_anchor");
  });

  it("does not treat teacher or review landings on a 课程锚点 as merge_inherit", () => {
    for (const role of ["teacher", "review"] as const) {
      const result = classify({
        target: "A7",
        active_addresses: ["A6", "A6"],
        role,
        confirmed_course_anchor: "A6",
      });
      expect(result.kind).toBe("stop_return_address_box");
      expect(result).not.toHaveProperty("course_anchor");
    }
  });

  it("stops ArrowRight on the wrong row or column and returns to the address box", () => {
    const result = classify({
      target: "B7",
      active_addresses: ["B5", "B5"],
      formula_bar_nonempty: false,
      role: "teacher",
      worksheet: "数学课",
      move: "arrow_right",
      origin: "A7",
    });

    expect(result).toEqual({
      kind: "stop_return_address_box",
      target: "B7",
      active: "B5",
      next_action: "address_box",
      click_grid: false,
      wrote_tencent_or_business_db: false,
    });
    expect(result.kind).toBe("stop_return_address_box");
    if (result.kind !== "stop_return_address_box") throw new Error("expected stop_return_address_box");
    expect(result.next_action).toBe("address_box");
    expect(result.next_action).not.toBe("arrow_right");
    expect(result).not.toHaveProperty("move");
    expect(Object.values(result)).not.toContain("arrow_right");
  });

  it("blocks MOOC G46 when the active address is not G46 and does not expand a row plan", () => {
    const result = classify({
      target: "G46",
      active_addresses: ["G47", "G47"],
      formula_bar_nonempty: false,
      role: "review",
      worksheet: "MOOC",
    });

    expect(result).toEqual({
      kind: "blocked_locator",
      target: "G46",
      active: "G47",
      stay_at_probe: true,
      click_grid: false,
      wrote_tencent_or_business_db: false,
    });
    expect(result).not.toHaveProperty("row_plan");
    expect(result).not.toHaveProperty("columns");
    expect(result).not.toHaveProperty("remaining_cells");
    expect(JSON.stringify(result)).not.toMatch(/H46|I46|J46|K46|L46|M46|N46/);
  });

  it("does not accept disagreeing active addresses", () => {
    const result = classify({
      target: "A7",
      active_addresses: ["A7", "B7"],
      role: "course",
    });

    expect(result.kind).not.toBe("accepted");
    expect(result).toMatchObject({
      kind: "stop_return_address_box",
      target: "A7",
      active: "B7",
      next_action: "address_box",
    });
  });

  it("keeps a MOOC G46 double-read mismatch blocked instead of accepted", () => {
    const result = classify({
      target: "G46",
      active_addresses: ["G46", "G47"],
      role: "review",
      worksheet: "MOOC",
    });

    expect(result.kind).not.toBe("accepted");
    expect(result.kind).toBe("blocked_locator");
    expect(result).toMatchObject({ target: "G46", active: "G47", stay_at_probe: true });
  });

  it("omits formula-bar text and review body from the classification result", () => {
    const result = classify({
      target: "L51",
      active_addresses: ["L51", "L51"],
      formula_bar_nonempty: true,
      role: "review",
      worksheet: "主要课程",
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(FORMULA_BAR_TEXT);
    expect(serialized).not.toContain(REVIEW_BODY);
    expect(result).not.toHaveProperty("formula_bar_value");
    expect(result).not.toHaveProperty("formula_bar_text");
    expect(result).not.toHaveProperty("review_body");
    expect(result).not.toHaveProperty("body");
    expect(result).not.toHaveProperty("visible_cell_text");
    expect(result).not.toHaveProperty("comment");
    expect(() => classifyLocator({
      target: "L51",
      active_addresses: ["L51", "L51"],
      formula_bar_nonempty: true,
      role: "review",
      worksheet: "主要课程",
    })).not.toThrow();
  });

  it("rejects a non-boolean formula_bar_nonempty instead of accepting formula text", () => {
    expect(() => classifyLocator({
      target: "A7",
      active_addresses: ["A7", "A7"],
      formula_bar_nonempty: FORMULA_BAR_TEXT as unknown as boolean,
      role: "course",
      worksheet: "数学课",
    })).toThrow("formula_bar_nonempty must be a boolean");
  });

  it("never authorizes clicking the grid", () => {
    const results = [
      classify({ target: "A7", active_addresses: ["A7", "A7"], role: "course" }),
      classify({
        target: "A7",
        active_addresses: ["A6", "A6"],
        role: "course",
        confirmed_course_anchor: "A6",
      }),
      classify({
        target: "B7",
        active_addresses: ["B5", "B5"],
        move: "arrow_right",
        origin: "A7",
        role: "teacher",
      }),
      classify({
        target: "G46",
        active_addresses: ["G47", "G47"],
        worksheet: "MOOC",
      }),
    ];

    for (const result of results) {
      expect(result.click_grid).toBe(false);
      expect(Object.values(result)).not.toContain("click_grid");
      expect(result).not.toMatchObject({ next_action: "click_grid" });
    }
    expect(LOCATOR_CLICK_GRID).toBe(false);
  });
});
