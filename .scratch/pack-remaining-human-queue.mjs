import fs from "fs";
import path from "path";

const root =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/full-matrix-ocr-20260819-v1";
const outDir =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260820-v3";

const REASON = {
  verification_failed: "核验失败",
  unresolved: "unresolved",
  missing_context: "missing_context",
  mapping_unsupported: "映射不成立",
};

function nonempty(value) {
  const trimmed = (value ?? "").toString().trim();
  return trimmed === "" ? null : trimmed;
}

function reasonOf(cell) {
  if (cell.unresolved_reason === "missing_context") return "missing_context";
  if (cell.approval && cell.approval.mapping_supported === false) return "mapping_unsupported";
  if (cell.conclusion === "unresolved" || cell.routing === "unresolved") return "unresolved";
  return "verification_failed";
}

const sheets = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, "zh"));

const items = [];
const included = [];
const empty = [];
let auto = 0;
for (const sheet of sheets) {
  const pkgPath = path.join(root, sheet, "package.json");
  if (!fs.existsSync(pkgPath)) {
    empty.push(sheet);
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  included.push(sheet);
  for (const cell of pkg.cells || []) {
    if (cell.approved === true) {
      auto += 1;
      continue;
    }
    if (cell.routing === "not_applicable" || cell.conclusion === "not_applicable") continue;
    items.push({
      key: cell.key,
      worksheet: cell.worksheet,
      row: cell.row,
      column: cell.column,
      cell_image: cell.cell_image,
      conflict_image: cell.conflict_image,
      formula_bar_value: cell.formula_bar_value ?? "",
      course: nonempty(cell.context?.course),
      teacher: nonempty(cell.context?.teacher),
      reason: reasonOf(cell),
      reason_detail: cell.unresolved_reason,
      decision: "",
      note: "",
      source_package: pkgPath,
    });
  }
}
items.sort((a, b) => a.key.localeCompare(b.key, "zh"));

const queue = {
  contract_version: "legacy-human-queue-v1",
  status: items.length ? "ready" : "empty",
  included_worksheets: included,
  excluded_open_worksheets: [],
  empty_worksheets: empty,
  queue_cells: items.length,
  auto_approved_cells: auto,
  incomplete_cells: 0,
  items,
  incomplete: [],
};

function rel(file) {
  return path.relative(outDir, file).split(path.sep).join("/");
}

const by = {};
const byReason = {};
for (const item of items) {
  by[item.worksheet] = (by[item.worksheet] || 0) + 1;
  const label = item.reason + (item.reason_detail ? `/${item.reason_detail}` : "");
  byReason[item.worksheet] = byReason[item.worksheet] || {};
  byReason[item.worksheet][label] = (byReason[item.worksheet][label] || 0) + 1;
}
const sheetLines = Object.keys(by)
  .sort((a, b) => a.localeCompare(b, "zh"))
  .map((name) => `- \`${name}\`：${by[name]}`);

const lines = [
  "# 冻结审核包未批准格人工核验包 v3",
  "",
  "> 每项图片是当时格图；正文权威是公式栏原值，不要另写一稿。图片只是审核界面，机器权威仍是 `human-queue.json`。",
  "",
  "v1/v2 里「核验失败」但实际从没进过独立图文核验的格已补跑一轮。本包只剩：仲裁未决，或独立核验看过图后未通过。",
  "",
  "## 填写规则",
  "",
  "只填写每项末尾的 `decision`、`note`，不要修改 `key` 与公式栏原文。",
  "",
  "- `通过`：公式栏原文可作为该格审核正文，课名/教师映射成立。",
  "- `驳回`：不能作为存储正文，或映射不成立。",
  "- `跳过`：本次不处理。",
  "- 尚未决定的项保持 `decision` 为空。",
  "",
  `待审合计：**${items.length}**。自动批准 ${auto} 格不在本包。`,
  "",
  "## 分表",
  "",
  ...sheetLines,
  "",
];

items.forEach((item, idx) => {
  const n = String(idx + 1).padStart(3, "0");
  const course = item.course || "（冻结上下文无课名）";
  const teacher = item.teacher || "（冻结上下文无教师）";
  const reason = REASON[item.reason] || item.reason;
  const detail = item.reason_detail ? `；\`${item.reason_detail}\`` : "";
  lines.push(
    `## ${n} · \`${item.key}\``,
    "",
    `- **key**: \`${item.key}\``,
    `- **worksheet**: ${item.worksheet}`,
    `- **row**: ${item.row}`,
    `- **column**: ${item.column}`,
    `- **course**: ${course}`,
    `- **teacher**: ${teacher}`,
    `- **reason**: \`${reason}\`${detail}`,
    "- **formula_bar_value**:",
    "",
    "```",
    item.formula_bar_value,
    "```",
    "",
    `**当时截图** — \`${item.worksheet}\` 第 ${item.row} 行 ${item.column} 列`,
    "",
    `![${item.key} 当时截图](<${rel(item.cell_image)}>)`,
    "",
  );
  if (item.conflict_image) {
    lines.push("**冲突图**", "", `![${item.key} 冲突图](<${rel(item.conflict_image)}>)`, "");
  }
  lines.push("### 处理意见：", "", "- **decision**: ", "- **note**: ", "", "---", "");
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "human-queue.json"), `${JSON.stringify(queue, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "manual-review.md"), lines.join("\n"));
console.log(JSON.stringify({ outDir, queue_cells: items.length, auto, by, byReason }, null, 2));
