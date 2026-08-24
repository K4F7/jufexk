import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCoursePlanAttributePaths } from "./build-course-plan-attributes";

const scriptDir = resolve(import.meta.dirname);

describe("resolveCoursePlanAttributePaths", () => {
  it("defaults captures under the catalog-baseline script directory", () => {
    const paths = resolveCoursePlanAttributePaths({}, scriptDir);
    const captures = resolve(scriptDir, "captures");
    expect(paths.baselinePath).toBe(
      resolve(captures, "full-approved-v2/catalog-baseline.jsonl"),
    );
    expect(paths.qxkbPath).toBe(
      resolve(captures, "qxkb-22-26-v2/courses.jsonl"),
    );
    expect(paths.outPath).toBe(
      resolve(captures, "qxkb-22-26-v2/course-plan-attributes.json"),
    );
  });

  it("keeps JUFEXK_* environment overrides", () => {
    const paths = resolveCoursePlanAttributePaths(
      {
        JUFEXK_BASELINE_JSONL: "D:/tmp/baseline.jsonl",
        JUFEXK_QXKB_COURSES_JSONL: "D:/tmp/courses.jsonl",
        JUFEXK_COURSE_PLAN_OUT: "D:/tmp/out.json",
      },
      scriptDir,
    );
    expect(paths.baselinePath).toBe(resolve("D:/tmp/baseline.jsonl"));
    expect(paths.qxkbPath).toBe(resolve("D:/tmp/courses.jsonl"));
    expect(paths.outPath).toBe(resolve("D:/tmp/out.json"));
  });
});
