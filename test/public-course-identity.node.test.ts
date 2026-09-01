import { describe, expect, it } from "vitest";
import {
  courseDetailApiPath,
  courseDetailHref,
  parsePublicCourseParam,
  publicCourseMatchesParam,
  publicCoursePageIdentity,
} from "../src/lib/public-course-identity";
import { publicPeCourseIdentity } from "../src/lib/public-pe-course-projection";

describe("public course identity routing", () => {
  it("parses pe course, pe relation, numeric alias, and ordinary ids", () => {
    expect(parsePublicCourseParam("pe:瑜伽")).toEqual({
      kind: "pe",
      specialization: "瑜伽",
    });
    expect(parsePublicCourseParam("pe%3A%E6%AD%A6%E6%9C%AF")).toEqual({
      kind: "pe",
      specialization: "武术",
    });
    expect(parsePublicCourseParam("pe:篮球:12")).toEqual({
      kind: "pe",
      specialization: "篮球",
      teacherId: 12,
    });
    expect(parsePublicCourseParam("800001")).toEqual({
      kind: "numeric",
      id: 800001,
    });
    expect(parsePublicCourseParam("8")).toEqual({ kind: "numeric", id: 8 });
    expect(parsePublicCourseParam("pe:")).toEqual({ kind: "invalid" });
  });

  it("builds detail hrefs from public_id without using a Course id", () => {
    expect(
      publicCoursePageIdentity({
        public_id: "pe:篮球:12",
        course_id: null,
        id: null,
      }),
    ).toBe("pe:篮球");
    expect(courseDetailHref("pe:篮球", 12)).toBe(
      `/courses/${encodeURIComponent("pe:篮球")}?teacher=12`,
    );
    expect(courseDetailApiPath("pe:瑜伽", "/reviews?teacherId=1")).toBe(
      `/api/courses/${encodeURIComponent("pe:瑜伽")}/reviews?teacherId=1`,
    );
  });

  it("matches mapped PE payloads against public ids and yoga/wushu aliases", () => {
    const course = {
      id: null,
      public_id: publicPeCourseIdentity("瑜伽"),
    };
    expect(publicCourseMatchesParam(course, "pe:瑜伽")).toBe(true);
    expect(publicCourseMatchesParam(course, encodeURIComponent("pe:瑜伽"))).toBe(
      true,
    );
    expect(publicCourseMatchesParam(course, "800001")).toBe(true);
    expect(publicCourseMatchesParam(course, "800002")).toBe(false);
    expect(publicCourseMatchesParam({ id: 8, public_id: "course:8" }, "8")).toBe(
      true,
    );
  });
});
