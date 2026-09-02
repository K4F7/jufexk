import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertWranglerD1ReadOnly,
  createPeMappingAuditExecuteCommand,
  executePeMappingAuditSql,
  parseWorkerVersionId,
  parseWranglerD1ExecuteJson,
} from "../scripts/pe-mapping-audit/execute";
import {
  PE_MAPPING_AUDIT_SCHEMA,
  buildPeMappingAuditReport,
  coverageRate,
  formatPeMappingAuditMarkdown,
} from "../scripts/pe-mapping-audit/report";
import { reportFromQueryBatches } from "../scripts/pe-mapping-audit/run";
import {
  assertReadOnlySelectSql,
  buildPeMappingAuditSql,
  stripSqlStringsAndComments,
} from "../scripts/pe-mapping-audit/sql";
import {
  PE_SKILL_FAMILIES,
  UMBRELLA_PE_COURSE_NAMES,
  VIRTUAL_PE_SPORTS,
} from "../src/lib/public-course-presentation";

const fixtureExpected = [
  {
    course_id: 1,
    teacher_id: 10,
    course_code: "PE-BASKET2",
    course_name: "篮球2",
    source_teacher_label: "教师甲",
    source_kind: "direct_skill",
    expected_family: "篮球",
    mapped_specialization: "篮球",
    mapped_source_kind: "direct_skill",
    is_mapped: 1,
    in_queue: 0,
    queue_reason: null,
    virtual_sport_label: null,
    virtual_course_id: null,
  },
  {
    course_id: 2,
    teacher_id: 20,
    course_code: "PE-WUSHU",
    course_name: "武术",
    source_teacher_label: "刘春来",
    source_kind: "direct_skill",
    expected_family: "武术",
    mapped_specialization: "武术",
    mapped_source_kind: "direct_skill",
    is_mapped: 1,
    in_queue: 0,
    queue_reason: null,
    virtual_sport_label: "武术",
    virtual_course_id: 800002,
  },
  {
    course_id: 3,
    teacher_id: 30,
    course_code: "PE-1",
    course_name: "体育1",
    source_teacher_label: "黄丽萍",
    source_kind: "umbrella",
    expected_family: null,
    mapped_specialization: null,
    mapped_source_kind: null,
    is_mapped: 0,
    in_queue: 1,
    queue_reason: "umbrella_unmapped",
    virtual_sport_label: "瑜伽",
    virtual_course_id: 800001,
  },
  {
    course_id: 4,
    teacher_id: 30,
    course_code: "PE-2",
    course_name: "体育2",
    source_teacher_label: "黄丽萍",
    source_kind: "umbrella",
    expected_family: null,
    mapped_specialization: null,
    mapped_source_kind: null,
    is_mapped: 0,
    in_queue: 0,
    queue_reason: null,
    virtual_sport_label: "瑜伽",
    virtual_course_id: 800001,
  },
  {
    course_id: 5,
    teacher_id: 40,
    course_code: "PE-YOGA",
    course_name: "瑜伽",
    source_teacher_label: "教师乙",
    source_kind: "direct_skill",
    expected_family: "瑜伽",
    mapped_specialization: null,
    mapped_source_kind: null,
    is_mapped: 0,
    in_queue: 0,
    queue_reason: null,
    virtual_sport_label: null,
    virtual_course_id: null,
  },
  {
    course_id: 6,
    teacher_id: 20,
    course_code: "PE-3",
    course_name: "体育3",
    source_teacher_label: "刘春来",
    source_kind: "umbrella",
    expected_family: null,
    mapped_specialization: null,
    mapped_source_kind: null,
    is_mapped: 0,
    in_queue: 1,
    queue_reason: "umbrella_unmapped",
    virtual_sport_label: "武术",
    virtual_course_id: 800002,
  },
];

const fixtureQueue = [
  {
    course_id: 3,
    teacher_id: 30,
    course_code: "PE-1",
    course_name: "体育1",
    source_teacher_label: "黄丽萍",
    reason: "umbrella_unmapped",
  },
  {
    course_id: 6,
    teacher_id: 20,
    course_code: "PE-3",
    course_name: "体育3",
    source_teacher_label: "刘春来",
    reason: "umbrella_unmapped",
  },
  {
    course_id: 99,
    teacher_id: 99,
    course_code: "EXTRA",
    course_name: "体育4",
    source_teacher_label: "路人",
    reason: "umbrella_unmapped",
  },
];

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      collectKeys(item, keys);
    }
  }
  return keys;
}

describe("read-only PE mapping audit SQL", () => {
  it("emits SELECT/WITH only and reuses the #832 classifier predicates", () => {
    const sql = buildPeMappingAuditSql();
    expect(() => assertReadOnlySelectSql(sql)).not.toThrow();
    expect(sql.trim().startsWith("SELECT")).toBe(true);
    expect(sql).toContain("catalog_relation_pe_specializations");
    expect(sql).toContain("catalog_pe_specialization_review_queue");
    expect(sql).toContain("course_teachers");
    for (const name of UMBRELLA_PE_COURSE_NAMES) {
      expect(sql).toContain(`'${name}'`);
    }
    for (const family of PE_SKILL_FAMILIES) {
      expect(sql).toContain(`THEN '${family.label}'`);
    }
    for (const sport of VIRTUAL_PE_SPORTS) {
      expect(sql).toContain(`THEN '${sport.label}'`);
      expect(sql).toContain(`THEN ${sport.id}`);
      for (const name of sport.teacherNames) {
        expect(sql).toContain(`'${name}'`);
      }
    }
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\breviews\b/i);
  });

  it("refuses mutating SQL even when mixed with SELECT or hidden in comments", () => {
    expect(() => assertReadOnlySelectSql("SELECT 1; DELETE FROM courses")).toThrow(
      /只读|SELECT/,
    );
    expect(() => assertReadOnlySelectSql("INSERT INTO t VALUES (1)")).toThrow(/只读/);
    expect(() =>
      assertReadOnlySelectSql("WITH x AS (SELECT 1) UPDATE teachers SET name='x'"),
    ).toThrow(/只读|SELECT/);
    expect(() => assertReadOnlySelectSql("SELECT 1 FROM reviews")).toThrow(/评价|身份/);
    expect(stripSqlStringsAndComments("SELECT 'DELETE'")).not.toMatch(/\bDELETE\b/);
    expect(() => assertReadOnlySelectSql("SELECT 'DELETE'")).not.toThrow();
  });
});

describe("PE mapping audit coverage arithmetic", () => {
  const report = buildPeMappingAuditReport({
    expectedRows: fixtureExpected,
    queueRows: fixtureQueue,
    mappingRows: 3,
    meta: {
      auditedAt: "2026-09-02T00:00:00.000Z",
      deploySha: "c08ebe05824c1d4dcf03fa061385c6ea4c6657fe",
      workerVersionId: "version-abc",
    },
  });

  it("locks coverage rate, queue counts, and yoga/wushu breakouts", () => {
    expect(coverageRate(2, 6)).toEqual({ rate: 2 / 6, percent: "33.33%" });
    expect(coverageRate(0, 0)).toEqual({ rate: 0, percent: "0.00%" });
    expect(report.schemaVersion).toBe(PE_MAPPING_AUDIT_SCHEMA);
    expect(report.readOnly).toBe(true);
    expect(report.coverage).toMatchObject({
      numerator: 2,
      denominator: 6,
      rate: 2 / 6,
      percent: "33.33%",
      mappingTableRows: 3,
      extraMappings: 1,
    });
    expect(report.queue).toMatchObject({
      total: 3,
      unprocessed: 3,
      staleMapped: 0,
      orphanNotExpected: 1,
    });
    expect(report.status).toEqual({
      allExpectedMapped: false,
      unmappedUmbrellaAllQueued: false,
      noUntrackedGaps: false,
      queueEmpty: false,
    });
    expect(report.yoga).toMatchObject({
      mapped: 0,
      unmappedExpected: 3,
      virtualTeacherUnmapped: 2,
    });
    expect(report.wushu).toMatchObject({
      mapped: 1,
      unmappedExpected: 1,
      virtualTeacherUnmapped: 1,
    });
    expect(report.unmappedExpectedSources.map((row) => row.courseCode)).toEqual([
      "PE-1",
      "PE-2",
      "PE-3",
      "PE-YOGA",
    ]);
    expect(report.unmappedUmbrellaMissingQueue).toEqual([
      {
        courseId: 4,
        teacherId: 30,
        courseCode: "PE-2",
        courseName: "体育2",
        sourceTeacherLabel: "黄丽萍",
        sourceKind: "umbrella",
      },
    ]);
    expect(report.gapsNeitherMappingNorQueue.map((row) => row.courseCode)).toEqual([
      "PE-2",
      "PE-YOGA",
    ]);
    expect(
      report.unmappedVirtualPeSports.map((row) => [
        row.courseCode,
        row.virtualSportLabel,
        row.virtualCourseId,
      ]),
    ).toEqual([
      ["PE-1", "瑜伽", 800001],
      ["PE-2", "瑜伽", 800001],
      ["PE-3", "武术", 800002],
    ]);
    const basketball = report.specializations.find(
      (item) => item.normalizedSpecialization === "篮球",
    );
    expect(basketball).toEqual({
      normalizedSpecialization: "篮球",
      mapped: 1,
      expectedDirectSkill: 1,
      unmappedExpected: 0,
    });
    expect(report.specializations.map((item) => item.normalizedSpecialization)).toEqual(
      PE_SKILL_FAMILIES.map((family) => family.label),
    );
  });

  it("locks the JSON shape and omits review bodies, cookies, and student identity", () => {
    expect(Object.keys(report).sort()).toEqual([
      "auditedAt",
      "coverage",
      "dataScope",
      "deploySha",
      "gapsNeitherMappingNorQueue",
      "queue",
      "readOnly",
      "schemaVersion",
      "specializations",
      "status",
      "unmappedExpectedSources",
      "unmappedUmbrellaMissingQueue",
      "unmappedVirtualPeSports",
      "workerVersionId",
      "wushu",
      "yoga",
    ]);
    expect(Object.keys(report.coverage).sort()).toEqual([
      "definition",
      "denominator",
      "extraMappings",
      "mappingTableRows",
      "numerator",
      "percent",
      "rate",
    ]);
    const keys = [...collectKeys(report)];
    expect(keys).not.toEqual(
      expect.arrayContaining([
        "note",
        "comment",
        "email",
        "cookie",
        "evidence_json",
        "html",
        "studentId",
        "student_id",
      ]),
    );
    const markdown = formatPeMappingAuditMarkdown(report);
    expect(markdown).toContain("33.33%");
    expect(markdown).toContain("## 瑜伽");
    expect(markdown).toContain("## 武术");
    expect(markdown).toContain("未处理: 3");
    expect(markdown).toContain("c08ebe05824c1d4dcf03fa061385c6ea4c6657fe");
    expect(markdown).not.toMatch(/CASTGC|JSESSIONID|Set-Cookie/i);
  });
});

describe("PE mapping audit wrangler invocation", () => {
  it("runs wrangler d1 execute --remote --json --command without pnpm nesting", () => {
    const sql = buildPeMappingAuditSql();
    const command = createPeMappingAuditExecuteCommand({
      sql,
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
      "--command",
      sql,
    ]);
    expect(command.args).not.toContain("pnpm");
  });

  it("does not call wrangler when SQL is not read-only", async () => {
    const execFile = vi.fn();
    await expect(
      executePeMappingAuditSql({
        sql: "DELETE FROM catalog_relation_pe_specializations",
        remote: true,
        execFile,
      }),
    ).rejects.toThrow(/只读|SELECT/);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("parses wrangler JSON result sets and rejects writes", () => {
    const batches = parseWranglerD1ExecuteJson(`
log prefix
[{"results":[{"n":1}],"success":true,"meta":{"changes":0,"rows_written":0}},{"results":[],"success":true,"meta":{"changed_db":false}}]
`);
    expect(batches).toHaveLength(2);
    expect(() => assertWranglerD1ReadOnly(batches)).not.toThrow();
    expect(() =>
      assertWranglerD1ReadOnly([
        { results: [], success: true, meta: { changes: 1, rows_written: 1 } },
      ]),
    ).toThrow(/写入/);
    expect(
      parseWorkerVersionId(
        JSON.stringify([
          {
            id: "6152e69a-566b-4715-ba57-f49d17709a7d",
            created_on: "2026-09-01T16:37:08.814844Z",
            versions: [{ version_id: "a0648442-6f38-4546-9d0e-0a7206fb51ee", percentage: 100 }],
          },
          {
            id: "b864f164-8f1e-4e00-84f4-ab47dd39c1dd",
            created_on: "2026-09-01T22:15:18.498722Z",
            versions: [{ version_id: "005aff8c-c4dd-4127-98b2-297116b6fe68", percentage: 100 }],
          },
        ]),
      ),
    ).toBe("005aff8c-c4dd-4127-98b2-297116b6fe68");
  });

  it("rebuilds the report from three wrangler result sets", () => {
    const report = reportFromQueryBatches(
      [
        { results: fixtureExpected },
        { results: fixtureQueue },
        { results: [{ mapping_rows: 3 }] },
      ],
      {
        auditedAt: "2026-09-02T00:00:00.000Z",
        deploySha: "abc",
        workerVersionId: null,
      },
    );
    expect(report.coverage.percent).toBe("33.33%");
    expect(report.queue.unprocessed).toBe(3);
  });
});
