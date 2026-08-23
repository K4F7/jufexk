import { describe, expect, it } from "vitest";
import {
  parseCategoryPath,
  selectJxufCoursePlan,
} from "../src/lib/jxuf-course-plan";

describe("parseCategoryPath", () => {
  it("reads the baseline order and the 选课结果 order as the same path", () => {
    const baseline = parseCategoryPath("选修课/2024专业教育课/专业方向课");
    const resultPage = parseCategoryPath(
      "理论课  2024专业教育课/专业方向课/选修课",
    );
    expect(baseline).toMatchObject({
      year: 2024,
      bucket: "专业教育课",
      mid: "专业方向课",
      requirement: "选修课",
      teachingType: "",
      noise: false,
    });
    expect(resultPage).toMatchObject({
      year: 2024,
      bucket: "专业教育课",
      mid: "专业方向课",
      requirement: "选修课",
      teachingType: "理论课",
      noise: false,
    });
  });

  it("drops empty and honor-track labels", () => {
    for (const text of [
      "任选课/公共课",
      "必修课/",
      "选修课/",
      "限选课/",
      "拔尖型/",
      "卓越型/",
      "创新创业型/",
      "专业方向/",
    ]) {
      expect(parseCategoryPath(text).noise).toBe(true);
    }
  });
});

describe("selectJxufCoursePlan", () => {
  it("uses the confirmed JXUF short labels, not 通修/专业核心", () => {
    expect(
      selectJxufCoursePlan(["选修课/2024专业教育课/专业方向课"]),
    ).toEqual({
      enrollmentCategory: "专业内选修课",
      teachingType: "",
      courseLevel: "专业方向课",
    });
    expect(
      selectJxufCoursePlan(["必修课/2024专业教育课/专业必修课"]),
    ).toEqual({
      enrollmentCategory: "专业内必修课",
      teachingType: "",
      courseLevel: "专业必修课",
    });
    expect(
      selectJxufCoursePlan(["必修课/2024公共课/公共外语课"]),
    ).toEqual({
      enrollmentCategory: "公共必修",
      teachingType: "",
      courseLevel: "公共外语课",
    });
    expect(
      selectJxufCoursePlan(["必修课/2024专业教育课/学科基础课"]),
    ).toEqual({
      enrollmentCategory: "专业内必修课",
      teachingType: "",
      courseLevel: "学科基础课",
    });
    expect(
      selectJxufCoursePlan(["选修课/2024专业教育课/学科开放课"]),
    ).toEqual({
      enrollmentCategory: "专业内选修课",
      teachingType: "",
      courseLevel: "学科开放课",
    });
    expect(
      selectJxufCoursePlan(["限选课/2024专业教育课/专业限选课"]),
    ).toEqual({
      enrollmentCategory: "专业限选",
      teachingType: "",
      courseLevel: "专业限选课",
    });
    expect(
      selectJxufCoursePlan(["必修课/2024实践教育课/劳动教育"]),
    ).toEqual({
      enrollmentCategory: "实践必修",
      teachingType: "",
      courseLevel: "劳动教育",
    });
    expect(
      selectJxufCoursePlan(["选修课/2024公共课/公共外语课"]),
    ).toEqual({
      enrollmentCategory: "公共选修",
      teachingType: "",
      courseLevel: "公共外语课",
    });
    expect(
      selectJxufCoursePlan(["必修课/2024通识教育课/哲学、思维与语言"]),
    ).toEqual({
      enrollmentCategory: "通识必修",
      teachingType: "",
      courseLevel: "哲学、思维与语言",
    });
  });

  it("prefers 2024 and the harder dual path", () => {
    expect(
      selectJxufCoursePlan([
        "必修课/通识课程/模块五:经济管理与社会可持续发展",
        "选修课/2020专业教育/专业方向选修课",
        "选修课/2024专业教育课/专业方向课",
        "任选课/公共课",
      ]),
    ).toEqual({
      enrollmentCategory: "专业内选修课",
      teachingType: "",
      courseLevel: "专业方向课",
    });
    expect(
      selectJxufCoursePlan([
        "必修课/2024专业教育课/专业必修课",
        "选修课/2024专业教育课/专业方向课",
      ]),
    ).toEqual({
      enrollmentCategory: "专业内必修课",
      teachingType: "",
      courseLevel: "专业必修课",
    });
  });

  it("keeps a teaching-type prefix when the selected path has one", () => {
    expect(
      selectJxufCoursePlan([
        "理论课 2024专业教育课/专业必修课/必修课",
      ]),
    ).toEqual({
      enrollmentCategory: "专业内必修课",
      teachingType: "理论课",
      courseLevel: "专业必修课",
    });
  });

  it("returns empty fields when only noise remains", () => {
    expect(selectJxufCoursePlan(["任选课/公共课", "必修课/"])).toEqual({
      enrollmentCategory: "",
      teachingType: "",
      courseLevel: "",
    });
  });
});
