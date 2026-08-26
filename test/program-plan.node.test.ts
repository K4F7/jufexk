import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROGRAM_PLAN_CAPTURE_SCHEMA,
  PROGRAM_PLAN_RECORD_SCHEMA,
  assertProgramPlanCaptureSafe,
  attachProgramPlanDimensions,
  catalogTermToSuggestedTerm,
  deriveProgramPlanRecords,
  parseProgramPlanHtml,
  programPlanRowKey,
  uniqueProgramCourses,
  validateProgramPlanQueries,
} from "../src/lib/program-plan";
import {
  deriveProgramPlanFromCapturePackage,
  validateProgramPlanCapturePackage,
  writeProgramPlanCapturePackage,
} from "../src/lib/program-plan-capture";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures/jwxt");

function readFixture(name: string) {
  return readFileSync(join(fixtures, name), "utf8");
}

const softwareQuery = {
  schemaVersion: PROGRAM_PLAN_CAPTURE_SCHEMA,
  queryId: "grade-2025-0809021",
  grade: "2025",
  departmentCode: "054",
  departmentName: "软件与物联网工程学院",
  majorCode: "0809021",
  majorName: "软件工程",
  studyKind: "主修" as const,
  status: "complete" as const,
  declaredRecordCount: 5,
  capturedRecordCount: 5,
  pageCount: 1,
};

describe("program plan html", () => {
  it("parses 2025 software-engineering theoretical courses with term rowspan", () => {
    const parsed = parseProgramPlanHtml(readFixture("program-plan-software-2025.html"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.map((row) => row.courseCode)).toEqual([
      "1002300011",
      "1004600232",
      "1005406493",
      "1004600242",
      "1005406493",
    ]);
    expect(parsed.rows[1]).toMatchObject({
      courseName: "大学英语I",
      credits: 2,
      categoryPath: "2024公共课/公共外语课/必修课",
      courseStanding: "主干课程",
      suggestedTerm: "2025-2026学年第一学期",
      weeklyHours: 2,
    });
    expect(parsed.rows[2].suggestedTerm).toBe("2025-2026学年第一学期");
    expect(parsed.rows[3].suggestedTerm).toBe("2025-2026学年第二学期");
    expect(parsed.exceptions).toEqual([
      expect.objectContaining({ reason: "缺少课号", courseText: "没有课号的培养方案行" }),
    ]);
  });

  it("refuses login-expired pages", () => {
    const parsed = parseProgramPlanHtml("<html>请先登录 cas/login</html>");
    expect(parsed).toMatchObject({ ok: false, kind: "login-expired" });
  });
});

describe("program plan capture package", () => {
  it("derives stable row keys and keeps same course across suggested terms", () => {
    const html = readFixture("program-plan-software-2025.html");
    const first = deriveProgramPlanRecords([softwareQuery], [{ queryId: softwareQuery.queryId, html }]);
    const second = deriveProgramPlanRecords([softwareQuery], [{ queryId: softwareQuery.queryId, html }]);
    expect(first.records.map(programPlanRowKey)).toEqual(second.records.map(programPlanRowKey));
    expect(first.records.filter((row) => row.courseCode === "1005406493")).toHaveLength(2);
    expect(first.records[0]).toMatchObject({
      schemaVersion: PROGRAM_PLAN_RECORD_SCHEMA,
      grade: "2025",
      majorCode: "0809021",
      majorName: "软件工程",
      studyKind: "主修",
    });
    const unique = uniqueProgramCourses(first.records, "2025-2026学年第一学期");
    expect(unique.map((row) => row.courseCode)).toEqual([
      "1002300011",
      "1004600232",
      "1005406493",
      "1004600242",
    ]);
    expect(unique.find((row) => row.courseCode === "1005406493")?.suggestedTerm).toBe(
      "2025-2026学年第一学期",
    );
    expect(catalogTermToSuggestedTerm("2025-2026-1")).toBe("2025-2026学年第一学期");
    expect(catalogTermToSuggestedTerm("2025-2026-2")).toBe("2025-2026学年第二学期");
  });

  it("rejects credential-shaped capture HTML and duplicate query ids", () => {
    expect(() => assertProgramPlanCaptureSafe("Set-Cookie: CASTGC=abc", "page")).toThrow(/unsafe/);
    expect(() =>
      validateProgramPlanQueries([
        softwareQuery,
        { ...softwareQuery, queryId: softwareQuery.queryId },
      ]),
    ).toThrow(/duplicate query/);
  });

  it("hashes the same derived JSONL twice", () => {
    const html = readFixture("program-plan-software-2025.html");
    const parsed = parseProgramPlanHtml(html);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const attached = attachProgramPlanDimensions(parsed, softwareQuery);
    const jsonl = attached.records
      .map((row) => JSON.stringify(row))
      .join("\n");
    const left = createHash("sha256").update(jsonl).digest("hex");
    const right = createHash("sha256").update(jsonl).digest("hex");
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
  });

  it("writes and validates an independent capture package", async () => {
    const root = mkdtempSync(join(tmpdir(), "program-plan-capture-"));
    try {
      const html = readFixture("program-plan-software-2025.html");
      await writeProgramPlanCapturePackage(root, {
        batchId: "pilot-2025-software",
        status: "complete_with_exceptions",
        queries: [softwareQuery],
        snapshots: [{ queryId: softwareQuery.queryId, page: 1, html }],
      });
      const manifest = await validateProgramPlanCapturePackage(root);
      expect(manifest.schemaVersion).toBe(PROGRAM_PLAN_CAPTURE_SCHEMA);
      expect(manifest.files.map((file) => file.path)).toEqual([
        "queries.jsonl",
        `snapshots/${softwareQuery.queryId}/page-0001.html`,
      ]);
      const derived = await deriveProgramPlanFromCapturePackage(root);
      expect(derived.records.map((row) => row.courseCode)).toEqual([
        "1002300011",
        "1004600232",
        "1005406493",
        "1004600242",
        "1005406493",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
