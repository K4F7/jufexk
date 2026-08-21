import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const v4Dir = "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/review-approved-20260820-v4";
const v5Dir = "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/review-approved-20260820-v5";
const queuePath = "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260820-v3/human-queue.json";
const mergedPath = "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260820-v3-live-recapture/review/merged-decisions.json";

function readJsonl(file) {
  const text = fs.readFileSync(file, "utf8").trimEnd();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}
function jsonl(rows) {
  return rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
}
function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}
function uniqueLabels(values) {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value !== ""))].sort((left, right) =>
    left.localeCompare(right, "zh"),
  );
}
function uniquePairs(evaluations) {
  const seen = new Set();
  const pairs = [];
  for (const item of evaluations) {
    const course = item.course?.trim() ?? "";
    const teacher = item.teacher?.trim() ?? "";
    if (!course || !teacher) continue;
    const key = `${course}\u001f${teacher}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ course_label: course, teacher_label: teacher });
  }
  return pairs.sort((left, right) =>
    `${left.course_label}|${left.teacher_label}`.localeCompare(`${right.course_label}|${right.teacher_label}`, "zh"),
  );
}

const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
const byKey = new Map(queue.items.map((item) => [item.key, item]));
const evaluations = readJsonl(path.join(v4Dir, "evaluations.jsonl"));
const evalByKey = new Map(evaluations.map((item) => [item.key, item]));

const addPass = [
  {
    key: "大英和视听说|10|N",
    course: "英语口语",
    teacher: "张晓花",
    note: "用户指定课名为英语口语；正文仍用公式栏原文，教师按该行张晓花。",
  },
  {
    key: "主要课程|173|F",
    course: "货币银行学",
    teacher: "孙爱琳",
    note: "用户指定第173行教师为孙爱琳。",
  },
  {
    key: "主要课程|180|F",
    course: "跨文化商务沟通",
    teacher: "缪丽",
    note: "用户指定第180行教师为缪丽。",
  },
  {
    key: "主要课程|180|G",
    course: "跨文化商务沟通",
    teacher: "缪丽",
    note: "用户指定第180行教师为缪丽。",
  },
];

const rowTeacherPatch = [
  { prefix: "主要课程|173|", teacher: "孙爱琳", course: "货币银行学" },
  { prefix: "主要课程|180|", teacher: "缪丽", course: "跨文化商务沟通" },
];

const dropped = {
  key: "大英和视听说|56|J",
  worksheet: "大英和视听说",
  decision: "reject",
  note: "用户删除：公式栏「同2」是指向性备注，不作评价正文。",
  reason: "unresolved",
};

const added = [];
for (const item of addPass) {
  if (evalByKey.has(item.key)) throw new Error(`already in v4: ${item.key}`);
  const src = byKey.get(item.key);
  if (!src) throw new Error(`missing queue item: ${item.key}`);
  const record = {
    key: src.key,
    worksheet: src.worksheet,
    row: src.row,
    column: src.column,
    body: src.formula_bar_value,
    body_source: "formula_bar",
    course: item.course,
    teacher: item.teacher,
    cell_image: src.cell_image,
    conflict_image: src.conflict_image,
    approval_source: "human_pass",
    formula_bar_text_sha256: sha256Text(src.formula_bar_value),
  };
  evaluations.push(record);
  evalByKey.set(item.key, record);
  added.push({ key: item.key, course: item.course, teacher: item.teacher, note: item.note });
}

const patched = [];
for (const row of evaluations) {
  for (const rule of rowTeacherPatch) {
    if (!row.key.startsWith(rule.prefix)) continue;
    const before = { course: row.course, teacher: row.teacher };
    if (row.teacher === rule.teacher && row.course === rule.course) continue;
    row.course = rule.course;
    row.teacher = rule.teacher;
    patched.push({ key: row.key, from: before, to: { course: row.course, teacher: row.teacher }, approval_source: row.approval_source });
  }
}

evaluations.sort((left, right) => left.key.localeCompare(right.key, "zh"));
const courses = uniqueLabels(evaluations.map((item) => item.course)).map((course_label) => ({ course_label }));
const teachers = uniqueLabels(evaluations.map((item) => item.teacher)).map((teacher_label) => ({ teacher_label }));
const courseTeachers = uniquePairs(evaluations);
const excluded = [dropped];

const auto = evaluations.filter((item) => item.approval_source === "auto_verify").length;
const human = evaluations.filter((item) => item.approval_source === "human_pass").length;

fs.mkdirSync(v5Dir, { recursive: true });
const files = {
  "evaluations.jsonl": jsonl(evaluations),
  "courses.jsonl": jsonl(courses),
  "teachers.jsonl": jsonl(teachers),
  "course_teachers.jsonl": jsonl(courseTeachers),
  "excluded.jsonl": jsonl(excluded),
};
const declared = {};
for (const [name, body] of Object.entries(files)) {
  fs.writeFileSync(path.join(v5Dir, name), body);
  declared[name] = { sha256: sha256Text(body), rows: body.trim() === "" ? 0 : body.trimEnd().split("\n").length };
}

const manifest = {
  contract_version: "legacy-review-approved-package-v1",
  status: "completed",
  auto_approved_cells: auto,
  human_passed_cells: human,
  excluded_cells: excluded.length,
  undecided_cells: 0,
  files: declared,
  wrote_tencent_or_business_db: false,
  source_package: v4Dir,
  mapping_overrides: {
    added_human_pass: added.map((item) => item.key),
    patched_same_row: patched.map((item) => item.key),
    dropped: [dropped.key],
  },
};
fs.writeFileSync(path.join(v5Dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const merged = JSON.parse(fs.readFileSync(mergedPath, "utf8"));
const overlay = new Map([
  ...addPass.map((item) => [item.key, { decision: "通过", note: item.note }]),
  [dropped.key, { decision: "驳回", note: dropped.note }],
]);
for (const item of merged.items) {
  const hit = overlay.get(item.key);
  if (!hit) continue;
  item.decision = hit.decision;
  item.note = hit.note;
  item.source = "user-mapping-20260820";
}
merged.counts = { 通过: 0, 驳回: 0, 跳过: 0 };
for (const item of merged.items) merged.counts[item.decision] += 1;
merged.mapping_overrides_v5 = { added, patched, dropped: dropped.key };
fs.writeFileSync(mergedPath, `${JSON.stringify(merged, null, 2)}\n`);

fs.writeFileSync(
  path.join(v5Dir, "mapping-overrides.json"),
  `${JSON.stringify({ added, patched, dropped }, null, 2)}\n`,
);

console.log(JSON.stringify({
  v5Dir,
  auto,
  human,
  evaluations: evaluations.length,
  excluded: excluded.length,
  courses: courses.length,
  teachers: teachers.length,
  course_teachers: courseTeachers.length,
  added: added.map((item) => item.key),
  patched: patched.map((item) => item.key),
  new_courses: courses.filter((item) => ["英语口语"].includes(item.course_label)),
  new_teachers: teachers.filter((item) => ["孙爱琳", "缪丽"].includes(item.teacher_label)),
  new_pairs: courseTeachers.filter((item) =>
    (item.course_label === "英语口语" && item.teacher_label === "张晓花")
    || (item.course_label === "货币银行学" && item.teacher_label === "孙爱琳")
    || (item.course_label === "跨文化商务沟通" && item.teacher_label === "缪丽")
  ),
}, null, 2));
