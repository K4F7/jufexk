import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const qualityPath =
  "scripts/catalog-baseline/captures/full-quality-v12-final/courses.jsonl";
const inventoryPath =
  "scripts/catalog-baseline/captures/full-derived-v4/inventory.jsonl";
const reviewFiles = [
  "D:/19016/Documents/Workload/jufexk-production-inputs/frozen-historical-production-v2/importable-legacy-reviews.jsonl",
  "D:/19016/Documents/Workload/jufexk-production-inputs/frozen-historical-issue111-v1/importable-legacy-reviews.jsonl",
  "D:/19016/Documents/Workload/jufexk-production-inputs/issue111-isolated-usable-v1/reviews.jsonl",
  "D:/19016/Documents/Workload/jufexk-production-inputs/issue111-isolated-shorthand-v1/reviews.jsonl",
  "D:/19016/Documents/Workload/jufexk-production-inputs/issue111-pe-course-teacher-v1/reviews.jsonl",
];

const courses = new Map();
for (const line of (await readFile(qualityPath, "utf8")).split(/\r?\n/).filter(Boolean)) {
  const row = JSON.parse(line);
  courses.set(row.courseCode, {
    code: row.courseCode,
    name: row.currentName,
    category: row.category,
    sourceCategoryTexts: row.sourceCategoryTexts || [],
    campuses: new Set(),
    locations: new Set(),
    worksheets: new Set(),
  });
}

const campusCounts = new Map();
const locationSample = new Map();
const sourceTextCounts = new Map();
for (const course of courses.values()) {
  for (const text of course.sourceCategoryTexts) {
    sourceTextCounts.set(text, (sourceTextCounts.get(text) || 0) + 1);
  }
}

const rl = createInterface({ input: createReadStream(inventoryPath, "utf8") });
let inventoryRows = 0;
for await (const line of rl) {
  if (!line) continue;
  inventoryRows += 1;
  const row = JSON.parse(line);
  const course = courses.get(row.courseCode);
  if (!course) continue;
  if (row.sourceCampus) {
    course.campuses.add(row.sourceCampus);
    campusCounts.set(row.sourceCampus, (campusCounts.get(row.sourceCampus) || 0) + 1);
  }
  if (row.sourceLocation) {
    course.locations.add(row.sourceLocation);
    if (!locationSample.has(row.sourceLocation) && locationSample.size < 80) {
      locationSample.set(row.sourceLocation, row.courseCode);
    }
  }
}

const worksheetByCourse = new Map();
for (const file of reviewFiles) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    console.error("missing", file);
    continue;
  }
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    const code = row.catalog_course_code || row.course_code;
    const sheet = row.worksheet;
    if (!code || !sheet) continue;
    if (!worksheetByCourse.has(code)) worksheetByCourse.set(code, new Set());
    worksheetByCourse.get(code).add(sheet);
    const course = courses.get(code);
    if (course) course.worksheets.add(sheet);
  }
}

const sports = [...courses.values()].filter((c) => c.category === "sports");
const worksheetCounts = new Map();
for (const sheets of worksheetByCourse.values()) {
  const key = [...sheets].sort().join("+");
  worksheetCounts.set(key, (worksheetCounts.get(key) || 0) + 1);
}

const moocCampus = [...courses.values()].filter((c) =>
  [...c.campuses].some((x) => /mooc|慕课|网课|在线/i.test(x)),
);
const moocLocation = [...courses.values()].filter((c) =>
  [...c.locations].some((x) => /mooc|慕课|网课|在线|线上/i.test(x)),
);

console.log(JSON.stringify({
  courseCount: courses.size,
  inventoryRows,
  sports: sports.length,
  historicalCourses: worksheetByCourse.size,
  historicalOnCatalog: [...worksheetByCourse.keys()].filter((c) => courses.has(c)).length,
  historicalMissingCatalog: [...worksheetByCourse.keys()].filter((c) => !courses.has(c)),
  worksheetCombos: Object.fromEntries([...worksheetCounts.entries()].sort((a, b) => b[1] - a[1])),
  campusCounts: Object.fromEntries([...campusCounts.entries()].sort((a, b) => b[1] - a[1])),
  moocCampus: moocCampus.map((c) => ({ code: c.code, name: c.name, campuses: [...c.campuses] })),
  moocLocation: moocLocation.slice(0, 30).map((c) => ({
    code: c.code,
    name: c.name,
    locations: [...c.locations].filter((x) => /mooc|慕课|网课|在线|线上/i.test(x)),
  })),
  moocLocationCount: moocLocation.length,
  sourceTexts: Object.fromEntries([...sourceTextCounts.entries()].sort((a, b) => b[1] - a[1])),
  sportsNames: sports.map((c) => c.name).sort(),
}, null, 2));
