import { describe, expect, it } from "vitest";
import {
  applyScheduleOfferingRows,
  catalogBrowseSnapshot,
  catalogFiltersReady,
  catalogScheduleGrades,
  catalogScheduleMajors,
  catalogScheduleTerms,
  catalogTeacherSection,
  currentCatalogTermId,
  displaySection,
  matchDepartmentForMajor,
  isCatalogPublicElective,
  offeringsFromScheduleRows,
  programPlanCourseToOffering,
  relationToOffering,
  replaceCourseOfferings,
  uniqueOfferingsByCourseCode,
} from "../src/lib/catalog-schedule";
import type { CourseRelation } from "../src/lib/types";

const relation = (partial: Partial<CourseRelation> & Pick<CourseRelation, "course_id" | "code" | "name">): CourseRelation => ({
  category: "general",
  department: "数学学院",
  teacher_id: 9,
  teacher_name: "教师甲",
  rating: 4.2,
  review_count: 6,
  ...partial,
});

describe("catalog schedule helpers", () => {
  it("builds current JUFE terms and grades from the calendar", () => {
    const now = new Date("2026-08-26T00:00:00+08:00");
    expect(currentCatalogTermId(now)).toBe("2026-2027-1");
    expect(catalogScheduleTerms(now).map((item) => item.id)).toContain("2026-2027-1");
    expect(catalogScheduleGrades(now)[0]).toEqual({ id: "2026", label: "2026级" });
    expect(catalogFiltersReady({ id: "2026", label: "2026级" }, { id: "", label: "" })).toBe(false);
    expect(catalogFiltersReady({ id: "2026", label: "2026级" }, { id: "会计学", label: "会计学" })).toBe(true);
  });

  it("lists undergraduate majors and matches their home-unit departments", () => {
    const labels = catalogScheduleMajors().map((item) => item.label);
    expect(labels).toContain("会计学");
    expect(labels).toContain("数学与应用数学");
    expect(labels).not.toContain("宣传部、融媒体中心");
    expect(matchDepartmentForMajor("会计学", ["[002]宣传部、融媒体中心", "[040]会计学院"])).toBe("[040]会计学院");
    expect(matchDepartmentForMajor("数学与应用数学", ["信息管理学院", "数学学院"])).toBe("数学学院");
    expect(matchDepartmentForMajor("信息管理与信息系统", ["信息管理学院", "数学学院"])).toBe("信息管理学院");
    expect(matchDepartmentForMajor("会计学", ["[023]教务处"])).toBe("");
    expect(isCatalogPublicElective("sports")).toBe(true);
    expect(isCatalogPublicElective("general")).toBe(false);
  });

  it("turns a catalog relation into an offering without inventing meeting times", () => {
    const offering = relationToOffering(relation({ course_id: 8, code: "10100001", name: "高等数学" }));
    expect(offering.section).toBe("t9");
    expect(displaySection(offering.section)).toBe("—");
    expect(offering.meetings).toEqual([]);
    expect(offering.timeText).toBe("");
    expect(offering.catalogCourseId).toBe(8);
    expect(catalogTeacherSection(null)).toBe("");
  });

  it("overlays offering schedule text only when the catalog row has it", () => {
    const seed = [relationToOffering(relation({ course_id: 8, code: "10100001", name: "高等数学" }))];
    const withoutTime = applyScheduleOfferingRows(seed, [
      { key: "catalog-1", courseCode: "10100001", courseName: "高等数学", termId: "2026-2027-1", campus: "", weekText: "", timeText: "", place: "", teacherName: "教师甲", catalogCourseId: 8, catalogTeacherId: 9 },
    ]);
    expect(withoutTime[0].meetings).toEqual([]);
    expect(withoutTime[0].timeText).toBe("");

    const withTime = applyScheduleOfferingRows(seed, [
      {
        key: "jwxt-opaque-1",
        courseCode: "10100001",
        courseName: "高等数学",
        termId: "2026-2027-1",
        campus: "麦庐园",
        weekText: "1-16周",
        timeText: "星期一 第1-2节",
        place: "一教101",
        teacherName: "教师甲",
        catalogCourseId: 8,
        catalogTeacherId: 9,
      },
    ]);
    expect(withTime[0].section).toBe("jwxt-opaque-1");
    expect(withTime[0].campus).toBe("麦庐园");
    expect(withTime[0].meetings[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 2 });
  });

  it("keeps course replacements inside the existing bucket", () => {
    const math = relationToOffering(relation({ course_id: 8, code: "10100001", name: "高等数学" }));
    const sport = relationToOffering(relation({
      course_id: 20,
      code: "30100001",
      name: "羽毛球",
      category: "sports",
      department: "体育学院",
    }), "public");
    const next = applyScheduleOfferingRows([math], [{
      key: "jwxt-opaque-3",
      courseCode: "10100001",
      courseName: "高等数学",
      termId: "2026-2027-1",
      campus: "",
      weekText: "1-16周",
      timeText: "星期二 第3-4节",
      place: "",
      teacherName: "教师甲",
      catalogCourseId: 8,
      catalogTeacherId: 9,
    }]);
    expect(replaceCourseOfferings([sport], "10100001", next)).toEqual([sport]);
    expect(replaceCourseOfferings([math], "10100001", next)[0].section).toBe("jwxt-opaque-3");
  });

  it("builds a browse snapshot without education-level or enrolled JWXT rows", () => {
    const term = { id: "2026-2027-1", label: "2026-2027学年 第一学期" };
    const snapshot = catalogBrowseSnapshot({
      term,
      terms: [term],
      grade: { id: "", label: "" },
      grades: catalogScheduleGrades(new Date("2026-08-26T00:00:00+08:00")),
      major: { id: "", label: "" },
      majors: catalogScheduleMajors(),
      planned: [],
      publicElectives: [],
    });
    expect(snapshot.educationLevels).toEqual([]);
    expect(snapshot.enrolled).toEqual([]);
    expect(snapshot.majors.map((item) => item.label)).toContain("会计学");
  });

  it("dedupes picker rows by course code and maps program-plan plus offering rows", () => {
    const mathA = relationToOffering(relation({ course_id: 8, code: "10100001", name: "高等数学", teacher_id: 9, teacher_name: "教师甲" }));
    const mathB = relationToOffering(relation({ course_id: 8, code: "10100001", name: "高等数学", teacher_id: 12, teacher_name: "教师乙" }));
    const unique = uniqueOfferingsByCourseCode([mathA, mathB]);
    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatchObject({ courseCode: "10100001", teacherName: "", section: "" });

    const planned = programPlanCourseToOffering({
      courseCode: "10100001",
      courseName: "高等数学",
      credits: 4,
      categoryPath: "专业计划内",
      suggestedTerm: "2026-2027学年第一学期",
      catalogCourseId: 8,
    });
    expect(planned).toMatchObject({
      courseCode: "10100001",
      suggestedTerm: "2026-2027学年第一学期",
      catalogCourseId: 8,
      meetings: [],
    });
    const sections = offeringsFromScheduleRows(planned, [{
      key: "jwxt-8-a",
      courseCode: "10100001",
      courseName: "高等数学",
      termId: "2026-2027-1",
      campus: "麦庐园",
      weekText: "1-16周",
      timeText: "星期一 第1-2节",
      place: "一教101",
      teacherName: "教师甲",
      catalogCourseId: 8,
      catalogTeacherId: 9,
    }]);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ teacherName: "教师甲", section: "jwxt-8-a" });
    expect(sections[0].meetings[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 2 });
  });
});
