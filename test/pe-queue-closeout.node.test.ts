import { describe, expect, it } from "vitest";
import {
  FAMILY_EXPANSION_CLOSEOUT_ACTOR,
  HISTORICAL_WITHHOLD_REASON,
  UMBRELLA_UNATTRIBUTABLE_MULTI_SKILL_REASON,
  buildPeQueueCloseoutReport,
  catalogAdditionMapping,
  formatPeQueueCloseoutMarkdown,
  isNoOpCloseoutProposal,
  proposeHistoricalDisposition,
  reportContainsForbiddenPayload,
  type PeQueueRow,
} from "../src/lib/pe-queue-closeout";
import { resolve } from "node:path";
import { createWranglerD1ExecuteFileCommand } from "../scripts/pe-mapping-audit/execute";
import {
  assertCloseoutSelectSql,
  buildDirectSkillMappingWriteSql,
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

  it("maps unique 跆拳道 siblings and conflicts 游泳+跆拳道", () => {
    const taekwondo = proposeHistoricalDisposition({
      row: { ...row("肖舒鹏"), disposition: "withheld_permanent_exception" },
      evidence: [
        {
          kind: "catalog_course_name",
          specialization: "跆拳道",
          sourceCourseCode: "PE-TKD2",
          sourceCourseName: "跆拳道2",
          sourceTeacherLabel: "肖舒鹏",
        },
      ],
    });
    expect(taekwondo).toMatchObject({
      disposition: "mapped",
      specialization: "跆拳道",
    });

    const conflict = proposeHistoricalDisposition({
      row: { ...row("谢辉"), disposition: "withheld_permanent_exception" },
      evidence: [
        {
          kind: "catalog_course_name",
          specialization: "游泳",
          sourceCourseCode: "PE-SWIM",
          sourceCourseName: "游泳",
          sourceTeacherLabel: "谢辉",
        },
        {
          kind: "catalog_course_name",
          specialization: "跆拳道",
          sourceCourseCode: "PE-TKD",
          sourceCourseName: "跆拳道",
          sourceTeacherLabel: "谢辉",
        },
      ],
    });
    expect(conflict.disposition).toBe("conflict_recapture");
    expect(conflict.specialization).toBeNull();
  });

  it("conflicts 游泳+田径 without guessing", () => {
    const track = proposeHistoricalDisposition({
      row: { ...row("赵翔"), disposition: "withheld_permanent_exception" },
      evidence: [
        {
          kind: "catalog_course_name",
          specialization: "游泳",
          sourceCourseCode: "PE-SWIM",
          sourceCourseName: "游泳",
          sourceTeacherLabel: "赵翔",
        },
        {
          kind: "catalog_course_name",
          specialization: "田径",
          sourceCourseCode: "PE-TRACK",
          sourceCourseName: "田径1（体适能为主）",
          sourceTeacherLabel: "赵翔",
        },
      ],
    });
    expect(track.disposition).toBe("conflict_recapture");
    expect(track.reason).toContain("游泳");
    expect(track.reason).toContain("田径");
  });

  it("withholds 张晓英 umbrellas instead of guessing 篮球 or 排球", () => {
    const withheld = proposeHistoricalDisposition({
      row: {
        ...row("张晓英"),
        disposition: "conflict_recapture",
        dispositionReason: "conflicting specialization evidence: 篮球、排球",
      },
      evidence: [
        {
          kind: "catalog_course_name",
          specialization: "篮球",
          sourceCourseCode: "PE-B",
          sourceCourseName: "篮球",
          sourceTeacherLabel: "张晓英",
        },
        {
          kind: "catalog_course_name",
          specialization: "排球",
          sourceCourseCode: "PE-V",
          sourceCourseName: "排球",
          sourceTeacherLabel: "张晓英",
        },
      ],
    });
    expect(withheld.disposition).toBe("withheld_permanent_exception");
    expect(withheld.specialization).toBeNull();
    expect(withheld.mapping).toBeNull();
    expect(withheld.reason).toContain(UMBRELLA_UNATTRIBUTABLE_MULTI_SKILL_REASON);
    expect(withheld.reason).toContain("篮球");
    expect(withheld.reason).toContain("排球");
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
        courseCode: "PE-TKD2",
        courseName: "跆拳道2",
        sourceTeacherLabel: "教师甲",
      }),
    ).toMatchObject({
      ok: true,
      mapping: {
        sourceKind: "direct_skill",
        normalizedSpecialization: "跆拳道",
      },
    });
    expect(
      catalogAdditionMapping({
        kind: "course",
        courseCode: "PE-SWIM",
        courseName: "游泳",
        sourceTeacherLabel: "教师甲",
      }),
    ).toMatchObject({
      ok: true,
      mapping: {
        sourceKind: "direct_skill",
        normalizedSpecialization: "游泳",
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
    expect(sql).toContain("disposition_reason");
    expect(sql).toContain("course_teachers");
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
    expect(writes[0]).toContain("withheld_permanent_exception");
    expect(writes[0]).toContain("conflict_recapture");
    expect(writes[0]).not.toContain("AND disposition IS NULL");
    expect(writes[0]).toContain(FAMILY_EXPANSION_CLOSEOUT_ACTOR);

    const unchanged = proposeHistoricalDisposition({
      row: {
        ...row("未知教师"),
        disposition: "withheld_permanent_exception",
        dispositionReason: HISTORICAL_WITHHOLD_REASON,
      },
      evidence: [],
    });
    expect(isNoOpCloseoutProposal(unchanged)).toBe(true);
    expect(buildDispositionWriteSql([unchanged])).toEqual([]);

    const mappedRow = proposeHistoricalDisposition({
      row: { ...row("黄丽萍"), disposition: "mapped", dispositionReason: "virtual_pe_sports:瑜伽" },
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
    expect(isNoOpCloseoutProposal(mappedRow)).toBe(true);
    expect(buildDispositionWriteSql([mappedRow])).toEqual([]);

    const skillWrites = buildDirectSkillMappingWriteSql([
      {
        courseId: 101,
        teacherId: 201,
        courseCode: "PE-TKD2",
        courseName: "跆拳道2",
        sourceTeacherLabel: "肖舒鹏",
      },
    ]);
    expect(skillWrites).toHaveLength(1);
    expect(skillWrites[0]).toContain("INSERT OR IGNORE");
    expect(skillWrites[0]).toContain("'跆拳道'");
    expect(skillWrites[0]).toContain("'direct_skill'");
  });

  it("applies write batches through wrangler --file, not --command", () => {
    const command = createWranglerD1ExecuteFileCommand({
      file: "batch.sql",
      remote: true,
      nodeExecutable: "node-for-test",
      resolvePackage: () => resolve("node_modules/wrangler/package.json"),
    });
    expect(command.args).toEqual([
      resolve("node_modules/wrangler/bin/wrangler.js"),
      "d1",
      "execute",
      "jufexk",
      "--remote",
      "--json",
      "-y",
      "--file",
      "batch.sql",
    ]);
    expect(command.args).not.toContain("--command");
  });
});
