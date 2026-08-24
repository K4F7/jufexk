import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { offeringKey } from "../src/lib/jwxt-offering";
import {
  emptyPlan,
  joinOffering,
  mergeEnrolledRefresh,
  parsePlan,
  setIncluded,
} from "../src/lib/jwxt-plan";
import {
  emptySnapshot,
  exportedJsonIsClean,
  importSnapshotText,
  serializeSnapshot,
  snapshotFromHtml,
} from "../src/lib/jwxt-snapshot";
import { parseJwxtTableHtml, parsePagination } from "../src/lib/jwxt-table";
import type { JwxtOffering } from "../src/lib/jwxt-offering";
import { defaultWeeks } from "../src/lib/schedule-plan";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures/jwxt");

function readFixture(name: string) {
  return readFileSync(join(fixtures, name), "utf8");
}

function offering(partial: Partial<JwxtOffering> & Pick<JwxtOffering, "courseCode" | "courseName" | "section">): JwxtOffering {
  return {
    credits: 3,
    categoryPath: "专业计划内",
    teacherName: "教师甲",
    campus: "校区甲",
    weekText: "1-16",
    timeText: "星期一 第1-2节",
    place: "A101",
    capacityLimit: 80,
    capacitySelected: 10,
    capacityAvailable: 70,
    enrollStatus: "",
    meetings: [
      { weekday: 1, startPeriod: 1, endPeriod: 2, weeks: defaultWeeks(), place: "A101" },
    ],
    catalogCourseId: null,
    catalogTeacherId: null,
    ...partial,
  };
}

describe("jwxt table fixtures", () => {
  it("parses S20301 enrolled rows with dictionaries", () => {
    const parsed = parseJwxtTableHtml(readFixture("s20301-enrolled.html"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.offerings.map((item) => item.courseName)).toEqual(["高等数学", "线性代数"]);
    expect(parsed.offerings[0].section).toBe("01");
    expect(parsed.offerings[0].meetings[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 2 });
    expect(parsed.filters.grades.map((item) => item.id)).toContain("2024");
    expect(parsed.filters.majors.map((item) => item.label)).toContain("数学与应用数学");
    expect(parsed.pagination).toMatchObject({ tableId: "S20301", total: 2 });
  });

  it("reads dynamic headers, rowspan, multi-teacher, odd/even weeks, multi-slot and no fixed time", () => {
    const dynamic = parseJwxtTableHtml(readFixture("dynamic-headers.html"));
    expect(dynamic.ok && dynamic.offerings[0]?.courseName).toBe("大学英语");
    expect(dynamic.ok && dynamic.offerings[0]?.timeText).toContain("星期二");

    const rowspan = parseJwxtTableHtml(readFixture("rowspan.html"));
    expect(rowspan.ok).toBe(true);
    if (rowspan.ok) {
      expect(rowspan.offerings).toHaveLength(1);
      expect(rowspan.offerings[0].meetings).toHaveLength(2);
      expect(rowspan.offerings[0].meetings[0].startPeriod).toBe(1);
      expect(rowspan.offerings[0].meetings[1].startPeriod).toBe(3);
    }

    const teachers = parseJwxtTableHtml(readFixture("multi-teacher.html"));
    expect(teachers.ok && teachers.offerings[0]?.teacherName).toContain("教师戊");
    expect(teachers.ok && teachers.offerings[0]?.teacherName).toContain("教师己");

    const weeks = parseJwxtTableHtml(readFixture("odd-even-weeks.html"));
    expect(weeks.ok && weeks.offerings[0]?.meetings[0]?.weeks.every((week) => week % 2 === 1)).toBe(true);
    expect(weeks.ok && weeks.offerings[1]?.meetings[0]?.weeks.every((week) => week % 2 === 0)).toBe(true);

    const multi = parseJwxtTableHtml(readFixture("multi-slot.html"));
    expect(multi.ok && multi.offerings[0]?.meetings).toHaveLength(2);

    const floating = parseJwxtTableHtml(readFixture("no-fixed-time.html"));
    expect(floating.ok && floating.offerings[0]?.courseName).toBe("毕业设计");
    expect(floating.ok && floating.offerings[0]?.meetings).toEqual([]);
  });

  it("covers pagination, login expiry and malformed credential rows", () => {
    expect(parsePagination(readFixture("pagination-page1.html"))).toMatchObject({
      tableId: "S2020103",
      page: 1,
      pages: 2,
      total: 3,
    });
    expect(parsePagination(readFixture("pagination-page2.html"))).toMatchObject({ page: 2, pages: 2 });
    const expired = parseJwxtTableHtml(readFixture("login-expired.html"));
    expect(expired).toMatchObject({ ok: false, kind: "login-expired" });
    const malformed = parseJwxtTableHtml(readFixture("malformed.html"));
    expect(malformed.ok).toBe(false);
  });

  it("round-trips fixtures through GBK without replacement characters", () => {
    for (const name of [
      "s20301-enrolled.html",
      "s2020103-planned.html",
      "s2020103-public.html",
      "rowspan.html",
    ]) {
      const utf8 = readFixture(name);
      expect(utf8).not.toContain("\uFFFD");
      const encoded = iconv.encode(utf8, "gbk");
      expect(iconv.decode(encoded, "gbk")).toContain("课程");
    }
  });
});

describe("snapshot import/export", () => {
  it("builds the same DTO from HTML fixtures and rejects secrets", () => {
    const enrolled = snapshotFromHtml(readFixture("s20301-enrolled.html"), "enrolled");
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    const planned = snapshotFromHtml(readFixture("s2020103-planned.html"), "planned", enrolled.snapshot);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const full = snapshotFromHtml(readFixture("s2020103-public.html"), "public", planned.snapshot);
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    const json = serializeSnapshot(full.snapshot);
    expect(exportedJsonIsClean(json)).toBe(true);
    expect(json).not.toMatch(/CASTGC|JSESSIONID|cookie|学号|姓名/i);
    const again = importSnapshotText(json);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.snapshot.enrolled.map((item) => item.courseName)).toEqual(["高等数学", "线性代数"]);
    expect(again.snapshot.planned).toHaveLength(2);
    expect(again.snapshot.publicElectives[0]?.courseName).toBe("书法鉴赏");
  });

  it("rejects JSON that smuggles cookies or student identity", () => {
    const dirty = {
      ...emptySnapshot(),
      enrolled: [offering({ courseCode: "1", courseName: "学号1234567890 高等数学", section: "01" })],
    };
    expect(importSnapshotText(JSON.stringify(dirty)).ok).toBe(false);
    expect(importSnapshotText(readFixture("login-expired.html"))).toMatchObject({
      ok: false,
      kind: "login-expired",
    });
  });
});

describe("plan v2", () => {
  it("migrates v1 courses to legacy origin", () => {
    const v1 = JSON.stringify({
      version: 1,
      courses: [
        {
          id: "8:9",
          courseId: 8,
          courseCode: "MA101",
          courseName: "高等数学",
          teacherId: 9,
          teacherName: "张三",
          rating: 4,
          reviewCount: 2,
          slots: [{ id: "s", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: defaultWeeks() }],
        },
      ],
    });
    const plan = parsePlan(v1);
    expect(plan.version).toBe(2);
    expect(plan.activeTermId).toBe("legacy");
    expect(plan.terms.legacy[0]).toMatchObject({
      origin: "legacy",
      courseName: "高等数学",
      included: true,
    });
  });

  it("isolates terms and keeps exclude across enrolled refresh", () => {
    const termA = "2025-2026-2";
    const termB = "2025-2026-1";
    let plan = emptyPlan(termA);
    const joined = joinOffering(plan, offering({ courseCode: "E1", courseName: "选修", section: "01", meetings: [
      { weekday: 5, startPeriod: 8, endPeriod: 9, weeks: defaultWeeks(), place: "" },
    ] }), "public", termA);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    plan = joined.plan;
    const snapshot = {
      ...emptySnapshot(),
      term: { id: termA, label: "2025-2026-2" },
      enrolled: [offering({ courseCode: "10100001", courseName: "高等数学", section: "01" })],
    };
    plan = mergeEnrolledRefresh(plan, snapshot);
    const mathKey = offeringKey(termA, "10100001", "01");
    plan = setIncluded(plan, mathKey, false, termA);
    const refreshed = {
      ...snapshot,
      enrolled: [offering({ courseCode: "10100001", courseName: "高等数学", section: "03", teacherName: "教师卯" })],
    };
    plan = mergeEnrolledRefresh(plan, refreshed);
    const math = plan.terms[termA].find((item) => item.courseCode === "10100001");
    expect(math?.section).toBe("03");
    expect(math?.included).toBe(false);
    expect(plan.terms[termB]).toBeUndefined();
    expect(plan.terms[termA].some((item) => item.courseName === "选修")).toBe(true);
  });

  it("atomically swaps the same course section and blocks week-intersect conflicts", () => {
    const termId = "2025-2026-2";
    let plan = emptyPlan(termId);
    const first = joinOffering(plan, offering({ courseCode: "C1", courseName: "微观经济学", section: "01" }), "planned", termId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    plan = first.plan;
    const swapped = joinOffering(
      plan,
      offering({
        courseCode: "C1",
        courseName: "微观经济学",
        section: "02",
        teacherName: "教师辰",
        meetings: [{ weekday: 4, startPeriod: 6, endPeriod: 7, weeks: defaultWeeks(), place: "" }],
      }),
      "planned",
      termId,
    );
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.swapped).toBe(true);
    expect(swapped.plan.terms[termId]).toHaveLength(1);
    expect(swapped.plan.terms[termId][0].section).toBe("02");
    const blocked = joinOffering(
      swapped.plan,
      offering({
        courseCode: "C2",
        courseName: "冲突课",
        section: "01",
        meetings: [{ weekday: 4, startPeriod: 6, endPeriod: 7, weeks: defaultWeeks(), place: "" }],
      }),
      "public",
      termId,
    );
    expect(blocked.ok).toBe(false);
  });
});
