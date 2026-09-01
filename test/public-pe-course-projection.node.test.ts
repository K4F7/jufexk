import { describe, expect, it } from "vitest";
import {
  publicCourseIdentity,
  publicPeCourseIdentity,
  resolvePePublicDisplayName,
} from "../src/lib/public-pe-course-projection";

describe("public PE Course-list identity and display names", () => {
  it("uses normalized specialization, not a Course id", () => {
    expect(publicPeCourseIdentity("篮球")).toBe("pe:篮球");
    expect(publicCourseIdentity(18111)).toBe("course:18111");
    expect(publicPeCourseIdentity("篮球")).not.toMatch(/^\d+$/);
  });

  it("keeps umbrella-prefixed names and direct catalog names", () => {
    expect(
      resolvePePublicDisplayName({
        normalizedSpecialization: "瑜伽",
        sources: [
          { displaySemantics: "umbrella_prefixed", sourceCourseName: "体育1" },
        ],
      }),
    ).toBe("体育1-4 [瑜伽]");
    expect(
      resolvePePublicDisplayName({
        normalizedSpecialization: "武术",
        sources: [
          { displaySemantics: "keep_source_name", sourceCourseName: "武术" },
        ],
      }),
    ).toBe("武术");
  });

  it("prefers the keep_source_name catalog name when mixed sources share the specialization", () => {
    expect(
      resolvePePublicDisplayName({
        normalizedSpecialization: "武术",
        sources: [
          { displaySemantics: "keep_source_name", sourceCourseName: "武术" },
          { displaySemantics: "umbrella_prefixed", sourceCourseName: "体育1" },
        ],
      }),
    ).toBe("武术");
    expect(
      resolvePePublicDisplayName({
        normalizedSpecialization: "篮球",
        sources: [
          { displaySemantics: "keep_source_name", sourceCourseName: "篮球" },
          { displaySemantics: "keep_source_name", sourceCourseName: "篮球2" },
        ],
      }),
    ).toBe("篮球");
    expect(
      resolvePePublicDisplayName({
        normalizedSpecialization: "篮球",
        sources: [
          { displaySemantics: "keep_source_name", sourceCourseName: "篮球2" },
          {
            displaySemantics: "keep_source_name",
            sourceCourseName: "篮球专项理论与实践1",
          },
        ],
      }),
    ).toBe("体育1-4 [篮球]");
  });
});
