import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  mostFrequent,
  selectJxufCoursePlan,
} from "../../src/lib/jxuf-course-plan";

type BaselineRow = {
  recordType: string;
  value: { courseCode: string; sourceCategoryTexts?: string[] };
};
type QxkbCourse = { code: string; credits: string[]; units: string[] };

const repoRoot = resolve(import.meta.dirname, "../..");
const baselinePath = resolve(
  process.env.JUFEXK_BASELINE_JSONL ||
    `${repoRoot}/../../scripts/catalog-baseline/captures/full-approved-v2/catalog-baseline.jsonl`,
);
const qxkbPath = resolve(
  process.env.JUFEXK_QXKB_COURSES_JSONL ||
    `${repoRoot}/../../scripts/catalog-baseline/captures/qxkb-22-26-v2/courses.jsonl`,
);
const outPath = resolve(
  process.env.JUFEXK_COURSE_PLAN_OUT ||
    `${repoRoot}/../../scripts/catalog-baseline/captures/qxkb-22-26-v2/course-plan-attributes.json`,
);

const readJsonl = async <T>(path: string) =>
  (await readFile(path, "utf8"))
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);

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
console.log(
  JSON.stringify(
    {
      items: items.length,
      withCredits: items.filter((item) => item.credits != null).length,
      withDepartment: items.filter((item) => item.department).length,
      withEnrollment: items.filter((item) => item.enrollmentCategory).length,
      outPath,
    },
    null,
    2,
  ),
);
