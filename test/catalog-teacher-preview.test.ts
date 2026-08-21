import { describe, expect, it } from "vitest";
import {
  CATALOG_TEACHER_PREVIEW_LIMIT,
  previewCatalogTeachers,
  teacherNameMatchesTerms,
} from "../src/lib/catalog-teacher-preview";

const names = (...values: string[]) => values.map((name) => ({ name }));

describe("previewCatalogTeachers", () => {
  it("returns every teacher when the list fits the limit", () => {
    const teachers = names("甲", "乙");
    expect(previewCatalogTeachers(teachers)).toEqual({
      visible: teachers,
      hiddenCount: 0,
    });
  });

  it("keeps the first three names when nobody is prioritized", () => {
    const teachers = names("甲", "乙", "丙", "丁", "戊");
    expect(previewCatalogTeachers(teachers)).toEqual({
      visible: names("甲", "乙", "丙"),
      hiddenCount: 2,
    });
    expect(CATALOG_TEACHER_PREVIEW_LIMIT).toBe(3);
  });

  it("keeps search hits visible without reordering the source list", () => {
    const teachers = names("甲", "乙", "丙", "张三", "李四");
    expect(
      previewCatalogTeachers(teachers, {
        isPriority: (teacher) => teacherNameMatchesTerms(teacher.name, ["张三"]),
      }),
    ).toEqual({
      visible: names("甲", "乙", "张三"),
      hiddenCount: 2,
    });
  });

  it("fills remaining slots from the start after taking priority names", () => {
    const teachers = names("甲", "乙", "丙", "张三", "李四");
    expect(
      previewCatalogTeachers(teachers, {
        isPriority: (teacher) =>
          teacherNameMatchesTerms(teacher.name, ["张三", "李四"]),
      }),
    ).toEqual({
      visible: names("甲", "张三", "李四"),
      hiddenCount: 2,
    });
  });
});

describe("teacherNameMatchesTerms", () => {
  it("matches case-insensitively and ignores empty term lists", () => {
    expect(teacherNameMatchesTerms("Zhang", ["zhang"])).toBe(true);
    expect(teacherNameMatchesTerms("张三", [])).toBe(false);
    expect(teacherNameMatchesTerms("张三", ["李四"])).toBe(false);
  });
});
