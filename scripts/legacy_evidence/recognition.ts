import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const RECOGNITION_CONTRACT_VERSION = "recapture-recognition-v1";
export const RECOGNITION_ENVELOPE_SCHEMA_VERSION = "recapture-recognition-envelope-v1";
export const DEFAULT_MAX_CONCURRENT_GROUPS = 2;

export type RecognitionGroup = { sheet: string; rows: [number, number]; context_columns: string; review_columns: string; course_anchor?: string; note?: string };
type RecaptureManifest = { batch: string; status: string; validation_limitations?: string[]; groups: RecognitionGroup[]; files: string[] | Record<string, string>; hashes?: Record<string, string> };
export type RecognitionRunnerRequest = { group: RecognitionGroup; imageFiles: string[]; structuralData: object; prompt: string; groupDir: string };
export type RecognitionRunner = (request: RecognitionRunnerRequest) => Promise<any>;
export type GroupResult = { sheet: string; status: string; counts?: Record<string, number>; errors: string[] };

export async function runRecognitionTrial(options: { manifestPath: string; outDir: string; runner?: RecognitionRunner; maxConcurrentGroups?: number; sheets?: string[] }) {
  const manifestPath = resolve(options.manifestPath);
  const inputDir = dirname(manifestPath);
  const outDir = resolve(options.outDir);
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as RecaptureManifest;
  const manifest = normalizeManifest(parsed);
  await validateManifest(manifest, inputDir);
  await mkdir(join(outDir, "groups"), { recursive: true });
  await writeJson(join(outDir, "run.json"), { batch: manifest.batch, contract_version: RECOGNITION_CONTRACT_VERSION, mode: "read_only", started_at: new Date().toISOString() });
  const runner = options.runner ?? codexRecognitionRunner;
  const groups = options.sheets?.length ? manifest.groups.filter((group) => options.sheets!.includes(group.sheet)) : manifest.groups;
  const unknownSheets = options.sheets?.filter((sheet) => !manifest.groups.some((group) => group.sheet === sheet)) ?? [];
  if (unknownSheets.length) throw new Error(`unknown recognition groups: ${unknownSheets.join(", ")}`);
  const results = await mapConcurrent(groups, Math.min(DEFAULT_MAX_CONCURRENT_GROUPS, options.maxConcurrentGroups ?? DEFAULT_MAX_CONCURRENT_GROUPS), async (group) => {
    const relativeFiles = manifest.files.filter((file) => file.startsWith(`${group.sheet}/`));
    const imageFiles = relativeFiles.map((file) => resolve(inputDir, file));
    return processGroup(group, imageFiles, manifest, outDir, runner);
  });
  const summary = { batch: manifest.batch, contract_version: RECOGNITION_CONTRACT_VERSION, mode: "read_only", groups: results, completed_at: new Date().toISOString() };
  await writeJson(join(outDir, "summary.json"), summary);
  await writeFile(join(outDir, "summary.md"), renderSummary(summary));
  return { status: results.every((result) => !["failed", "recapture_required", "manifest_mismatch"].includes(result.status)) ? 0 : 1, groups: results };
}

async function processGroup(group: RecognitionGroup, imageFiles: string[], manifest: RecaptureManifest, outDir: string, runner: RecognitionRunner): Promise<GroupResult> {
  const groupDir = join(outDir, "groups", group.sheet);
  await mkdir(groupDir, { recursive: true });
  const structuralData = { worksheet: group.sheet, rows: group.rows, context_columns: group.context_columns, review_columns: group.review_columns, course_anchor: group.course_anchor ?? null, note: group.note ?? null, validation_limitations: manifest.validation_limitations ?? [], files: imageFiles.map((file) => basename(file)), contract_version: RECOGNITION_CONTRACT_VERSION };
  await writeJson(join(groupDir, "input.json"), { ...structuralData, hashes: Object.fromEntries(imageFiles.map((path) => [basename(path), manifest.hashes![`${group.sheet}/${basename(path)}`]])) });
  try {
    const rawEnvelope = await runner({ group, imageFiles, structuralData, prompt: buildRecognitionPrompt(structuralData, imageFiles), groupDir });
    await writeJson(join(groupDir, "raw_envelope.json"), rawEnvelope);
    const envelope = normalizeRecognitionEnvelope(group, rawEnvelope);
    await writeJson(join(groupDir, "normalized_envelope.json"), envelope);
    const qa = envelope?.capture_qa;
    await writeJson(join(groupDir, "capture_qa.json"), qa ?? { status: "manifest_mismatch", issues: ["Capture QA output missing"] });
    if (!qa || qa.status !== "accepted") {
      const status = ["recapture_required", "manifest_mismatch"].includes(qa?.status) ? qa.status : "manifest_mismatch";
      await writeJson(join(groupDir, "status.json"), { status, errors: Array.isArray(qa?.issues) ? qa.issues : ["invalid Capture QA output"] });
      return { sheet: group.sheet, status, errors: Array.isArray(qa?.issues) ? qa.issues : ["invalid Capture QA output"] };
    }
    await writeJson(join(groupDir, "analysis_a.json"), envelope.analysis_a);
    await writeJson(join(groupDir, "analysis_b.json"), envelope.analysis_b);
    await writeJson(join(groupDir, "arbitration.json"), envelope.arbitration);
    const errors = validateEnvelope(group, imageFiles, envelope);
    if (errors.length) {
      await writeJson(join(groupDir, "validation.json"), { valid: false, errors });
      await writeJson(join(groupDir, "status.json"), { status: "failed", errors });
      return { sheet: group.sheet, status: "failed", errors };
    }
    const { diff, inventory, counts } = buildArtifacts(group, envelope);
    await writeJson(join(groupDir, "diff.json"), diff);
    await writeFile(join(groupDir, "diff.md"), renderDiff(diff));
    await writeJson(join(groupDir, "inventory.json"), inventory);
    await writeJson(join(groupDir, "validation.json"), { valid: true, errors: [], expected_cells: inventory.cells.length, unique_keys: inventory.cells.length, references_valid: true });
    const status = counts.unresolved > 0 || counts.unreadable > 0 || counts.out_of_range > 0 ? "completed_with_exceptions" : "completed";
    await writeJson(join(groupDir, "status.json"), { status, counts });
    return { sheet: group.sheet, status, counts, errors: [] };
  } catch (error) {
    const errors = [error instanceof Error ? error.message : String(error)];
    await writeJson(join(groupDir, "failure.json"), { errors });
    await writeJson(join(groupDir, "status.json"), { status: "failed", errors });
    return { sheet: group.sheet, status: "failed", errors };
  }
}

export function normalizeRecognitionEnvelope(group: RecognitionGroup, source: any) {
  const envelope = structuredClone(source);
  const observedRows = envelope.capture_qa?.observed_rows;
  if (Array.isArray(observedRows) && observedRows.length > 2) envelope.capture_qa.observed_rows = [observedRows[0], observedRows.at(-1)];
  if (!envelope.capture_qa?.observed_review_columns && Array.isArray(envelope.capture_qa?.review_column_names)) {
    envelope.capture_qa.observed_review_columns = envelope.capture_qa.review_column_names;
  }
  const observedColumns = envelope.capture_qa?.observed_review_columns;
  if (Array.isArray(observedColumns) && observedColumns.every((item: unknown) => typeof item === "string")) {
    const [firstColumn, lastColumn] = group.review_columns.split(":");
    const letters = columnRange(firstColumn, lastColumn);
    if (observedColumns.length === letters.length) envelope.capture_qa.observed_review_columns = observedColumns.map((name: string, index: number) => ({ column: letters[index], name }));
  }
  const columnNames = new Map<string, string>((Array.isArray(envelope.capture_qa?.observed_review_columns) ? envelope.capture_qa.observed_review_columns : []).flatMap((item: any) => typeof item?.column === "string" && typeof item?.name === "string" ? [[item.column.toUpperCase(), item.name] as const] : []));
  if (Array.isArray(envelope.subagents)) {
    envelope.subagents = {
      analysis_a: normalizeSubagent(envelope.subagents[0]),
      analysis_b: normalizeSubagent(envelope.subagents[1]),
    };
  }
  for (const side of ["analysis_a", "analysis_b"] as const) {
    const analysis = envelope[side] ?? { context_index: [], cells: [] };
    analysis.context_index = (analysis.context_index ?? []).map((item: any) => ({
      ...item,
      row: item.row ?? item.context_row,
      anchor: item.anchor ?? group.course_anchor ?? null,
    }));
    analysis.cells = (analysis.cells ?? []).map((cell: any) => {
      const [worksheet, row, reviewColumn] = String(cell.key ?? "").split("|");
      const explicitReviewColumn = String(cell.review_column ?? reviewColumn ?? "");
      const normalizedReviewColumn = explicitReviewColumn.toUpperCase() === String(reviewColumn).toUpperCase() ? columnNames.get(explicitReviewColumn.toUpperCase()) ?? explicitReviewColumn : explicitReviewColumn;
      return {
        ...cell,
        key: cell.key ? `${worksheet}|${row}|${normalizedReviewColumn}` : `${group.sheet}|${cell.context_row}|${normalizedReviewColumn}`,
        row: cell.row ?? Number(row),
        review_column: normalizedReviewColumn,
        context_row: cell.context_row ?? Number(row),
        raw_transcription: cell.raw_transcription ?? null,
        corrected_text: cell.corrected_text ?? cell.raw_transcription ?? null,
        edits: cell.edits ?? [],
        uncertainty_markers: cell.uncertainty_markers ?? [],
        worksheet: cell.worksheet ?? worksheet,
      };
    });
    envelope[side] = analysis;
  }
  if (Array.isArray(envelope.arbitration)) envelope.arbitration = { cells: envelope.arbitration };
  if (Array.isArray(envelope.arbitration?.cells)) envelope.arbitration.cells = envelope.arbitration.cells.map((cell: any) => {
    const [worksheet, row, reviewColumn] = String(cell.key ?? "").split("|");
    const name = columnNames.get(String(reviewColumn).toUpperCase());
    return name ? { ...cell, key: `${worksheet}|${row}|${name}` } : cell;
  });
  return envelope;
}

function normalizeSubagent(value: any) {
  return { ...value, task_id: value?.task_id ?? value?.id ?? "unknown" };
}

function validateEnvelope(group: RecognitionGroup, imageFiles: string[], envelope: any) {
  const errors: string[] = validateRecognitionEnvelopeSchema(envelope);
  if (envelope.subagents?.analysis_a?.status !== "completed") errors.push("analysis_a subagent did not complete");
  if (envelope.subagents?.analysis_b?.status !== "completed") errors.push("analysis_b subagent did not complete");
  const columns = envelope.capture_qa?.observed_review_columns;
  const [firstRow, lastRow] = group.rows;
  const [firstColumn, lastColumn] = group.review_columns.split(":");
  const expectedColumnLetters = columnRange(firstColumn, lastColumn);
  const observedColumnLetters = Array.isArray(columns) ? columns.map((item: any) => String(item.column).toUpperCase()) : [];
  if (!Array.isArray(columns) || columns.length !== expectedColumnLetters.length || new Set(columns?.map((item: any) => item.name)).size !== expectedColumnLetters.length || JSON.stringify(observedColumnLetters) !== JSON.stringify(expectedColumnLetters)) errors.push("Capture QA review columns do not match manifest range");
  if (JSON.stringify(envelope.capture_qa?.observed_rows) !== JSON.stringify(group.rows)) errors.push("Capture QA observed rows do not match manifest rows");
  const expectedKeys = new Set<string>();
  for (let row = firstRow; row <= lastRow; row += 1) for (const column of columns ?? []) expectedKeys.add(`${group.sheet}|${row}|${column.name}`);
  for (const side of ["analysis_a", "analysis_b"] as const) {
    const context = envelope[side]?.context_index;
    const cells = envelope[side]?.cells;
    if (!Array.isArray(context) || context.length !== lastRow - firstRow + 1 || new Set(context?.map((item: any) => item.row)).size !== lastRow - firstRow + 1) errors.push(`${side} context index is incomplete or duplicated`);
    const contextRows = new Set(Array.isArray(context) ? context.map((item: any) => item.row) : []);
    for (let row = firstRow; row <= lastRow; row += 1) if (!contextRows.has(row)) errors.push(`${side} context index does not match declared rows`);
    for (const row of contextRows) if (typeof row !== "number" || row < firstRow || row > lastRow) errors.push(`${side} context index contains row outside declared rows`);
    const seen = new Set<string>();
    for (const cell of Array.isArray(cells) ? cells : []) {
      if (seen.has(cell.key)) errors.push(`${side} duplicate key ${cell.key}`);
      seen.add(cell.key);
      if (!expectedKeys.has(cell.key)) errors.push(`${side} unexpected key ${cell.key}`);
      if (cell.key !== `${group.sheet}|${cell.row}|${cell.review_column}`) errors.push(`${side} key fields do not match ${cell.key}`);
      if (cell.context_row !== cell.row || !context?.some((item: any) => item.row === cell.context_row)) errors.push(`${side} invalid context reference ${cell.key}`);
      if (!["blank", "review", "unreadable", "out_of_range"].includes(cell.status)) errors.push(`${side} invalid cell status ${cell.key}`);
      if (cell.status === "out_of_range" && !envelope.capture_qa?.out_of_range_cells?.includes(cell.key)) errors.push(`${side} out_of_range not established by Capture QA: ${cell.key}`);
    }
    for (const key of expectedKeys) if (!seen.has(key)) errors.push(`${side} missing key ${key}`);
  }
  const arbitrationCells = Array.isArray(envelope.arbitration?.cells) ? envelope.arbitration.cells : [];
  const arbitrationKeys = new Set<string>();
  for (const cell of arbitrationCells) {
    if (arbitrationKeys.has(cell.key)) errors.push(`arbitration duplicate key ${cell.key}`);
    arbitrationKeys.add(cell.key);
    if (!expectedKeys.has(cell.key)) errors.push(`arbitration unexpected key ${cell.key}`);
  }
  for (const key of expectedKeys) if (!arbitrationKeys.has(key)) errors.push(`arbitration missing key ${key}`);
  for (const file of imageFiles) if (!envelope.capture_qa?.worksheet || envelope.capture_qa.worksheet !== group.sheet) errors.push(`Capture QA worksheet mismatch for ${basename(file)}`);
  return [...new Set(errors)];
}

export function validateRecognitionEnvelopeSchema(envelope: unknown) {
  const errors: string[] = [];
  if (!isRecord(envelope)) return ["schema: envelope must be an object"];
  for (const field of ["session_id", "capture_qa", "subagents", "analysis_a", "analysis_b", "arbitration"]) {
    if (!(field in envelope)) errors.push(`schema: missing ${field}`);
  }
  if (typeof envelope.session_id !== "string") errors.push("schema: session_id must be a string");
  const qa = envelope.capture_qa;
  if (!isRecord(qa)) errors.push("schema: capture_qa must be an object");
  else {
    if (!["accepted", "recapture_required", "manifest_mismatch"].includes(String(qa.status))) errors.push("schema: invalid capture_qa.status");
    if (typeof qa.worksheet !== "string") errors.push("schema: capture_qa.worksheet must be a string");
    if (!Array.isArray(qa.observed_rows) || qa.observed_rows.length !== 2 || !qa.observed_rows.every(Number.isInteger)) errors.push("schema: capture_qa.observed_rows must be [first,last]");
    if (!Array.isArray(qa.observed_review_columns) || !qa.observed_review_columns.every((item) => isRecord(item) && typeof item.column === "string" && typeof item.name === "string")) errors.push("schema: invalid capture_qa.observed_review_columns");
  }
  const subagents = envelope.subagents;
  if (!isRecord(subagents)) errors.push("schema: subagents must be an object");
  else for (const side of ["analysis_a", "analysis_b"]) {
    const agent = subagents[side];
    if (!isRecord(agent) || typeof agent.task_id !== "string" || !["completed", "failed"].includes(String(agent.status))) errors.push(`schema: invalid subagents.${side}`);
  }
  for (const side of ["analysis_a", "analysis_b"]) {
    const analysis = envelope[side];
    if (!isRecord(analysis) || !Array.isArray(analysis.context_index) || !Array.isArray(analysis.cells)) {
      errors.push(`schema: invalid ${side}`);
      continue;
    }
    for (const context of analysis.context_index) if (!isRecord(context) || !Number.isInteger(context.row) || typeof context.course !== "string" || typeof context.teacher !== "string" || !(context.anchor === null || typeof context.anchor === "string")) errors.push(`schema: invalid ${side}.context_index item`);
    for (const cell of analysis.cells) if (!isRecord(cell) || typeof cell.key !== "string" || !Number.isInteger(cell.row) || typeof cell.review_column !== "string" || !Number.isInteger(cell.context_row) || !["blank", "review", "unreadable", "out_of_range"].includes(String(cell.status)) || !(cell.raw_transcription === null || typeof cell.raw_transcription === "string") || !(cell.corrected_text === null || typeof cell.corrected_text === "string") || !Array.isArray(cell.edits) || !Array.isArray(cell.uncertainty_markers)) errors.push(`schema: invalid ${side}.cells item`);
  }
  const arbitration = envelope.arbitration;
  if (!isRecord(arbitration) || !Array.isArray(arbitration.cells)) errors.push("schema: invalid arbitration");
  else for (const cell of arbitration.cells) if (!isRecord(cell) || typeof cell.key !== "string" || !["agreed", "unresolved", "not_applicable"].includes(String(cell.conclusion)) || !["analysis_a", "analysis_b", null].includes(cell.selected) || typeof cell.reason !== "string") errors.push("schema: invalid arbitration.cells item");
  return [...new Set(errors)];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildArtifacts(group: RecognitionGroup, envelope: any) {
  const aByKey = new Map(envelope.analysis_a.cells.map((cell: any) => [cell.key, cell]));
  const bByKey = new Map(envelope.analysis_b.cells.map((cell: any) => [cell.key, cell]));
  const arbByKey = new Map(envelope.arbitration.cells.map((cell: any) => [cell.key, cell]));
  const cells: any[] = [];
  const differences: any[] = [];
  const counts: Record<string, number> = { blank: 0, review: 0, unreadable: 0, out_of_range: 0, unresolved: 0, agreed: 0 };
  for (const key of aByKey.keys()) {
    const a: any = aByKey.get(key); const b: any = bByKey.get(key); const proposed: any = arbByKey.get(key);
    const sameStatus = a.status === b.status;
    const rawSame = a.raw_transcription === b.raw_transcription;
    const contextA = envelope.analysis_a.context_index.find((item: any) => item.row === a.row);
    const contextB = envelope.analysis_b.context_index.find((item: any) => item.row === b.row);
    const contextSame = contextA?.course === contextB?.course && contextA?.teacher === contextB?.teacher && contextA?.anchor === contextB?.anchor;
    const noCorrection = (a.corrected_text == null || a.corrected_text === a.raw_transcription) && (b.corrected_text == null || b.corrected_text === b.raw_transcription);
    const clean = rawSame && noCorrection && (a.edits?.length ?? 0) === 0 && (b.edits?.length ?? 0) === 0 && !(a.raw_transcription ?? "").includes("[unclear]") && !(b.raw_transcription ?? "").includes("[unclear]") && (a.uncertainty_markers?.length ?? 0) === 0 && (b.uncertainty_markers?.length ?? 0) === 0;
    const conclusion = !contextSame
      ? "unresolved"
      : a.status === "review" && b.status === "review" && sameStatus && clean && proposed?.conclusion === "agreed"
        ? "agreed"
        : a.status === "blank" && b.status === "blank" ? "not_applicable" : "unresolved";
    if (!sameStatus || !rawSame || !contextSame || conclusion !== proposed?.conclusion) differences.push({ key, fields: { status: [a.status, b.status], raw_transcription: [a.raw_transcription, b.raw_transcription], context: [contextA, contextB], proposed_conclusion: proposed?.conclusion, enforced_conclusion: conclusion }, char_diff: charDiff(a.raw_transcription, b.raw_transcription) });
    counts[a.status] += 1;
    if (conclusion === "unresolved") counts.unresolved += 1;
    if (conclusion === "agreed") counts.agreed += 1;
    cells.push({ key, row: a.row, review_column: a.review_column, context_row: a.context_row, status: a.status, conclusion, analysis_a: a, analysis_b: b, arbitration: proposed });
  }
  return { diff: { worksheet: group.sheet, differences }, inventory: { worksheet: group.sheet, rows: group.rows, review_columns: envelope.capture_qa.observed_review_columns, context_index: envelope.analysis_a.context_index, cells }, counts };
}

export function buildRecognitionPrompt(structuralData: object, imageFiles: string[]) {
  return `You are the Sol orchestrator for one worksheet recognition group. Use only the attached images, the manifest-derived structural data, and this recognition contract. Do not inspect repository files, issues, ADRs, instructions, or external context.\n\nSTRUCTURAL DATA:\n${JSON.stringify(structuralData, null, 2)}\n\nIMAGES:\n${imageFiles.map((file) => resolve(file)).join("\n")}\n\nFirst perform Capture QA yourself against every image: actual worksheet, first/last source rows, context/review alignment, headers and filenames, column coverage, crop, readability, and course anchor. Status is accepted, recapture_required, or manifest_mismatch. The manifest limitations are unresolved until visually checked. observed_rows is exactly [first_row,last_row], not a list of every row. If not accepted, do not spawn recognition agents; return empty context_index/cells/arbitration.cells and failed subagent statuses solely to satisfy the output schema.\n\nIf accepted, spawn exactly two mutually invisible agents using agent_type=default and fork_turns=none. Each child receives only the same image paths, STRUCTURAL DATA, and the recognition contract below. Children must not inspect any other files or context. Both inspect columns, context, and every reviews image. Wait for both to complete.\n\nCONTRACT: Build exactly one context_index item for every declared source row. Each context item uses fields row, course, teacher, and anchor. Teacher comes only from the same row. Course comes only from a visible cell or declared anchor. For each source-row x observed-review-column-name key, emit exactly one cell with key, row, review_column, context_row, status, raw_transcription, corrected_text, edits, and uncertainty_markers. Status is blank, review, unreadable, or out_of_range. out_of_range is allowed only when Capture QA explicitly lists the key. Stable key format is worksheet|row|review-column-name; never use bbox. Review cells reference context_row and do not rewrite course or teacher. Preserve raw_transcription; corrections are separate. Use [unclear], never guess.\n\nAfter both children complete, arbitrate only from the images and their outputs. Never invent a third transcription. Preserve both outputs. A cell may be agreed only when both raw strings are exactly identical, context agrees, neither has edits, punctuation differences, uncertainty, or [unclear]. Blank/nonblank disagreement, missing/duplicate keys, or context/anchor conflict is unresolved. Return JSON only with this exact top-level shape: {session_id,capture_qa,subagents:{analysis_a:{task_id,status},analysis_b:{task_id,status}},analysis_a:{context_index,cells},analysis_b:{context_index,cells},arbitration:{cells}}. Arbitration cells contain key, conclusion (agreed|unresolved|not_applicable), selected (analysis_a, analysis_b, or null), and reason.`;
}

async function codexRecognitionRunner(request: RecognitionRunnerRequest) {
  const runtimeRoot = await makeRuntime();
  const promptPath = join(request.groupDir, "orchestrator.prompt.txt");
  const outputPath = join(request.groupDir, "orchestrator.response.json");
  try {
    const stagedImages = await stageRecognitionImages(request.imageFiles, runtimeRoot.work);
    const prompt = buildRecognitionPrompt(request.structuralData, stagedImages);
    await writeFile(promptPath, prompt);
    const args = ["exec", "--enable", "multi_agent", "--enable", "multi_agent_v2", "-c", 'agents.default_subagent_model="gpt-5.6-luna"', "-c", 'agents.default_subagent_reasoning_effort="low"', "-C", runtimeRoot.work, "-m", "gpt-5.6-sol", "-s", "danger-full-access", "--color", "never", ...stagedImages.flatMap((file) => ["-i", file]), "-o", outputPath, "-"];
    const rawLog = join(request.groupDir, "orchestrator.raw.log");
    const initial = await runCodexProcess(args, prompt, runtimeRoot, rawLog);
    let parsed: any;
    let schemaErrors: string[];
    try {
      parsed = JSON.parse(await readFile(outputPath, "utf8"));
      schemaErrors = validateRecognitionEnvelopeSchema(normalizeRecognitionEnvelope(request.group, parsed));
    } catch (error) {
      schemaErrors = [`schema: invalid JSON: ${error instanceof Error ? error.message : String(error)}`];
    }
    if (!schemaErrors.length) return parsed;

    const sessionId = initial.raw.match(/session id:\s*([0-9a-f-]{36})/i)?.[1];
    if (!sessionId) throw new Error(`format validation failed and session id is unavailable: ${schemaErrors.join("; ")}`);
    const initialOutputPath = join(request.groupDir, "orchestrator.initial.response.txt");
    try { await copyFile(outputPath, initialOutputPath); } catch {}
    await writeJson(join(request.groupDir, "orchestrator.format-validation.json"), { schema_version: RECOGNITION_ENVELOPE_SCHEMA_VERSION, valid: false, errors: schemaErrors, repair_attempts: 1, session_id: sessionId });
    const repairOutputPath = join(request.groupDir, "orchestrator.repaired.response.json");
    const repairPrompt = buildFormatRepairPrompt(schemaErrors);
    const repairArgs = ["exec", "resume", "--enable", "multi_agent", "-m", "gpt-5.6-sol", "--dangerously-bypass-approvals-and-sandbox", "-o", repairOutputPath, sessionId, "-"];
    await runCodexProcess(repairArgs, repairPrompt, runtimeRoot, join(request.groupDir, "orchestrator.repair.raw.log"));
    const repaired = JSON.parse(await readFile(repairOutputPath, "utf8"));
    const repairedErrors = validateRecognitionEnvelopeSchema(normalizeRecognitionEnvelope(request.group, repaired));
    await writeJson(join(request.groupDir, "orchestrator.format-validation.json"), { schema_version: RECOGNITION_ENVELOPE_SCHEMA_VERSION, valid: repairedErrors.length === 0, errors: repairedErrors, repair_attempts: 1, session_id: sessionId });
    if (repairedErrors.length) throw new Error(`format repair failed: ${repairedErrors.join("; ")}`);
    return repaired;
  } finally {
    await rm(runtimeRoot.root, { recursive: true, force: true });
  }
}

export async function stageRecognitionImages(imageFiles: string[], workDir: string) {
  const imageDir = join(workDir, "images");
  await mkdir(imageDir, { recursive: true });
  const staged: string[] = [];
  for (const [index, source] of imageFiles.entries()) {
    const destination = join(imageDir, `${String(index + 1).padStart(2, "0")}-${basename(source)}`);
    await copyFile(resolve(source), destination);
    staged.push(destination);
  }
  return staged;
}

export function buildFormatRepairPrompt(errors: string[]) {
  return `Your previous final response failed the output-format contract. Fix formatting only in the same session. Do not inspect images again, rerun agents, change any transcription, correction, context value, status, conclusion, or reason, and do not invent missing substantive content. Return the complete JSON envelope only. Validation errors:\n${errors.map((error) => `- ${error}`).join("\n")}`;
}

async function runCodexProcess(args: string[], prompt: string, runtimeRoot: { home: string; work: string }, rawLog: string) {
  let raw = "";
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("codex", args, { cwd: runtimeRoot.work, env: { ...process.env, CODEX_HOME: runtimeRoot.home }, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
    child.stdout.on("data", (chunk) => raw += chunk); child.stderr.on("data", (chunk) => raw += chunk);
    child.on("error", reject); child.on("close", async (code) => { await writeFile(rawLog, raw); code === 0 ? resolvePromise() : reject(new Error(`codex exec exited ${code}: ${raw.slice(-2000)}`)); });
    child.stdin.end(prompt);
  });
  return { raw };
}

async function makeRuntime() {
  const root = join(tmpdir(), `jufexk-recognition-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const home = join(root, "codex-home"); const work = join(root, "work");
  await mkdir(home, { recursive: true }); await mkdir(work, { recursive: true });
  const sourceHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  for (const name of ["auth.json", "config.toml"]) try { await copyFile(join(sourceHome, name), join(home, name)); } catch {}
  return { root, home, work };
}

function normalizeManifest(manifest: RecaptureManifest): RecaptureManifest & { files: string[]; hashes: Record<string, string> } {
  if (Array.isArray(manifest.files)) return { ...manifest, files: manifest.files, hashes: manifest.hashes ?? {} };
  return { ...manifest, files: Object.keys(manifest.files ?? {}), hashes: manifest.files ?? {} };
}

async function validateManifest(manifest: RecaptureManifest & { files: string[]; hashes: Record<string, string> }, inputDir: string) {
  if (!Array.isArray(manifest.groups) || manifest.groups.length !== 8) throw new Error(`expected 8 recognition groups, found ${manifest.groups?.length ?? 0}`);
  if (!Array.isArray(manifest.files) || manifest.files.length !== 48) throw new Error(`expected 48 recognition files, found ${manifest.files?.length ?? 0}`);
  if (new Set(manifest.files).size !== manifest.files.length) throw new Error("recognition manifest contains duplicate files");
  const declaredSheets = new Set(manifest.groups.map((group) => group.sheet));
  for (const group of manifest.groups) {
    const groupFiles = manifest.files.filter((file) => file.startsWith(`${group.sheet}/`));
    if (groupFiles.length !== 6) throw new Error(`expected 6 recognition files for ${group.sheet}, found ${groupFiles.length}`);
  }
  for (const file of manifest.files) {
    if (isAbsolute(file) || file.includes("\\") || file.split("/").some((part) => part === ".." || part === "." || part === "")) throw new Error(`recognition file path must stay inside the batch: ${file}`);
    const [sheet] = file.split("/");
    if (!declaredSheets.has(sheet)) throw new Error(`recognition file is not owned by a declared group: ${file}`);
    const resolvedFile = resolve(inputDir, file);
    const pathFromInput = relative(resolve(inputDir), resolvedFile);
    if (pathFromInput === ".." || pathFromInput.startsWith(`..${sep}`) || isAbsolute(pathFromInput)) throw new Error(`recognition file path escapes the batch: ${file}`);
    const actual = createHash("sha256").update(await readFile(resolvedFile)).digest("hex");
    if (actual !== manifest.hashes[file]) throw new Error(`hash mismatch: ${file}`);
  }
}

async function mapConcurrent<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => { while (true) { const index = next++; if (index >= items.length) return; results[index] = await task(items[index]); } }));
  return results;
}
function columnNumber(column: string) { return [...column.toUpperCase()].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0); }
function columnRange(first: string, last: string) {
  const columns: string[] = [];
  for (let value = columnNumber(first); value <= columnNumber(last); value += 1) columns.push(columnName(value));
  return columns;
}
function columnName(value: number) {
  let name = "";
  for (let current = value; current > 0; current = Math.floor((current - 1) / 26)) name = String.fromCharCode(65 + ((current - 1) % 26)) + name;
  return name;
}
function charDiff(a: unknown, b: unknown) { return a === b ? "" : `${JSON.stringify(a)} -> ${JSON.stringify(b)}`; }
function renderDiff(diff: any) { return `# ${diff.worksheet} Recognition Diff\n\n${diff.differences.length ? diff.differences.map((item: any) => `- ${item.key}: ${item.char_diff || "field difference"}`).join("\n") : "No differences.\n"}`; }
function renderSummary(summary: any) { return `# Read-only Recognition Trial\n\n${summary.groups.map((group: GroupResult) => `- ${group.sheet}: ${group.status}${group.counts ? ` (${Object.entries(group.counts).map(([key, value]) => `${key}=${value}`).join(", ")})` : ""}`).join("\n")}\n`; }
async function writeJson(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
