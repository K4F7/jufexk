import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mostFrequent,
  selectJxufCoursePlan,
} from "../../src/lib/jxuf-course-plan";

type BaselineRow = {
  recordType: string;
  value: { courseCode: string; sourceCategoryTexts?: string[] };
};
type QxkbCourse = { code: string; credits: string[]; units: string[] };

export function resolveCoursePlanAttributePaths(
  env: Record<string, string | undefined>,
  scriptDir: string,
) {
  const capturesDir = resolve(scriptDir, "captures");
  return {
    baselinePath: resolve(
      env.JUFEXK_BASELINE_JSONL ||
        `${capturesDir}/full-approved-v2/catalog-baseline.jsonl`,
    ),
    qxkbPath: resolve(
      env.JUFEXK_QXKB_COURSES_JSONL ||
        `${capturesDir}/qxkb-22-26-v2/courses.jsonl`,
    ),
    outPath: resolve(
      env.JUFEXK_COURSE_PLAN_OUT ||
        `${capturesDir}/qxkb-22-26-v2/course-plan-attributes.json`,
    ),
  };
}

const readJsonl = async <T>(path: string) =>
  (await readFile(path, "utf8"))
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);

export async function buildCoursePlanAttributes(
  env: Record<string, string | undefined> = process.env,
  scriptDir = import.meta.dirname,
) {
  const { baselinePath, qxkbPath, outPath } = resolveCoursePlanAttributePaths(
    env,
    scriptDir,
  );
  const baseline = (await readJsonl<BaselineRow>(baselinePath)).filter(
    (row) => row.recordType === "course",
  );
  const qxkb = await readJsonl<QxkbCourse>(qxkbPath);
  const qxkbByCode = new Map(qxkb.map((row) => [row.code, row]));

  const items: Array<{
    courseCode: string;
    credits?: number;
    department?: string;
    enrollmentCategory: string;
    teachingType: string;
    courseLevel: string;
  }> = [];
  for (const row of baseline) {
    const course = row.value;
    const plan = selectJxufCoursePlan(course.sourceCategoryTexts || []);
    const offering = qxkbByCode.get(course.courseCode);
    const credits = offering
      ? Number(mostFrequent(offering.credits.map((value) => String(value))))
      : undefined;
    const department = offering
      ? mostFrequent(offering.units) || undefined
      : undefined;
    if (
      !plan.enrollmentCategory &&
      !plan.teachingType &&
      !plan.courseLevel &&
      credits == null &&
      !department
    )
      continue;
    items.push({
      courseCode: course.courseCode,
      ...(Number.isFinite(credits) ? { credits } : {}),
      ...(department ? { department } : {}),
      enrollmentCategory: plan.enrollmentCategory,
      teachingType: plan.teachingType,
      courseLevel: plan.courseLevel,
    });
  }

  await writeFile(outPath, `${JSON.stringify({ items }, null, 2)}\n`);
  return {
    items: items.length,
    withCredits: items.filter((item) => item.credits != null).length,
    withDepartment: items.filter((item) => item.department).length,
    withEnrollment: items.filter((item) => item.enrollmentCategory).length,
    outPath,
  };
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
    resolve(process.argv[1]).toLowerCase();
if (isDirectRun) {
  console.log(JSON.stringify(await buildCoursePlanAttributes(), null, 2));
}
