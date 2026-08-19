import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { LiveLayout } from "./live_layout";
import type { ProductionGapPartition } from "./production_gap";
import {
  analysisPayload,
  applyAnalyses,
  applyApprovals,
  applyArbitration,
  approvalPayload,
  assertReviewPackageOutputPath,
  buildReviewInventory,
  compileReviewPackage,
  detectSmokeCaptureRoot,
  disagreements,
  eligibleForApproval,
  loadScopedEvidence,
  loadSmokeImageOverrides,
  loadSmokeInventoryScopes,
  resolveReviewEvidenceScopes,
  parseContextDocument,
  readJsonIfExists,
  requireReviewPackageLiveLayout,
  resolveSmokeEvidenceDir,
  validateAnalysisResponse,
  validateApprovalResponse,
  validateArbitrationResponse,
  writeReviewJson,
  type CellAnalysis,
  type CellApproval,
  type CellArbitration,
  type OcrEvidence,
  type ReviewAttempt,
  type RoutedCell,
} from "./review_package";
import {
  buildHumanQueue,
  compileApprovedFromDecisions,
  csvToDecisionItems,
  discoverLaneSources,
  parseDecisionRecords,
  writeApprovedPackageArtifacts,
  writeHumanQueueArtifacts,
} from "./human_queue";

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
    "  pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts inventory --evidence-dir <dir> --context <json> --layout <live-layout.json> --gap <json> --out <dir> [--worksheet <name>] [--first-row N] [--last-row N] [--ocr-dir <dir>] [--max-batches N] [--smoke-root <dir>]",
    "  pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts compile --inventory <json> --analyses <json> --out <dir>",
    "  pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts approve --package <json> --verdicts <json> --out <dir>",
    "  pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts human-queue --packages-root <dir> --out <dir>",
    "  pnpm exec tsx scripts/legacy_evidence/review_package_cli.ts compile-approved --packages-root <dir> --out <dir> [--decisions <json|csv>]",
  ].join("\n");
}

async function loadContext(path: string) {
  return parseContextDocument(JSON.parse(await readFile(resolve(path), "utf8")));
}

async function detectSmokeRoot(contextPath: string, evidenceDir: string) {
  const explicit = optionalOption("--smoke-root");
  if (explicit) return resolve(explicit);
  return detectSmokeCaptureRoot([dirname(resolve(contextPath)), resolve(evidenceDir)]);
}

async function loadEvidence(evidenceDir: string, smokeRoot: string | undefined) {
  const worksheet = optionalOption("--worksheet");
  const firstRow = optionalInteger("--first-row");
  const lastRow = optionalInteger("--last-row");
  const scopes = resolveReviewEvidenceScopes({
    worksheet,
    first_row: firstRow,
    last_row: lastRow,
    pack_scopes: smokeRoot ? await loadSmokeInventoryScopes(smokeRoot) : null,
  });
  if (!scopes) {
    return loadScopedEvidence({
      evidence_dir: evidenceDir,
      worksheet,
      first_row: firstRow,
      last_row: lastRow,
    });
  }
  const evidence: Awaited<ReturnType<typeof loadScopedEvidence>>["evidence"] = [];
  const image_base_by_key: Record<string, string> = {};
  for (const scope of scopes) {
    const loaded = await loadScopedEvidence({
      evidence_dir: evidenceDir,
      worksheet: scope.worksheet,
      first_row: scope.first_row,
      last_row: scope.last_row,
    });
    evidence.push(...loaded.evidence);
    Object.assign(image_base_by_key, loaded.image_base_by_key);
  }
  return { evidence, image_base_by_key };
}

async function loadOcr(ocrDir?: string): Promise<Record<string, OcrEvidence>> {
  if (!ocrDir) return {};
  const summary = await readJsonIfExists(join(resolve(ocrDir), "cells.json"));
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
  const record = summary as Record<string, OcrEvidence>;
  return record;
}

async function loadLayout(): Promise<LiveLayout> {
  return requireReviewPackageLiveLayout(JSON.parse(await readFile(resolve(option("--layout")), "utf8")));
}

async function loadGap(): Promise<Record<string, ProductionGapPartition>> {
  const raw = JSON.parse(await readFile(resolve(option("--gap")), "utf8"));
  if (isRecord(raw) && Array.isArray(raw.cells)) {
    const gap: Record<string, ProductionGapPartition> = {};
    for (const cell of raw.cells) {
      if (!isRecord(cell) || typeof cell.key !== "string" || typeof cell.partition !== "string") continue;
      gap[cell.key] = cell.partition as ProductionGapPartition;
    }
    return gap;
  }
  if (isRecord(raw)) {
    const gap: Record<string, ProductionGapPartition> = {};
    for (const [key, partition] of Object.entries(raw)) {
      if (typeof partition === "string") gap[key] = partition as ProductionGapPartition;
    }
    return gap;
  }
  throw new Error("gap file must be a production-gap inventory or {key: partition}");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function inventoryCommand() {
  const outDir = resolve(option("--out"));
  assertReviewPackageOutputPath(outDir);
  const contextPath = option("--context");
  const requestedEvidence = option("--evidence-dir");
  const layout = await loadLayout();
  const gap_by_key = await loadGap();
  const smokeRoot = await detectSmokeRoot(contextPath, requestedEvidence);
  const evidenceDir = smokeRoot ? await resolveSmokeEvidenceDir(smokeRoot) : requestedEvidence;
  const loaded = await loadEvidence(evidenceDir, smokeRoot);
  const prior = await readJsonIfExists(join(outDir, "matrix.json"));
  const attempts = await readJsonIfExists(join(outDir, "attempts.json"));
  const inventoryPath = join(outDir, "inventory.json");
  const ocrDir = optionalOption("--ocr-dir") ?? join(outDir, "ocr");
  const inventory = buildReviewInventory({
    evidence: loaded.evidence,
    context_index: await loadContext(contextPath),
    layout,
    gap_by_key,
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
  for (const batch of inventory.pending_verify) {
    await writeReviewJson(join(outDir, "batches", `${batch.task_id}-approval.json`), approvalPayload(batch));
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
    pending_verify_cells: inventory.pending_verify_cells,
    pending_batches: inventory.pending_batches.map((batch) => ({
      task_id: batch.task_id,
      worksheet: batch.worksheet,
      keys: batch.keys,
      payload_a: join(outDir, "batches", `${batch.task_id}-a.json`),
      payload_b: join(outDir, "batches", `${batch.task_id}-b.json`),
    })),
    pending_verify: inventory.pending_verify.map((batch) => ({
      task_id: batch.task_id,
      worksheet: batch.worksheet,
      keys: batch.keys,
      payload: join(outDir, "batches", `${batch.task_id}-approval.json`),
    })),
  };
  await writeFile(join(outDir, "inventory-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}

async function compileCommand() {
  const outDir = resolve(option("--out"));
  assertReviewPackageOutputPath(outDir);
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
    approved_cells: compiled.approved_cells,
  });
  await writeReviewJson(join(outDir, "package.json"), compiled);
  console.log(JSON.stringify({
    status: compiled.status,
    package_path: join(outDir, "package.json"),
    planned_cells: compiled.planned_cells,
    routed_cells: compiled.routed_cells,
    unresolved_cells: compiled.unresolved_cells,
    approved_cells: compiled.approved_cells,
  }));
}

async function approveCommand() {
  const outDir = resolve(option("--out"));
  assertReviewPackageOutputPath(outDir);
  const compiled = await readJsonIfExists(resolve(option("--package")));
  const verdictsFile = await readJsonIfExists(resolve(option("--verdicts")));
  if (!compiled || !Array.isArray(compiled.cells)) throw new Error("package is missing cells");
  const verdicts = new Map<string, CellApproval | { unresolved: "agent_exhausted" }>();
  const priorAttempts = await readJsonIfExists(join(outDir, "attempts.json"));
  const attempts: ReviewAttempt[] = Array.isArray(priorAttempts) ? priorAttempts : [];
  const groups = Array.isArray(verdictsFile?.batches) ? verdictsFile.batches : [{ task_id: "approval", keys: (compiled.cells as RoutedCell[]).filter(eligibleForApproval).map((cell) => cell.key), cells: verdictsFile?.cells }];
  for (const group of groups) {
    const keys = Array.isArray(group.keys) ? group.keys : [];
    if (group == null || group.cells == null) {
      attempts.push({ task_id: group.task_id ?? "approval", side: "approval", status: "failed", cell_keys: keys, error: "missing approval verdict" });
      continue;
    }
    try {
      for (const cell of validateApprovalResponse(keys.length ? keys : (group.cells as { key: string }[]).map((item) => item.key), group)) {
        verdicts.set(cell.key, cell);
      }
      attempts.push({ task_id: group.task_id ?? "approval", side: "approval", status: "completed", cell_keys: keys });
    } catch (error) {
      attempts.push({
        task_id: group.task_id ?? "approval",
        side: "approval",
        status: "failed",
        cell_keys: keys,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const cells = applyApprovals(compiled.cells, verdicts);
  const next = compileReviewPackage({ ...compiled, cells, pending_batches: [], pending_verify: [] }, cells);
  await writeReviewJson(join(outDir, "matrix.json"), { contract_version: next.contract_version, input_sha256: next.input_sha256, cells });
  await writeReviewJson(join(outDir, "attempts.json"), attempts);
  await writeReviewJson(join(outDir, "status.json"), {
    status: next.status,
    planned_cells: next.planned_cells,
    routed_cells: next.routed_cells,
    unresolved_cells: next.unresolved_cells,
    approved_cells: next.approved_cells,
  });
  await writeReviewJson(join(outDir, "package.json"), next);
  console.log(JSON.stringify({
    status: next.status,
    package_path: join(outDir, "package.json"),
    planned_cells: next.planned_cells,
    routed_cells: next.routed_cells,
    unresolved_cells: next.unresolved_cells,
    approved_cells: next.approved_cells,
  }));
}

async function humanQueueCommand() {
  const outDir = resolve(option("--out"));
  const lanes = await discoverLaneSources(option("--packages-root"));
  const queue = buildHumanQueue(lanes);
  await writeHumanQueueArtifacts(outDir, queue);
  console.log(JSON.stringify({
    status: queue.status,
    queue_path: join(outDir, "human-queue.json"),
    table_path: join(outDir, "human-queue.csv"),
    html_path: join(outDir, "human-queue.html"),
    queue_cells: queue.queue_cells,
    auto_approved_cells: queue.auto_approved_cells,
    incomplete_cells: queue.incomplete_cells,
    included_worksheets: queue.included_worksheets,
    excluded_open_worksheets: queue.excluded_open_worksheets,
    empty_worksheets: queue.empty_worksheets,
  }));
}

async function compileApprovedCommand() {
  const outDir = resolve(option("--out"));
  const lanes = await discoverLaneSources(option("--packages-root"));
  const decisionsPath = optionalOption("--decisions");
  let decisions: ReturnType<typeof parseDecisionRecords> = [];
  if (decisionsPath) {
    const raw = await readFile(resolve(decisionsPath), "utf8");
    const parsed = decisionsPath.endsWith(".csv") ? csvToDecisionItems(raw) : JSON.parse(raw);
    decisions = parseDecisionRecords(parsed);
  }
  const compiled = compileApprovedFromDecisions(lanes, decisions);
  const manifest = await writeApprovedPackageArtifacts(outDir, compiled);
  console.log(JSON.stringify({
    status: compiled.status,
    manifest_path: join(outDir, "manifest.json"),
    auto_approved_cells: compiled.auto_approved_cells,
    human_passed_cells: compiled.human_passed_cells,
    excluded_cells: compiled.excluded_cells,
    undecided_cells: compiled.undecided_cells,
    files: manifest.files,
  }));
}

const command = process.argv[2];
try {
  if (command === "inventory") await inventoryCommand();
  else if (command === "compile") await compileCommand();
  else if (command === "approve") await approveCommand();
  else if (command === "human-queue") await humanQueueCommand();
  else if (command === "compile-approved") await compileApprovedCommand();
  else {
    console.error(usage());
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
