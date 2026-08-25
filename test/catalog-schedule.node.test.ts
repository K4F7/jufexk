import { describe, expect, it } from "vitest";
import {
  applyCatalogOfferingRows,
  catalogBrowseSnapshot,
  catalogFiltersReady,
  catalogScheduleGrades,
  catalogScheduleTerms,
  catalogTeacherSection,
  currentCatalogTermId,
  departmentsToMajors,
  displaySection,
  isCatalogPublicElective,
  relationToOffering,
  replaceCourseOfferings,
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
    expect(catalogFiltersReady({ id: "2026", label: "2026级" }, { id: "数学学院", label: "数学学院" })).toBe(true);
  });

  it("maps departments and public-elective sports separately", () => {
    expect(departmentsToMajors([" 数学学院 ", "", "体育学院"])).toEqual([
      { id: "数学学院", label: "数学学院" },
      { id: "体育学院", label: "体育学院" },
    ]);
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
    const withoutTime = applyCatalogOfferingRows(seed, [
      { course_id: 8, section: "历史数据", campus: "", schedule: "", teachers: "教师甲", teacher_ids: "9" },
    ]);
    expect(withoutTime[0].meetings).toEqual([]);
    expect(withoutTime[0].timeText).toBe("");

    const withTime = applyCatalogOfferingRows(seed, [
      {
        course_id: 8,
        section: "01",
        campus: "麦庐园",
        schedule: "星期一 第1-2节",
        teachers: "教师甲",
        teacher_ids: "9",
      },
    ]);
    expect(withTime[0].section).toBe("01");
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
    const next = applyCatalogOfferingRows([math], [{
      course_id: 8,
      section: "03",
      schedule: "星期二 第3-4节",
      teachers: "教师甲",
      teacher_ids: "9",
    }]);
    expect(replaceCourseOfferings([sport], "10100001", next)).toEqual([sport]);
    expect(replaceCourseOfferings([math], "10100001", next)[0].section).toBe("03");
  });

  it("builds a browse snapshot without education-level or enrolled JWXT rows", () => {
    const term = { id: "2026-2027-1", label: "2026-2027学年 第一学期" };
    const snapshot = catalogBrowseSnapshot({
      term,
      terms: [term],
      grade: { id: "", label: "" },
      grades: catalogScheduleGrades(new Date("2026-08-26T00:00:00+08:00")),
      major: { id: "", label: "" },
      majors: departmentsToMajors(["数学学院"]),
      planned: [],
      publicElectives: [],
    });
    expect(snapshot.educationLevels).toEqual([]);
    expect(snapshot.enrolled).toEqual([]);
    expect(snapshot.majors[0].label).toBe("数学学院");
  });
});
