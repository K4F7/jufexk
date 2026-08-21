import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Re-implement classify by evaluating the source without running apply.
const src = await readFile(".scratch/236-classify-apply.mjs", "utf8");
const start = src.indexOf("function publicPeSkill");
const end = src.indexOf("function parseDotenv");
const fns = src.slice(start, end);
const classifyCourse = (await import(
  `data:text/javascript,${encodeURIComponent(fns + "\nexport { classifyCourse };")}`
)).classifyCourse;

const quality = [];
for (const line of (await readFile("scripts/catalog-baseline/captures/full-quality-v12-final/courses.jsonl", "utf8")).split(/\r?\n/).filter(Boolean)) {
  quality.push(JSON.parse(line));
}
const buckets = { pe: [], ideology: [], math: [], english: [], public_basic: [], major: [] };
for (const row of quality) {
  const classified = classifyCourse({
    name: row.currentName,
    category: row.category,
    sourceCategoryTexts: row.sourceCategoryTexts,
  });
  buckets[classified.schemeKey].push(`${row.courseCode}\t${row.currentName}\t${(row.sourceCategoryTexts||[]).join(" | ")}\t${classified.tags.join(",")}`);
}
for (const key of ["pe", "ideology", "math", "english"]) {
  console.log(`\n===== ${key} (${buckets[key].length}) =====`);
  console.log(buckets[key].join("\n"));
}
console.log("\n===== public_basic suspicious =====");
for (const line of buckets.public_basic) {
  if (/英语|数学|思政|马克思|习近平|体育|安全|民族|红色|法治|基础英语|语文/.test(line)) console.log(line);
}
