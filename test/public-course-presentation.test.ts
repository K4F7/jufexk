import { describe, expect, it } from "vitest";
import {
  isPublicSportsSkillName,
  isUmbrellaPeCourseName,
  publicCourseCategory,
  publicCourseVisibleSql,
  publicSportsMatchSql,
} from "../src/lib/public-course-presentation";

describe("public PE course presentation", () => {
  it("treats official 体育1/体育2 titles as hidden umbrella names", () => {
    expect(isUmbrellaPeCourseName("体育1")).toBe(true);
    expect(isUmbrellaPeCourseName("体育2")).toBe(true);
    expect(isUmbrellaPeCourseName("体育3")).toBe(true);
    expect(isUmbrellaPeCourseName("体育4")).toBe(true);
    expect(isUmbrellaPeCourseName("体育Ⅰ（留）")).toBe(true);
    expect(isUmbrellaPeCourseName("体育Ⅱ（留）")).toBe(true);
    expect(isUmbrellaPeCourseName("体育I（留）")).toBe(true);
    expect(isUmbrellaPeCourseName("网球")).toBe(false);
    expect(isUmbrellaPeCourseName("大学体育")).toBe(false);
  });

  it("promotes skill-style PE titles to sports without using 体育1/2", () => {
    expect(isPublicSportsSkillName("网球")).toBe(true);
    expect(isPublicSportsSkillName("击剑专项理论与实践1")).toBe(true);
    expect(isPublicSportsSkillName("羽毛球1")).toBe(true);
    expect(isPublicSportsSkillName("排球")).toBe(true);
    expect(isPublicSportsSkillName("篮球")).toBe(true);
    expect(isPublicSportsSkillName("健身教练")).toBe(true);
    expect(isPublicSportsSkillName("健美操")).toBe(true);
    expect(isPublicSportsSkillName("瑜伽")).toBe(true);
    expect(isPublicSportsSkillName("武术")).toBe(true);
    expect(isPublicSportsSkillName("体育1")).toBe(false);
    expect(publicCourseCategory("网球", "general")).toBe("sports");
    expect(publicCourseCategory("击剑专项理论与实践1", "general")).toBe("sports");
    expect(publicCourseCategory("线性代数", "general")).toBe("general");
    expect(publicCourseCategory("大学体育", "pe")).toBe("sports");
    expect(publicCourseCategory("体育1", "sports")).toBe("sports");
  });

  it("keeps sports SQL inside the public visibility gate", () => {
    expect(publicSportsMatchSql("c")).toContain(publicCourseVisibleSql("c"));
    expect(publicCourseVisibleSql("c")).toContain("'体育1'");
    expect(publicSportsMatchSql("c")).toContain("'网球%'");
  });
});
