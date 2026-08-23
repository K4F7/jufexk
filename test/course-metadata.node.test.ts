import { describe, expect, it } from "vitest";
import { deriveCourseCatalogMeta } from "../src/lib/course-metadata";

describe("deriveCourseCatalogMeta", () => {
  it("returns stored JXUF fields and does not guess from scheme keys", () => {
    expect(
      deriveCourseCatalogMeta({
        enrollment_category: "专业内选修课",
        teaching_type: "理论课",
        course_level: "专业方向课",
      }),
    ).toEqual({
      enrollment_category: "专业内选修课",
      teaching_type: "理论课",
      course_level: "专业方向课",
    });
    expect(
      deriveCourseCatalogMeta({
        enrollment_category: "",
        teaching_type: "",
        course_level: "",
      }),
    ).toEqual({
      enrollment_category: "",
      teaching_type: "",
      course_level: "",
    });
  });
});
