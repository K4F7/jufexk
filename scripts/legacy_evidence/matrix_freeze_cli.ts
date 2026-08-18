import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeJsonAtomic } from "./formula_bar_smoke";
import type { LiveLayout } from "./live_layout";
import {
  assertMatrixFreezeOutputPath,
  buildMatrixFreezePlan,
  createMatrixFreezeLocatorStore,
  evaluateMatrixFreezeQa,
  freezeMatrixManifest,
  loadPlanEvidence,
  locateMatrixFreezeRange,
  requireMatrixFreezeLiveLayout,
  scanMatrixFreezeExtents,
  validateMatrixFreezeExtent,
  validateMatrixFreezeQa,
  type MatrixFreezeCompositionPair,
  type MatrixFreezeExtent,
  type MatrixFreezeLocateResult,
  type MatrixFreezeWindowObservation,
} from "./matrix_freeze";

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "scan-extent") await scanExtentCommand();
  else if (command === "locate") await locateCommand();
  else if (command === "qa") await qaCommand();
  else if (command === "freeze-manifest") await freezeCommand();
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usageText());
  process.exit(2);
}

async function scanExtentCommand() {
  const outDir = resolve(option("--out"));
  assertMatrixFreezeOutputPath(outDir);
  const layout = await loadLayout();
  const extent = scanMatrixFreezeExtents({
    worksheets: repeatable("--worksheet"),
    first_row: optionalInteger("--first-row"),
    last_row: optionalInteger("--last-row"),
    layout,
  });
  await mkdir(outDir, { recursive: true });
  const outputPath = join(outDir, "extent.json");
  await writeJsonAtomic(outputPath, extent);
  await writeJsonAtomic(join(outDir, "plan.json"), buildMatrixFreezePlan(extent));
  console.log(JSON.stringify({
    status: "accepted",
    output: outputPath,
    worksheets: extent.worksheets,
    planned_rows: extent.planned_rows,
    planned_cells: extent.planned_cells,
    sheets: extent.sheets.map((sheet) => ({
      worksheet: sheet.worksheet,
      first_row: sheet.first_row,
      last_row: sheet.last_row,
    })),
    layout_sha256: extent.layout_sha256,
    extent_sha256: extent.extent_sha256,
  }));
}

async function locateCommand() {
  const outDir = resolve(option("--out"));
  assertMatrixFreezeOutputPath(outDir);
  const worksheet = option("--worksheet");
  const layout = await loadLayout();
  const extent = await loadOrScanExtent(outDir, layout);
  const store = createMatrixFreezeLocatorStore({
    writeRoot: outDir,
    reuseRoot: optionalOption("--evidence-dir"),
  });
  const locate = await locateMatrixFreezeRange({ extent, worksheet, store, layout });
  await mkdir(outDir, { recursive: true });
  const outputPath = join(outDir, locateFileName(worksheet));
  await writeJsonAtomic(outputPath, locate);
  if (locate.status === "recapture_required") {
    await writeJsonAtomic(join(outDir, "recapture-checkpoint.json"), {
      contract_version: "legacy-matrix-freeze-checkpoint-v1",
      status: locate.status,
      worksheet: locate.worksheet,
      first_row: locate.first_row,
      last_row: locate.last_row,
      stop_key: locate.stop_key,
      stop_reason: locate.stop_reason,
      missing_keys: locate.missing_keys,
      layout_sha256: locate.layout_sha256,
      locate_sha256: locate.locate_sha256,
    });
  }
  console.log(JSON.stringify({
    status: locate.status,
    output: outputPath,
    worksheet: locate.worksheet,
    first_row: locate.first_row,
    last_row: locate.last_row,
    planned_cells: locate.planned_cells,
    reused_cells: locate.reused_cells,
    missing_keys: locate.missing_keys,
    stop_key: locate.stop_key,
    stop_reason: locate.stop_reason,
    layout_sha256: locate.layout_sha256,
    locate_sha256: locate.locate_sha256,
  }));
  if (locate.status !== "accepted") process.exitCode = 1;
}

async function qaCommand() {
  const outDir = resolve(option("--out"));
  assertMatrixFreezeOutputPath(outDir);
  const layout = await loadLayout();
  const extent = await loadExtent(outDir);
  const locates = await loadLocates(outDir, extent);
  const store = createMatrixFreezeLocatorStore({
    writeRoot: outDir,
    reuseRoot: optionalOption("--evidence-dir"),
  });
  const evidence = await loadPlanEvidence(store, buildMatrixFreezePlan(extent));
  const pairsPath = optionalOption("--pairs");
  const pairs = pairsPath
    ? JSON.parse(await readFile(resolve(pairsPath), "utf8")) as MatrixFreezeCompositionPair[]
    : [];
  const windowsPath = optionalOption("--windows");
  const windows = windowsPath
    ? JSON.parse(await readFile(resolve(windowsPath), "utf8")) as MatrixFreezeWindowObservation[]
    : [];
  const qa = evaluateMatrixFreezeQa({ extent, locates, evidence, pairs, windows, layout });
  const outputPath = join(outDir, "qa.json");
  await writeJsonAtomic(outputPath, qa);
  if (qa.status === "recapture_required") {
    await writeJsonAtomic(join(outDir, "recapture-checkpoint.json"), {
      contract_version: "legacy-matrix-freeze-checkpoint-v1",
      status: qa.status,
      recapture_keys: qa.recapture_keys,
      formula_truncated_isolated: qa.formula_truncated_isolated,
      issues: qa.issues,
      layout_sha256: qa.layout_sha256,
      qa_sha256: qa.qa_sha256,
    });
  }
  console.log(JSON.stringify({
    status: qa.status,
    output: outputPath,
    issues: qa.issues,
    recapture_keys: qa.recapture_keys,
    formula_truncated_isolated: qa.formula_truncated_isolated,
    planned_cells: qa.planned_cells,
    reused_cells: qa.reused_cells,
    rewrite_source_json: qa.rewrite_source_json,
    layout_sha256: qa.layout_sha256,
    qa_sha256: qa.qa_sha256,
  }));
  if (qa.status !== "accepted") process.exitCode = 1;
}

async function freezeCommand() {
  const outDir = resolve(option("--out"));
  assertMatrixFreezeOutputPath(outDir);
  const layout = await loadLayout();
  const extent = await loadExtent(outDir);
  const qa = JSON.parse(await readFile(join(outDir, "qa.json"), "utf8"));
  validateMatrixFreezeQa(qa);
  const store = createMatrixFreezeLocatorStore({
    writeRoot: outDir,
    reuseRoot: optionalOption("--evidence-dir"),
  });
  const evidence = await loadPlanEvidence(store, buildMatrixFreezePlan(extent));
  const manifest = freezeMatrixManifest({ extent, qa, evidence, layout });
  const outputPath = join(outDir, "manifest.json");
  await writeJsonAtomic(outputPath, manifest);
  console.log(JSON.stringify({
    status: "accepted",
    output: outputPath,
    planned_cells: manifest.planned_cells,
    worksheets: manifest.worksheets,
    plan_sha256: manifest.plan_sha256,
    layout_sha256: manifest.layout_sha256,
    manifest_sha256: manifest.manifest_sha256,
  }));
}

async function loadLayout(): Promise<LiveLayout> {
  const layoutPath = option("--layout");
  const layout = JSON.parse(await readFile(resolve(layoutPath), "utf8"));
  return requireMatrixFreezeLiveLayout(layout);
}

async function loadOrScanExtent(outDir: string, layout: LiveLayout) {
  try {
    return await loadExtent(outDir);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return scanMatrixFreezeExtents({
      worksheets: repeatable("--worksheet"),
      first_row: optionalInteger("--first-row"),
      last_row: optionalInteger("--last-row"),
      layout,
    });
  }
}

async function loadExtent(outDir: string): Promise<MatrixFreezeExtent> {
  const extent = JSON.parse(await readFile(join(outDir, "extent.json"), "utf8"));
  validateMatrixFreezeExtent(extent);
  return extent;
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function loadLocates(outDir: string, extent: MatrixFreezeExtent): Promise<MatrixFreezeLocateResult[]> {
  const files = await readdir(outDir).catch(() => [] as string[]);
  const locates: MatrixFreezeLocateResult[] = [];
  for (const sheet of extent.sheets) {
    const name = locateFileName(sheet.worksheet);
    if (!files.includes(name)) continue;
    locates.push(JSON.parse(await readFile(join(outDir, name), "utf8")) as MatrixFreezeLocateResult);
  }
  return locates;
}

function locateFileName(worksheet: string) {
  return `locate-${worksheet}.json`;
}

function option(name: string) {
  const value = optionalOption(name);
  if (value == null) throw new Error(`missing ${name}`);
  return value;
}

function optionalOption(name: string) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
}

function optionalInteger(name: string) {
  const raw = optionalOption(name);
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function repeatable(name: string) {
  const values: string[] = [];
  args.forEach((value, index) => {
    if (value === name && args[index + 1]) values.push(args[index + 1]);
  });
  return values.length > 0 ? values : undefined;
}

function usage(): never {
  throw new Error(usageText());
}

function usageText() {
  return [
    "Usage:",
    "  pnpm exec tsx scripts/legacy_evidence/matrix_freeze_cli.ts scan-extent --out <dir> --layout <live-layout.json> [--worksheet name] [--first-row N] [--last-row N]",
    "  pnpm exec tsx scripts/legacy_evidence/matrix_freeze_cli.ts locate --out <dir> --layout <live-layout.json> --worksheet <name> [--evidence-dir <dir>] [--first-row N] [--last-row N]",
    "  pnpm exec tsx scripts/legacy_evidence/matrix_freeze_cli.ts qa --out <dir> --layout <live-layout.json> [--evidence-dir <dir>] [--pairs <json>] [--windows <json>]",
    "  pnpm exec tsx scripts/legacy_evidence/matrix_freeze_cli.ts freeze-manifest --out <dir> --layout <live-layout.json> [--evidence-dir <dir>]",
    "Do not click the grid. Do not treat screenshots as review body. Do not log in.",
  ].join("\n");
}
