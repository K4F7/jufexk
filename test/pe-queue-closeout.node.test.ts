import { describe, expect, it } from "vitest";
import {
  HISTORICAL_WITHHOLD_REASON,
  buildPeQueueCloseoutReport,
  catalogAdditionMapping,
  formatPeQueueCloseoutMarkdown,
  proposeHistoricalDisposition,
  reportContainsForbiddenPayload,
  type PeQueueRow,
} from "../src/lib/pe-queue-closeout";
import {
  assertCloseoutSelectSql,
  buildDispositionWriteSql,
  buildPeQueueCloseoutSelectSql,
} from "../scripts/pe-queue-closeout/sql";

const row = (label: string, courseCode = "PE-1"): PeQueueRow => ({
  courseId: 11,
  teacherId: 22,
  courseCode,
  courseName: "体育1",
  sourceTeacherLabel: label,
  reason: "umbrella_unmapped",
  disposition: null,
  dispositionReason: "",
  disposedBy: "",
  disposedAt: null,
});

describe("historical PE queue closeout proposals", () => {
  it("maps VIRTUAL_PE_SPORTS teachers and withholds unknown umbrellas", () => {
    const yoga = proposeHistoricalDisposition({
      row: row("黄丽萍"),
      evidence: [
        {
          kind: "virtual_pe_sports",
          specialization: "瑜伽",
          sourceCourseCode: "PE-1",
          sourceCourseName: "体育1",
          sourceTeacherLabel: "黄丽萍",
        },
      ],
    });
    expect(yoga).toMatchObject({
      disposition: "mapped",
      specialization: "瑜伽",
    });
    expect(yoga.mapping?.evidence.kind).toBe("virtual_pe_sports");

    const withheld = proposeHistoricalDisposition({
      row: row("未知教师"),
      evidence: [],
    });
    expect(withheld).toMatchObject({
      disposition: "withheld_permanent_exception",
      reason: HISTORICAL_WITHHOLD_REASON,
      mapping: null,
    });
  });

  it("marks conflicting evidence without guessing", () => {
    const conflict = proposeHistoricalDisposition({
      row: row("教师甲"),
      evidence: [
        {
          kind: "catalog_course_name",
          specialization: "篮球",
          sourceCourseCode: "PE-B",
          sourceCourseName: "篮球",
          sourceTeacherLabel: "教师甲",
        },
        {
          kind: "offering_skill_name",
          specialization: "乒乓球",
          sourceCourseCode: "PE-P",
          sourceCourseName: "乒乓球",
          sourceTeacherLabel: "教师甲",
        },
      ],
    });
    expect(conflict.disposition).toBe("conflict_recapture");
    expect(conflict.specialization).toBeNull();
  });
});

describe("catalog addition PE requirement", () => {
  it("requires a specialization for umbrella PE and auto-maps skill names", () => {
    expect(
      catalogAdditionMapping({
        kind: "course",
        courseCode: "PE-1",
        courseName: "体育1",
        sourceTeacherLabel: "教师甲",
      }),
    ).toEqual({ ok: false, error: "体育伞形课必须指定归一化具体专项名" });
    expect(
      catalogAdditionMapping({
        kind: "course",
        courseCode: "PE-1",
        courseName: "体育1",
        sourceTeacherLabel: "教师甲",
        peSpecialization: "瑜伽",
      }),
    ).toMatchObject({
      ok: true,
      mapping: {
        sourceKind: "umbrella",
        normalizedSpecialization: "瑜伽",
      },
    });
    expect(
      catalogAdditionMapping({
        kind: "course",
        courseCode: "PE-B",
        courseName: "篮球2",
        sourceTeacherLabel: "教师甲",
      }),
    ).toMatchObject({
      ok: true,
      mapping: {
        sourceKind: "direct_skill",
        normalizedSpecialization: "篮球",
      },
    });
    expect(
      catalogAdditionMapping({
        kind: "course",
        courseCode: "GEN-1",
        courseName: "高等数学",
        sourceTeacherLabel: "教师甲",
      }),
    ).toEqual({ ok: true, mapping: null });
  });
});

describe("sanitized closeout report", () => {
  it("omits cookies, CAS credentials, student ids and review bodies", () => {
    const report = buildPeQueueCloseoutReport({
      generatedAt: "2026-09-02T00:00:00.000Z",
      liveEnqueueEnabled: false,
      rows: [
        {
          courseCode: "PE-1",
          courseName: "体育1",
          sourceTeacherLabel: "黄丽萍",
          disposition: "mapped",
          specialization: "瑜伽",
          reason: "virtual_pe_sports:瑜伽",
        },
        {
          courseCode: "PE-2",
          courseName: "体育2",
          sourceTeacherLabel: "未知教师",
          disposition: "withheld_permanent_exception",
          reason: HISTORICAL_WITHHOLD_REASON,
        },
      ],
    });
    expect(report.counts).toEqual({
      mapped: 1,
      withheld: 1,
      conflict: 0,
      open: 0,
    });
    const markdown = formatPeQueueCloseoutMarkdown(report);
    expect(markdown).toContain("黄丽萍");
    expect(markdown).toContain("瑜伽");
    expect(reportContainsForbiddenPayload(markdown)).toBe(false);
    expect(markdown).not.toMatch(/CASTGC=|JSESSIONID=|submitter_hash/i);
  });
});

describe("closeout SELECT SQL", () => {
  it("is read-only and never selects review bodies", () => {
    const sql = buildPeQueueCloseoutSelectSql();
    expect(() => assertCloseoutSelectSql(sql)).not.toThrow();
    expect(sql).toContain("catalog_pe_specialization_review_queue");
    expect(sql).not.toMatch(/\bcomment\b/);
    expect(sql).not.toMatch(/\breviews\b/);
    expect(() =>
      assertCloseoutSelectSql("SELECT comment FROM public_historical_reviews"),
    ).toThrow(/评价正文|学生身份/);
    const writes = buildDispositionWriteSql([
      proposeHistoricalDisposition({ row: row("未知教师"), evidence: [] }),
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("withheld_permanent_exception");
    expect(writes[0]).toContain("course_id=11");
  });
});
