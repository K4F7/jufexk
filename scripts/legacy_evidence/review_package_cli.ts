import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  analysisPayload,
  applyAnalyses,
  applyArbitration,
  buildReviewInventory,
  compileReviewPackage,
  disagreements,
  loadScopedEvidence,
  loadSmokeImageOverrides,
  parseContextDocument,
  readJsonIfExists,
  resolveSmokeEvidenceDir,
  validateAnalysisResponse,
  validateArbitrationResponse,
  writeReviewJson,
  type CellAnalysis,
  type CellArbitration,
  type OcrEvidence,
  type ReviewAttempt,
  type RoutedCell,
} from "./review_package";

function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

function optionalOption(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : undefined;
}

function optionalInteger(name: string) {
  const raw = optionalOption(name);
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function usage() {
  return [
    "Usage:",
    "  pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts inventory --evidence-dir <dir> --context <json> --out <dir> [--worksheet <name>] [--first-row N] [--last-row N] [--ocr-dir <dir>] [--max-batches N] [--smoke-root <dir>]",
    "  pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts compile --inventory <json> --analyses <json> --out <dir>",
  ].join("\n");
}

async function loadContext(path: string) {
  return parseContextDocument(JSON.parse(await readFile(resolve(path), "utf8")));
}

async function detectSmokeRoot(contextPath: string, evidenceDir: string) {
  const explicit = optionalOption("--smoke-root");
  if (explicit) return resolve(explicit);
  for (const candidate of [dirname(resolve(contextPath)), resolve(evidenceDir)]) {
    try {
      await readFile(join(candidate, "smoke-manifest.json"), "utf8");
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function loadOcr(ocrDir?: string): Promise<Record<string, OcrEvidence>> {
  if (!ocrDir) return {};
  const summary = await readJsonIfExists(join(resolve(ocrDir), "cells.json"));
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
  const record = summary as Record<string, OcrEvidence>;
  return record;
}

async function inventoryCommand() {
  const outDir = resolve(option("--out"));
  const contextPath = option("--context");
  const requestedEvidence = option("--evidence-dir");
  const smokeRoot = await detectSmokeRoot(contextPath, requestedEvidence);
  const evidenceDir = smokeRoot ? await resolveSmokeEvidenceDir(smokeRoot) : requestedEvidence;
  const loaded = await loadScopedEvidence({
    evidence_dir: evidenceDir,
    worksheet: optionalOption("--worksheet"),
    first_row: optionalInteger("--first-row"),
    last_row: optionalInteger("--last-row"),
  });
  const prior = await readJsonIfExists(join(outDir, "matrix.json"));
  const attempts = await readJsonIfExists(join(outDir, "attempts.json"));
  const inventoryPath = join(outDir, "inventory.json");
  const ocrDir = optionalOption("--ocr-dir") ?? join(outDir, "ocr");
  const inventory = buildReviewInventory({
    evidence: loaded.evidence,
    context_index: await loadContext(contextPath),
    ocr_by_key: await loadOcr(ocrDir),
    image_base_by_key: loaded.image_base_by_key,
    image_overrides: smokeRoot ? await loadSmokeImageOverrides(smokeRoot) : {},
    worksheet: optionalOption("--worksheet"),
    first_row: optionalInteger("--first-row"),
    last_row: optionalInteger("--last-row"),
    max_batches: optionalInteger("--max-batches"),
    require_ocr: true,
    inventory_path: inventoryPath,
    ocr_dir: ocrDir,
    attempts: Array.isArray(attempts) ? attempts as ReviewAttempt[] : [],
    prior_cells: Array.isArray(prior?.cells) ? prior.cells as RoutedCell[] : [],
  });
  await mkdir(join(outDir, "batches"), { recursive: true });
  for (const batch of inventory.pending_batches) {
    await writeReviewJson(join(outDir, "batches", `${batch.task_id}-a.json`), analysisPayload(batch, "analysis_a"));
    await writeReviewJson(join(outDir, "batches", `${batch.task_id}-b.json`), analysisPayload(batch, "analysis_b"));
  }
  await writeReviewJson(join(outDir, "inventory.json"), inventory);
  const summary = {
    status: inventory.status,
    reason: inventory.reason,
    inventory_path: join(outDir, "inventory.json"),
    input_sha256: inventory.input_sha256,
    ocr_command: inventory.ocr_command,
    planned_cells: inventory.planned_cells,
    routed_cells: inventory.routed_cells,
    pending_cells: inventory.pending_cells,
    unresolved_cells: inventory.unresolved_cells,
    ocr_missing_cells: inventory.ocr_missing_cells,
    pending_batches: inventory.pending_batches.map((batch) => ({
      task_id: batch.task_id,
      worksheet: batch.worksheet,
      keys: batch.keys,
      payload_a: join(outDir, "batches", `${batch.task_id}-a.json`),
      payload_b: join(outDir, "batches", `${batch.task_id}-b.json`),
    })),
  };
  await writeFile(join(outDir, "inventory-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}

async function compileCommand() {
  const outDir = resolve(option("--out"));
  const inventory = await readJsonIfExists(resolve(option("--inventory")));
  const analyses = await readJsonIfExists(resolve(option("--analyses")));
  if (!inventory || !Array.isArray(inventory.cells)) throw new Error("inventory is missing cells");
  const analysisA = new Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>();
  const analysisB = new Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>();
  const arbitration = new Map<string, CellArbitration | { unresolved: "agent_exhausted" }>();
  const priorAttempts = await readJsonIfExists(join(outDir, "attempts.json"));
  const attempts: ReviewAttempt[] = [
    ...(Array.isArray(priorAttempts) ? priorAttempts as ReviewAttempt[] : []),
    ...(Array.isArray(analyses?.attempts) ? analyses.attempts : []),
  ];

  for (const batch of inventory.pending_batches ?? []) {
    const sideA = analyses?.analysis_a?.[batch.task_id];
    const sideB = analyses?.analysis_b?.[batch.task_id];
    if (sideA == null) {
      attempts.push({ task_id: batch.task_id, side: "analysis_a", status: "failed", cell_keys: batch.keys, error: "missing analysis_a" });
    } else {
      try {
        for (const cell of validateAnalysisResponse(batch.keys, sideA)) analysisA.set(cell.key, cell);
        attempts.push({ task_id: batch.task_id, side: "analysis_a", status: "completed", cell_keys: batch.keys });
      } catch (error) {
        attempts.push({ task_id: batch.task_id, side: "analysis_a", status: "failed", cell_keys: batch.keys, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (sideB == null) {
      attempts.push({ task_id: batch.task_id, side: "analysis_b", status: "failed", cell_keys: batch.keys, error: "missing analysis_b" });
    } else {
      try {
        for (const cell of validateAnalysisResponse(batch.keys, sideB)) analysisB.set(cell.key, cell);
        attempts.push({ task_id: batch.task_id, side: "analysis_b", status: "completed", cell_keys: batch.keys });
      } catch (error) {
        attempts.push({ task_id: batch.task_id, side: "analysis_b", status: "failed", cell_keys: batch.keys, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  let cells = applyAnalyses(inventory.cells, analysisA, analysisB);
  const open = disagreements(cells);
  if (open.length > 0) {
    const grouped = new Map<string, RoutedCell[]>();
    for (const cell of open) {
      const taskId = (inventory.pending_batches ?? []).find((batch: { keys: string[] }) => batch.keys.includes(cell.key))?.task_id ?? "arbitration";
      grouped.set(taskId, [...(grouped.get(taskId) ?? []), cell]);
    }
    for (const [taskId, group] of grouped) {
      const keys = group.map((cell) => cell.key);
      const verdict = analyses?.arbitration?.[taskId];
      if (verdict == null) {
        attempts.push({ task_id: `${taskId}-arbitration`, side: "arbitration", status: "failed", cell_keys: keys, error: "missing arbitration" });
        continue;
      }
      try {
        for (const cell of validateArbitrationResponse(keys, verdict)) arbitration.set(cell.key, cell);
        attempts.push({ task_id: `${taskId}-arbitration`, side: "arbitration", status: "completed", cell_keys: keys });
      } catch (error) {
        attempts.push({
          task_id: `${taskId}-arbitration`,
          side: "arbitration",
          status: "failed",
          cell_keys: keys,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    cells = applyArbitration(cells, arbitration);
  }

  const compiled = compileReviewPackage(inventory, cells);
  await writeReviewJson(join(outDir, "matrix.json"), { contract_version: compiled.contract_version, input_sha256: compiled.input_sha256, cells });
  await writeReviewJson(join(outDir, "attempts.json"), attempts);
  await writeReviewJson(join(outDir, "status.json"), {
    status: compiled.status,
    planned_cells: compiled.planned_cells,
    routed_cells: compiled.routed_cells,
    unresolved_cells: compiled.unresolved_cells,
    approved_cells: 0,
  });
  await writeReviewJson(join(outDir, "package.json"), compiled);
  console.log(JSON.stringify({
    status: compiled.status,
    package_path: join(outDir, "package.json"),
    planned_cells: compiled.planned_cells,
    routed_cells: compiled.routed_cells,
    unresolved_cells: compiled.unresolved_cells,
    approved_cells: 0,
  }));
}

const command = process.argv[2];
try {
  if (command === "inventory") await inventoryCommand();
  else if (command === "compile") await compileCommand();
  else {
    console.error(usage());
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
