import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertReviewPackageOutputPath,
  type CompiledCell,
  type ReviewPackage,
} from "./review_package";

export const HUMAN_QUEUE_CONTRACT_VERSION = "legacy-human-queue-v1" as const;
export const REVIEW_APPROVED_PACKAGE_CONTRACT = "legacy-review-approved-package-v1" as const;

export type HumanQueueReason =
  | "verification_failed"
  | "unresolved"
  | "missing_context"
  | "mapping_unsupported";

export type HumanDecision = "pass" | "reject" | "skip";

export type HumanQueueItem = {
  key: string;
  worksheet: string;
  row: number;
  column: string;
  cell_image: string;
  conflict_image: string | null;
  formula_bar_value: string;
  course: string | null;
  teacher: string | null;
  reason: HumanQueueReason;
  reason_detail: string | null;
  decision: "" | HumanDecision;
  note: string;
  source_package: string;
};

export type IncompleteQueueCell = {
  key: string;
  worksheet: string;
  missing: string[];
  source_package: string;
};

export type OpenWorksheet = {
  worksheet: string;
  reason: string;
};

export type HumanQueue = {
  contract_version: typeof HUMAN_QUEUE_CONTRACT_VERSION;
  status: "ready" | "empty";
  included_worksheets: string[];
  excluded_open_worksheets: OpenWorksheet[];
  empty_worksheets: string[];
  queue_cells: number;
  auto_approved_cells: number;
  incomplete_cells: number;
  items: HumanQueueItem[];
  incomplete: IncompleteQueueCell[];
};

export type LaneSource = {
  worksheet: string;
  package_path: string | null;
  inventory_status?: string | null;
  pending_cells?: number;
  pending_verify_cells?: number;
  pkg: ReviewPackage | null;
};

export type HumanDecisionRecord = {
  key: string;
  decision: HumanDecision;
  note: string;
};

export type ApprovedEvaluation = {
  key: string;
  worksheet: string;
  row: number;
  column: string;
  body: string;
  body_source: "formula_bar";
  course: string | null;
  teacher: string | null;
  cell_image: string | null;
  conflict_image: string | null;
  approval_source: "auto_verify" | "human_pass";
  formula_bar_text_sha256: string | null;
};

export type ExcludedEvaluation = {
  key: string;
  worksheet: string;
  decision: "reject" | "skip";
  note: string;
  reason: HumanQueueReason | "human_decision";
};

export type ReviewApprovedPackage = {
  contract_version: typeof REVIEW_APPROVED_PACKAGE_CONTRACT;
  status: "completed";
  auto_approved_cells: number;
  human_passed_cells: number;
  excluded_cells: number;
  undecided_cells: number;
  evaluations: ApprovedEvaluation[];
  courses: { course_label: string }[];
  teachers: { teacher_label: string }[];
  course_teachers: { course_label: string; teacher_label: string }[];
  excluded: ExcludedEvaluation[];
};

const DECISION_ALIASES: Record<string, HumanDecision> = {
  pass: "pass",
  reject: "reject",
  skip: "skip",
  通过: "pass",
  驳回: "reject",
  跳过: "skip",
};

export function assertHumanQueueOutputPath(path: string) {
  assertReviewPackageOutputPath(path);
  const resolved = resolve(path).replaceAll("\\", "/");
  if (resolved.includes("/full-matrix-ocr-20260819-v1")) {
    throw new Error("human queue must use a new directory; do not overwrite a #316 lane out_dir");
  }
}

export function isHumanQueueCandidate(cell: CompiledCell) {
  return cell.approved !== true && cell.routing !== "not_applicable" && cell.conclusion !== "not_applicable";
}

export function humanQueueReason(cell: CompiledCell): HumanQueueReason {
  if (cell.unresolved_reason === "missing_context") return "missing_context";
  if (cell.approval && "mapping_supported" in cell.approval && cell.approval.mapping_supported === false) {
    return "mapping_unsupported";
  }
  if (cell.conclusion === "unresolved" || cell.routing === "unresolved") return "unresolved";
  return "verification_failed";
}

export function laneIsOpen(lane: LaneSource) {
  if ((lane.pending_cells ?? 0) > 0 || (lane.pending_verify_cells ?? 0) > 0) return true;
  const status = lane.inventory_status;
  return status === "needs_ocr" || status === "blocked";
}

function isCellScreenshot(path: string | null | undefined) {
  if (!path) return false;
  return /[-_]cell\.(jpg|jpeg|png)$/i.test(path.replaceAll("\\", "/"));
}

function missingQueueFields(cell: CompiledCell) {
  const missing: string[] = [];
  if (!isCellScreenshot(cell.cell_image)) missing.push("cell_image");
  if (cell.formula_bar_value == null || cell.formula_bar_value === "") missing.push("formula_bar_value");
  return missing;
}

export function buildHumanQueue(lanes: LaneSource[]): HumanQueue {
  const included: string[] = [];
  const excluded: OpenWorksheet[] = [];
  const empty: string[] = [];
  const items: HumanQueueItem[] = [];
  const incomplete: IncompleteQueueCell[] = [];
  let autoApproved = 0;

  const sorted = [...lanes].sort((left, right) => left.worksheet.localeCompare(right.worksheet, "zh"));
  for (const lane of sorted) {
    if (laneIsOpen(lane)) {
      excluded.push({
        worksheet: lane.worksheet,
        reason: lane.pending_verify_cells
          ? `${lane.pending_verify_cells} pending image-text verification cells`
          : lane.pending_cells
            ? `${lane.pending_cells} pending review cells`
            : `inventory ${lane.inventory_status ?? "open"}`,
      });
      continue;
    }
    if (!lane.pkg) {
      empty.push(lane.worksheet);
      continue;
    }
    included.push(lane.worksheet);
    for (const cell of lane.pkg.cells) {
      if (cell.approved === true) {
        autoApproved += 1;
        continue;
      }
      if (!isHumanQueueCandidate(cell)) continue;
      const missing = missingQueueFields(cell);
      if (missing.length > 0) {
        incomplete.push({ key: cell.key, worksheet: cell.worksheet, missing, source_package: lane.package_path ?? "" });
        continue;
      }
      items.push({
        key: cell.key,
        worksheet: cell.worksheet,
        row: cell.row,
        column: cell.column,
        cell_image: cell.cell_image as string,
        conflict_image: cell.conflict_image,
        formula_bar_value: cell.formula_bar_value as string,
        course: nonempty(cell.context?.course),
        teacher: nonempty(cell.context?.teacher),
        reason: humanQueueReason(cell),
        reason_detail: cell.unresolved_reason,
        decision: "",
        note: "",
        source_package: lane.package_path ?? "",
      });
    }
  }

  items.sort((left, right) => left.key.localeCompare(right.key, "zh"));
  return {
    contract_version: HUMAN_QUEUE_CONTRACT_VERSION,
    status: items.length > 0 ? "ready" : "empty",
    included_worksheets: included,
    excluded_open_worksheets: excluded,
    empty_worksheets: empty,
    queue_cells: items.length,
    auto_approved_cells: autoApproved,
    incomplete_cells: incomplete.length,
    items,
    incomplete,
  };
}

export function parseHumanDecision(raw: string | undefined): HumanDecision | "" {
  if (raw == null) return "";
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  return DECISION_ALIASES[trimmed] ?? "";
}

export function parseDecisionRecords(raw: unknown): HumanDecisionRecord[] {
  if (!isRecord(raw) || !Array.isArray(raw.items)) throw new Error("decisions file must contain items");
  const seen = new Set<string>();
  const records: HumanDecisionRecord[] = [];
  for (const item of raw.items) {
    if (!isRecord(item) || typeof item.key !== "string") throw new Error("invalid decision item");
    const decision = parseHumanDecision(typeof item.decision === "string" ? item.decision : "");
    if (!decision) continue;
    if (seen.has(item.key)) throw new Error(`duplicate decision key: ${item.key}`);
    seen.add(item.key);
    records.push({
      key: item.key,
      decision,
      note: typeof item.note === "string" ? item.note : "",
    });
  }
  return records;
}

export function compileApprovedFromDecisions(
  lanes: LaneSource[],
  decisions: HumanDecisionRecord[],
): ReviewApprovedPackage {
  const queue = buildHumanQueue(lanes);
  const byKey = new Map(queue.items.map((item) => [item.key, item]));
  const decisionByKey = new Map(decisions.map((item) => [item.key, item]));
  for (const key of decisionByKey.keys()) {
    if (!byKey.has(key)) throw new Error(`decision key is not in the closed-lane human queue: ${key}`);
  }

  const evaluations: ApprovedEvaluation[] = [];
  const excluded: ExcludedEvaluation[] = [];
  let undecided = 0;

  for (const lane of lanes) {
    if (laneIsOpen(lane) || !lane.pkg) continue;
    for (const cell of lane.pkg.cells) {
      if (cell.approved !== true) continue;
      evaluations.push(evaluationFromCell(cell, "auto_verify"));
    }
  }

  for (const item of queue.items) {
    const decision = decisionByKey.get(item.key);
    if (!decision) {
      undecided += 1;
      continue;
    }
    if (decision.decision === "pass") {
      evaluations.push({
        key: item.key,
        worksheet: item.worksheet,
        row: item.row,
        column: item.column,
        body: item.formula_bar_value,
        body_source: "formula_bar",
        course: item.course,
        teacher: item.teacher,
        cell_image: item.cell_image,
        conflict_image: item.conflict_image,
        approval_source: "human_pass",
        formula_bar_text_sha256: sha256Text(item.formula_bar_value),
      });
      continue;
    }
    excluded.push({
      key: item.key,
      worksheet: item.worksheet,
      decision: decision.decision,
      note: decision.note,
      reason: item.reason,
    });
  }

  evaluations.sort((left, right) => left.key.localeCompare(right.key, "zh"));
  const courses = uniqueLabels(evaluations.map((item) => item.course)).map((course_label) => ({ course_label }));
  const teachers = uniqueLabels(evaluations.map((item) => item.teacher)).map((teacher_label) => ({ teacher_label }));
  const pairs = uniquePairs(evaluations);
  return {
    contract_version: REVIEW_APPROVED_PACKAGE_CONTRACT,
    status: "completed",
    auto_approved_cells: evaluations.filter((item) => item.approval_source === "auto_verify").length,
    human_passed_cells: evaluations.filter((item) => item.approval_source === "human_pass").length,
    excluded_cells: excluded.length,
    undecided_cells: undecided,
    evaluations,
    courses,
    teachers,
    course_teachers: pairs,
    excluded,
  };
}

export function humanQueueCsv(queue: HumanQueue) {
  const header = ["键", "工作表", "行", "列", "截图", "冲突图", "公式栏原文", "课名", "教师", "未批准原因", "决定", "备注"];
  const rows = queue.items.map((item) => [
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
    decisionLabel(item.decision),
    item.note,
  ]);
  return `\ufeff${[header, ...rows].map(csvRow).join("\n")}\n`;
}

export function humanQueueHtml(queue: HumanQueue) {
  const rows = queue.items.map((item) => {
    const image = fileHref(item.cell_image);
    const conflict = item.conflict_image ? fileHref(item.conflict_image) : "";
    return `<tr>
<td>${escapeHtml(item.key)}</td>
<td>${escapeHtml(item.worksheet)}</td>
<td>${item.row}</td>
<td>${escapeHtml(item.column)}</td>
<td><a href="${escapeHtml(image)}">${escapeHtml(item.cell_image)}</a></td>
<td>${conflict ? `<a href="${escapeHtml(conflict)}">${escapeHtml(item.conflict_image ?? "")}</a>` : ""}</td>
<td><pre>${escapeHtml(item.formula_bar_value)}</pre></td>
<td>${escapeHtml(item.course ?? "")}</td>
<td>${escapeHtml(item.teacher ?? "")}</td>
<td>${escapeHtml(item.reason)}</td>
<td></td>
<td></td>
</tr>`;
  }).join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>人工核验队列</title>
<p>只含 #316 已收口表中未自动批准且非 not_applicable 的格。决定列填 通过 / 驳回 / 跳过。不得改写公式栏原文。</p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>键</th><th>工作表</th><th>行</th><th>列</th><th>截图</th><th>冲突图</th><th>公式栏原文</th><th>课名</th><th>教师</th><th>未批准原因</th><th>决定</th><th>备注</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
`;
}

export async function discoverLaneSources(packagesRoot: string): Promise<LaneSource[]> {
  const root = resolve(packagesRoot);
  const entries = await readdir(root, { withFileTypes: true });
  const lanes: LaneSource[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const packagePath = join(dir, "package.json");
    const summaryPath = join(dir, "inventory-summary.json");
    const pkg = await readJsonIfExists(packagePath);
    const summary = await readJsonIfExists(summaryPath);
    lanes.push({
      worksheet: entry.name,
      package_path: pkg ? packagePath : null,
      inventory_status: typeof summary?.status === "string" ? summary.status : null,
      pending_cells: typeof summary?.pending_cells === "number" ? summary.pending_cells : 0,
      pending_verify_cells: typeof summary?.pending_verify_cells === "number" ? summary.pending_verify_cells : 0,
      pkg: isReviewPackage(pkg) ? pkg : null,
    });
  }
  return lanes;
}

export async function writeHumanQueueArtifacts(outDir: string, queue: HumanQueue) {
  assertHumanQueueOutputPath(outDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "human-queue.json"), `${JSON.stringify(queue, null, 2)}\n`);
  await writeFile(join(outDir, "human-queue.csv"), humanQueueCsv(queue));
  await writeFile(join(outDir, "human-queue.html"), humanQueueHtml(queue));
}

export async function writeApprovedPackageArtifacts(outDir: string, compiled: ReviewApprovedPackage) {
  assertHumanQueueOutputPath(outDir);
  await mkdir(outDir, { recursive: true });
  const files = {
    "evaluations.jsonl": jsonl(compiled.evaluations),
    "courses.jsonl": jsonl(compiled.courses),
    "teachers.jsonl": jsonl(compiled.teachers),
    "course_teachers.jsonl": jsonl(compiled.course_teachers),
    "excluded.jsonl": jsonl(compiled.excluded),
  };
  const declared: Record<string, { sha256: string; rows: number }> = {};
  for (const [name, body] of Object.entries(files)) {
    const path = join(outDir, name);
    await writeFile(path, body);
    declared[name] = { sha256: sha256Text(body), rows: body === "" ? 0 : body.trimEnd().split("\n").length };
  }
  const manifest = {
    contract_version: REVIEW_APPROVED_PACKAGE_CONTRACT,
    status: compiled.status,
    auto_approved_cells: compiled.auto_approved_cells,
    human_passed_cells: compiled.human_passed_cells,
    excluded_cells: compiled.excluded_cells,
    undecided_cells: compiled.undecided_cells,
    files: declared,
    wrote_tencent_or_business_db: false,
  };
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function evaluationFromCell(cell: CompiledCell, source: ApprovedEvaluation["approval_source"]): ApprovedEvaluation {
  return {
    key: cell.key,
    worksheet: cell.worksheet,
    row: cell.row,
    column: cell.column,
    body: cell.formula_bar_value ?? "",
    body_source: "formula_bar",
    course: nonempty(cell.context?.course),
    teacher: nonempty(cell.context?.teacher),
    cell_image: cell.cell_image,
    conflict_image: cell.conflict_image,
    approval_source: source,
    formula_bar_text_sha256: cell.formula_bar_text_sha256,
  };
}

function uniqueLabels(values: Array<string | null>) {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value !== ""))].sort((left, right) => left.localeCompare(right, "zh"));
}

function uniquePairs(evaluations: ApprovedEvaluation[]) {
  const seen = new Set<string>();
  const pairs: { course_label: string; teacher_label: string }[] = [];
  for (const item of evaluations) {
    const course = item.course?.trim() ?? "";
    const teacher = item.teacher?.trim() ?? "";
    if (!course || !teacher) continue;
    const key = `${course}\u001f${teacher}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ course_label: course, teacher_label: teacher });
  }
  return pairs.sort((left, right) => `${left.course_label}|${left.teacher_label}`.localeCompare(`${right.course_label}|${right.teacher_label}`, "zh"));
}

function decisionLabel(decision: HumanQueueItem["decision"]) {
  if (decision === "pass") return "通过";
  if (decision === "reject") return "驳回";
  if (decision === "skip") return "跳过";
  return "";
}

function csvRow(values: string[]) {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fileHref(path: string) {
  const resolved = resolve(path).replaceAll("\\", "/");
  return encodeURI(`file:///${resolved.replace(/^\/+/, "")}`);
}

function jsonl(rows: unknown[]) {
  return rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isReviewPackage(value: unknown): value is ReviewPackage {
  return isRecord(value) && Array.isArray(value.cells) && (value.status === "completed" || value.status === "completed_with_exceptions");
}

async function readJsonIfExists(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function csvToDecisionItems(csv: string) {
  const rows = parseCsv(csv.replace(/^\ufeff/, ""));
  if (rows.length < 2) return { items: [] as Array<{ key: string; decision: string; note: string }> };
  const header = rows[0];
  const keyIndex = header.indexOf("键");
  const decisionIndex = header.indexOf("决定");
  const noteIndex = header.indexOf("备注");
  if (keyIndex < 0 || decisionIndex < 0) throw new Error("decisions CSV must have 键 and 决定 columns");
  return {
    items: rows.slice(1).map((cols) => ({
      key: cols[keyIndex] ?? "",
      decision: cols[decisionIndex] ?? "",
      note: noteIndex >= 0 ? cols[noteIndex] ?? "" : "",
    })),
  };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(current);
      current = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(current);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function nonempty(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
