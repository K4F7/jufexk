import fs from "fs";
import path from "path";

const src = "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260819-v2";
const queue = JSON.parse(fs.readFileSync(path.join(src, "human-queue.json"), "utf8"));
const REASON = {
  verification_failed: "核验失败",
  unresolved: "unresolved",
  missing_context: "missing_context",
  mapping_unsupported: "映射不成立",
};
const DECISION = {
  pass: "通过",
  reject: "驳回",
  skip: "跳过",
  通过: "通过",
  驳回: "驳回",
  跳过: "跳过",
};

function rel(p) {
  return path.relative(src, p).split(path.sep).join("/");
}

const items = queue.items;
const by = {};
for (const item of items) by[item.worksheet] = (by[item.worksheet] || 0) + 1;
const sheetLines = Object.keys(by)
  .sort((a, b) => a.localeCompare(b, "zh"))
  .map((name) => `- \`${name}\`：${by[name]}`);
const empty = queue.empty_worksheets || [];
const lines = [
  "# 冻结审核包未批准格人工核验包 v2",
  "",
  "> 每项图片是当时格图；正文权威是公式栏原值，不要另写一稿。图片只是审核界面，机器权威仍是 `human-queue.json`。",
  "",
  "思政课已收口后重编。v1 的 226 格决定沿用；本包新增思政课 112 格。",
  "",
  "## 填写规则",
  "",
  "只填写每项末尾的 `decision`、`note`，不要修改 `key` 与公式栏原文。",
  "",
  "- `通过`：公式栏原文可作为该格审核正文，课名/教师映射成立。",
  "- `驳回`：不能作为存储正文，或映射不成立。",
  "- `跳过`：本次不处理。",
  "",
  `待审合计：**${items.length}**。自动批准 ${queue.auto_approved_cells || 0} 格不在本包。`,
  "",
  "## 分表",
  "",
  ...sheetLines,
  "",
];
if (empty.length) {
  lines.push("无待审：" + empty.map((name) => `\`${name}\``).join("、"), "");
}

items.forEach((item, idx) => {
  const n = String(idx + 1).padStart(3, "0");
  const course = item.course || "（冻结上下文无课名）";
  const teacher = item.teacher || "（冻结上下文无教师）";
  const reason = REASON[item.reason] || item.reason;
  const detail = item.reason_detail ? `；\`${item.reason_detail}\`` : "";
  const decision = DECISION[item.decision] || item.decision || "";
  const note = item.note || "";
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
  lines.push("### 处理意见：", "", `- **decision**: ${decision}`, `- **note**: ${note}`, "", "---", "");
});

const out = path.join(src, "manual-review.md");
fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log("wrote", out, fs.statSync(out).size);
