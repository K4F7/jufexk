import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverFilterFields,
  discoverTableId,
  findStudyKindValue,
  mapColumns,
  parseCourseCell,
  parseSelectOptions,
  tableGrid,
} from "./parse-table";

const fixture = await readFile(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "software-engineering-2025.html"), "utf8");

describe("program plan page adapter", () => {
  it("discovers 培养方案 filters, tableId, and 主修 from the fixture page", () => {
    const fields = discoverFilterFields(fixture);
    expect(fields).toMatchObject({
      grade: { id: "sel_nj", name: "nj" },
      department: { id: "sel_yxb", name: "dwh" },
      major: { id: "sel_zydm", name: "zydm" },
      direction: { id: "sel_zyfx", name: "zyfx" },
      studyKind: { id: "sel_zxfx", name: "zxfx" },
    });
    expect(discoverTableId(fixture)).toBe("6099001");
    expect(findStudyKindValue(fixture, fields!.studyKind!)).toBe("1");
    expect(parseSelectOptions(fixture, "sel_zydm")).toEqual([{ id: "080902", label: "软件工程" }]);
  });

  it("inherits 学年学期 across rowspan continuation rows and reads [课号]课名", () => {
    const grid = tableGrid(fixture)!;
    const columns = mapColumns(grid.headers)!;
    expect(grid.rows).toHaveLength(5);
    expect(grid.rows[0][columns.term]).toBe("2025-2026学年第一学期");
    expect(grid.rows[1][columns.term]).toBe("2025-2026学年第一学期");
    expect(parseCourseCell(grid.rows[0][columns.course])).toEqual({ courseCode: "10100001", courseName: "高等数学A" });
    expect(parseCourseCell(grid.rows[4][columns.course])).toBeUndefined();
  });

  it("only accepts a numeric course code in [课号]课名", () => {
    expect(parseCourseCell("[20800001]程序设计基础")).toEqual({ courseCode: "20800001", courseName: "程序设计基础" });
    expect(parseCourseCell("[AB12]不是数字课号")).toBeUndefined();
    expect(parseCourseCell("专业导论（缺课号）")).toBeUndefined();
  });
});
