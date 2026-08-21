import { readFile } from "node:fs/promises";

const qualityPath =
  "scripts/catalog-baseline/captures/full-quality-v12-final/courses.jsonl";
const reviewFiles = [
  "D:/19016/Documents/Workload/jufexk-production-inputs/frozen-historical-production-v2/importable-legacy-reviews.jsonl",
  "D:/19016/Documents/Workload/jufexk-production-inputs/frozen-historical-issue111-v1/importable-legacy-reviews.jsonl",
  "D:/19016/Documents/Workload/jufexk-production-inputs/issue111-isolated-usable-v1/reviews.jsonl",
  "D:/19016/Documents/Workload/jufexk-production-inputs/issue111-isolated-shorthand-v1/reviews.jsonl",
  "D:/19016/Documents/Workload/jufexk-production-inputs/issue111-pe-course-teacher-v1/reviews.jsonl",
];

const courses = [];
for (const line of (await readFile(qualityPath, "utf8")).split(/\r?\n/).filter(Boolean)) {
  courses.push(JSON.parse(line));
}

const worksheetByCourse = new Map();
for (const file of reviewFiles) {
  const text = await readFile(file, "utf8");
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    const code = row.catalog_course_code || row.course_code;
    const sheet = row.worksheet;
    if (!code || !sheet) continue;
    if (!worksheetByCourse.has(code)) worksheetByCourse.set(code, new Set());
    worksheetByCourse.get(code).add(sheet);
  }
}

const textsOf = (c) => (c.sourceCategoryTexts || []).join(" | ");
const hasText = (c, re) => (c.sourceCategoryTexts || []).some((t) => re.test(t));

const buckets = {
  pe: [],
  math: [],
  ideology: [],
  english: [],
  public_basic: [],
  major: [],
};

for (const c of courses) {
  const name = c.currentName;
  if (
    c.category === "sports" ||
    hasText(c, /(^|\/)体育(\/|$)/) ||
    /体育[1-4ⅠⅡ一二三四]/.test(name) ||
    name === "大学体育"
  ) {
    buckets.pe.push(c);
    continue;
  }
  if (hasText(c, /思想政治理论课/) || /马克思主义|毛泽东思想|习近平新时代|思想道德与法治|思想道德修养|中国近现代史纲要|形势与政策/.test(name)) {
    buckets.ideology.push(c);
    continue;
  }
  if (hasText(c, /公共数学课/) || /^(高等数学|线性代数|概率论与数理统计|微积分|数学分析)/.test(name)) {
    buckets.math.push(c);
    continue;
  }
  if (hasText(c, /公共外语课|综合英语|英语听说|英语视听说|外教|高阶英语/) || /大学英语|视听说|外教/.test(name)) {
    buckets.english.push(c);
    continue;
  }
  if (
    hasText(c, /任选课\/公共课|通识课程|通识教育|劳育|劳动教育|心理健康|军事理论|国防教育|国家安全教育|职业生涯|就业指导|入学|公共数字素养|公共数智素养|公共计算机|美育|艺术与体育|哲学、思维与语言|创新、创意与创业|历史、政治与社会|科学、技术与方法|大学生安全教育|感知中国/)
  ) {
    buckets.public_basic.push(c);
    continue;
  }
  buckets.major.push(c);
}

const sample = (arr, n = 25) =>
  arr.slice(0, n).map((c) => `${c.courseCode} ${c.currentName} :: ${textsOf(c)}`);

const byName = (arr) => {
  const m = new Map();
  for (const c of arr) m.set(c.currentName, (m.get(c.currentName) || 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40));
};

const historicalMismatch = [];
const worksheetToScheme = {
  主要课程: "major",
  数学课: "math",
  思政课: "ideology",
  美育: "public_basic",
  大英和视听说: "english",
  外教: "english",
  体育课: "pe",
};
for (const c of courses) {
  const sheets = worksheetByCourse.get(c.courseCode);
  if (!sheets) continue;
  const classified =
    buckets.pe.includes(c) ? "pe" :
    buckets.math.includes(c) ? "math" :
    buckets.ideology.includes(c) ? "ideology" :
    buckets.english.includes(c) ? "english" :
    buckets.public_basic.includes(c) ? "public_basic" : "major";
  const expected = [...sheets].map((s) => (s === "MOOC" ? "mooc" : worksheetToScheme[s]));
  if (!expected.includes(classified) && !expected.includes("mooc")) {
    historicalMismatch.push({
      code: c.courseCode,
      name: c.currentName,
      classified,
      sheets: [...sheets],
      texts: c.sourceCategoryTexts,
    });
  }
}

const moocNamed = courses.filter((c) => /MOOC|慕课|在线开放/.test(c.currentName));
const publicElective = courses.filter((c) => hasText(c, /任选课\/公共课/));

console.log(JSON.stringify({
  counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  peNames: buckets.pe.map((c) => `${c.courseCode} ${c.currentName} :: ${textsOf(c)}`),
  ideologyNames: byName(buckets.ideology),
  mathNames: byName(buckets.math),
  englishNames: byName(buckets.english),
  publicBasicNames: byName(buckets.public_basic),
  majorNamesTop: byName(buckets.major),
  ideologyAll: buckets.ideology.map((c) => `${c.currentName} :: ${textsOf(c)}`),
  mathAll: buckets.math.map((c) => `${c.currentName} :: ${textsOf(c)}`),
  englishSample: sample(buckets.english, 40),
  publicBasicNotElective: buckets.public_basic
    .filter((c) => !hasText(c, /任选课\/公共课/))
    .map((c) => `${c.currentName} :: ${textsOf(c)}`),
  historicalMismatch,
  historicalCombos: [...worksheetByCourse.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([code, sheets]) => {
      const c = courses.find((x) => x.courseCode === code);
      return { code, name: c?.currentName, sheets: [...sheets], texts: c?.sourceCategoryTexts };
    }),
  moocNamed: moocNamed.map((c) => `${c.courseCode} ${c.currentName} :: ${textsOf(c)}`),
  publicElectiveCount: publicElective.length,
  publicElectiveNames: byName(publicElective),
}, null, 2));
