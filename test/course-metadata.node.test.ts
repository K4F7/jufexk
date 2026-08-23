import { describe, expect, it } from "vitest";
import { deriveCourseCatalogMeta } from "../src/lib/course-metadata";

describe("deriveCourseCatalogMeta", () => {
  it("maps sports, english, mooc and major the same way as the catalog prototype", () => {
    expect(
      deriveCourseCatalogMeta({
        name: "网球",
        category: "sports",
        schemeKey: "pe",
        tags: [],
      }),
    ).toEqual({
      enrollment_category: "体育课",
      teaching_type: "实践",
      course_level: "本科",
    });
    expect(
      deriveCourseCatalogMeta({
        name: "大学英语I",
        category: "general",
        schemeKey: "english",
        tags: [],
      }),
    ).toMatchObject({
      enrollment_category: "大学英语",
      teaching_type: "讲授",
    });
    expect(
      deriveCourseCatalogMeta({
        name: "网课导论",
        category: "general",
        schemeKey: "major",
        tags: ["mooc"],
      }),
    ).toEqual({
      enrollment_category: "慕课",
      teaching_type: "网络课程",
      course_level: "本科",
    });
    expect(
      deriveCourseCatalogMeta({
        name: "程序设计",
        category: "general",
        schemeKey: "major",
        tags: [],
      }),
    ).toMatchObject({
      enrollment_category: "专业课",
      teaching_type: "讲授",
    });
  });
});
