import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";

const v1Path =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260819-v1/human-queue.json";
const v2Path =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260819-v2/human-queue.json";
const outDir =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260819-v2";
const zipPath =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260819-v2.zip";

const REASON = {
  verification_failed: "核验失败",
  unresolved: "unresolved",
  missing_context: "missing_context",
  mapping_unsupported: "映射不成立",
};

const v1 = JSON.parse(fs.readFileSync(v1Path, "utf8"));
const v2 = JSON.parse(fs.readFileSync(v2Path, "utf8"));
const seen = new Set(v1.items.map((item) => item.key));
const items = v2.items
  .filter((item) => !seen.has(item.key))
  .map((item) => ({
    ...item,
    decision: "",
    note: "",
  }));

const dropped = v2.items.filter((item) => seen.has(item.key));
const droppedBy = {};
const keptBy = {};
for (const item of dropped) droppedBy[item.worksheet] = (droppedBy[item.worksheet] || 0) + 1;
for (const item of items) keptBy[item.worksheet] = (keptBy[item.worksheet] || 0) + 1;

const queue = {
  contract_version: "legacy-human-queue-v1",
  status: "ready",
  included_worksheets: [...new Set(items.map((item) => item.worksheet))].sort((a, b) =>
    a.localeCompare(b, "zh"),
  ),
  excluded_open_worksheets: [],
  empty_worksheets: ["外教", "数学课"],
  omitted_already_reviewed_in_v1: {
    cells: dropped.length,
    by_worksheet: droppedBy,
  },
  queue_cells: items.length,
  auto_approved_cells: 66,
  incomplete_cells: 0,
  items,
  incomplete: [],
};

function relTo(out, file) {
  return path.relative(out, file).split(path.sep).join("/");
}

function zipImagePath(file) {
  const p = path.parse(file);
  return `images/${path.basename(p.dir)}/${p.base}`;
}

function csvEscape(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function csvRow(values) {
  return values.map(csvEscape).join(",");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fileHref(file) {
  const resolved = path.resolve(file).replaceAll("\\", "/");
  return encodeURI(`file:///${resolved.replace(/^\/+/, "")}`);
}

function buildMarkdown(list, imageHref) {
  const by = {};
  for (const item of list) by[item.worksheet] = (by[item.worksheet] || 0) + 1;
  const sheetLines = Object.keys(by)
    .sort((a, b) => a.localeCompare(b, "zh"))
    .map((name) => `- \`${name}\`：${by[name]}`);
  const droppedLines = Object.keys(droppedBy)
    .sort((a, b) => a.localeCompare(b, "zh"))
    .map((name) => `- \`${name}\`：${droppedBy[name]}（已在 v1 审过，本包已去掉）`);
  const lines = [
    "# 冻结审核包未批准格人工核验包 v2",
    "",
    "> 每项图片是当时格图；正文权威是公式栏原值，不要另写一稿。图片只是审核界面，机器权威仍是 `human-queue.json`。",
    "",
    "已去掉 v1 已审的 226 格。本包只含思政课收口后的新增待审格。",
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
    `待审合计：**${list.length}**。思政课自动批准 66 格不在本包。`,
    "",
    "## 分表",
    "",
    ...sheetLines,
    "",
    "无待审：`外教`、`数学课`",
    "",
    "已从本包去掉（v1 已审）：",
    "",
    ...droppedLines,
    "",
  ];
  list.forEach((item, idx) => {
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
      `![${item.key} 当时截图](<${imageHref(item.cell_image)}>)`,
      "",
    );
    if (item.conflict_image) {
      lines.push("**冲突图**", "", `![${item.key} 冲突图](<${imageHref(item.conflict_image)}>)`, "");
    }
    lines.push("### 处理意见：", "", "- **decision**: ", "- **note**: ", "", "---", "");
  });
  return lines.join("\n");
}

function buildHtml(list) {
  const rows = list
    .map((item) => {
      const image = fileHref(item.cell_image);
      const conflict = item.conflict_image ? fileHref(item.conflict_image) : "";
      return `<tr>
<td>${escapeHtml(item.key)}</td>
<td>${escapeHtml(item.worksheet)}</td>
<td>${item.row}</td>
<td>${escapeHtml(item.column)}</td>
<td><a href="${escapeHtml(image)}">${escapeHtml(item.cell_image)}</a></td>
<td>${conflict ? `<a href="${escapeHtml(conflict)}">${escapeHtml(item.conflict_image)}</a>` : ""}</td>
<td><pre>${escapeHtml(item.formula_bar_value)}</pre></td>
<td>${escapeHtml(item.course ?? "")}</td>
<td>${escapeHtml(item.teacher ?? "")}</td>
<td>${escapeHtml(item.reason)}</td>
<td></td>
<td></td>
</tr>`;
    })
    .join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>人工核验队列 v2（已去掉 v1 已审格）</title>
<p>只含思政课收口后的新增待审格。v1 已审 226 格已去掉。决定列填 通过 / 驳回 / 跳过。不得改写公式栏原文。</p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>键</th><th>工作表</th><th>行</th><th>列</th><th>截图</th><th>冲突图</th><th>公式栏原文</th><th>课名</th><th>教师</th><th>未批准原因</th><th>决定</th><th>备注</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
`;
}

function buildCsv(list) {
  const header = ["键", "工作表", "行", "列", "截图", "冲突图", "公式栏原文", "课名", "教师", "未批准原因", "决定", "备注"];
  const rows = list.map((item) => [
    item.key,
    item.worksheet,
    String(item.row),
    item.column,
    item.cell_image,
    item.conflict_image ?? "",
    item.formula_bar_value,
    item.course ?? "",
    item.teacher ?? "",
    item.reason,
    "",
    "",
  ]);
  return `\ufeff${[header, ...rows].map(csvRow).join("\n")}\n`;
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "human-queue.json"), `${JSON.stringify(queue, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "human-queue.csv"), buildCsv(items));
fs.writeFileSync(path.join(outDir, "human-queue.html"), buildHtml(items));
const localMd = buildMarkdown(items, (file) => relTo(outDir, file));
fs.writeFileSync(path.join(outDir, "manual-review.md"), localMd);
if (fs.existsSync(path.join(outDir, "decisions.json"))) fs.unlinkSync(path.join(outDir, "decisions.json"));

const copied = {};
const missing = [];
for (const item of items) {
  for (const field of ["cell_image", "conflict_image"]) {
    const raw = item[field];
    if (!raw) continue;
    if (!fs.existsSync(raw)) missing.push(raw);
    else copied[raw] = zipImagePath(raw);
  }
}
if (missing.length) throw new Error(`missing images:\n${missing.slice(0, 20).join("\n")}`);

const zipMd = buildMarkdown(items, (file) => zipImagePath(file));
const readme = [
  "人工核验包 v2（已去掉 v1 已审格）",
  "",
  "1. 解压后打开 manual-review.md（VS Code / Typora / Obsidian 均可）。",
  "2. 只填每项末尾的 decision、note：通过 / 驳回 / 跳过。",
  "3. 不要改 key，不要改写公式栏原文。",
  `4. 共 ${items.length} 条，全部是思政课。v1 已审的 226 格已去掉。`,
  "5. 机器清单仍是 human-queue.json。",
  "",
].join("\n");
const manifest = {
  contract_version: "legacy-human-queue-markdown-v1",
  status: "awaiting_human_decisions",
  omitted_already_reviewed_in_v1: dropped.length,
  counts: {
    tasks: items.length,
    auto_approved_cells: 66,
    image_links: Object.keys(copied).length,
    unique_source_images: Object.keys(copied).length,
  },
  artifact: {
    path: "manual-review.md",
    bytes: Buffer.byteLength(zipMd, "utf8"),
    sha256: createHash("sha256").update(zipMd).digest("hex"),
  },
};

const staging = path.join(outDir, "_zip-staging");
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
fs.writeFileSync(path.join(staging, "README.txt"), readme);
fs.writeFileSync(path.join(staging, "manual-review.md"), zipMd);
fs.writeFileSync(path.join(staging, "human-queue.json"), `${JSON.stringify(queue, null, 2)}\n`);
fs.writeFileSync(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (const [src, dest] of Object.entries(copied)) {
  const destPath = path.join(staging, dest);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(src, destPath);
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const zip = spawnSync(
  "tar",
  ["-a", "-cf", zipPath, "-C", staging, "."],
  { stdio: "inherit", windowsHide: true },
);
fs.rmSync(staging, { recursive: true, force: true });
if (zip.status !== 0) throw new Error(`zip failed: ${zip.status}`);

console.log(
  JSON.stringify(
    {
      out_dir: outDir,
      zip: zipPath,
      zip_bytes: fs.statSync(zipPath).size,
      kept: items.length,
      kept_by: keptBy,
      dropped: dropped.length,
      dropped_by: droppedBy,
      md_bytes: fs.statSync(path.join(outDir, "manual-review.md")).size,
    },
    null,
    2,
  ),
);
