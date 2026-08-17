import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateFormulaBarEvidence, type FormulaBarEvidence } from "./formula_bar";
import { writeJsonAtomic } from "./formula_bar_smoke";
import {
  buildSmokeCaptureQa,
  buildSmokeContextIndex,
  buildSmokeReuseRecaptureInventory,
  buildSmokeReviewMatrixPlan,
  evidenceToSmokeSource,
  freezeSmokeManifest,
  planSmokeRowCapture,
  renderSmokeInventoryMarkdown,
  smokeReviewKeys,
  validateSmokeCaptureQa,
  validateSmokeContextIndex,
  validateSmokeReuseRecaptureInventory,
  type SmokeCellCapture,
  type SmokeCourseRead,
  type SmokeProbeNote,
  type SmokeReuseRecaptureInventory,
  type SmokeRowCaptureResult,
  type SmokeTeacherRead,
} from "./smoke_recapture";

const [command, ...args] = process.argv.slice(2);

if (command === "inventory") {
  const [evidenceRootArgument, outputArgument, generatedAt] = args;
  if (!evidenceRootArgument || !outputArgument) usage();
  const evidenceRoot = resolve(evidenceRootArgument);
  const evidenceByKey = new Map();
  for (const key of smokeReviewKeys()) {
    const [, rowText, column] = key.split("|");
    const path = join(evidenceRoot, key.split("|")[0], `${column}${rowText}.json`);
    try {
      const evidence: unknown = JSON.parse(await readFile(path, "utf8"));
      validateFormulaBarEvidence(evidence);
      evidenceByKey.set(key, evidenceToSmokeSource(evidence as FormulaBarEvidence));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
  const inventory = buildSmokeReuseRecaptureInventory({
    evidenceByKey,
    sourceEvidenceRoot: evidenceRootArgument.replaceAll("\\", "/"),
    generatedAt: generatedAt ?? new Date().toISOString(),
  });
  const outputPath = resolve(outputArgument);
  const markdownPath = outputPath.replace(/\.json$/i, ".md");
  assertSmokeOutputPath(outputPath);
  assertSmokeOutputPath(markdownPath);
  await writeJsonAtomic(outputPath, inventory);
  await writeFile(markdownPath, `${renderSmokeInventoryMarkdown(inventory)}\n`, "utf8");
  console.log(JSON.stringify({
    output: outputPath,
    markdown: markdownPath,
    totals: inventory.totals,
  }));
} else if (command === "freeze-matrix") {
  const [outputArgument] = args;
  if (!outputArgument) usage();
  const plan = buildSmokeReviewMatrixPlan();
  assertSmokeOutputPath(resolve(outputArgument));
  await writeJsonAtomic(resolve(outputArgument), plan);
  console.log(JSON.stringify({ output: resolve(outputArgument), planned_cells: plan.planned_cells, sha256: plan.plan_sha256 }));
} else if (command === "context-index") {
  const [inventoryPath, outputArgument, courseReadsPath, teacherReadsPath] = args;
  if (!inventoryPath || !outputArgument) usage();
  const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
  const courseReads = courseReadsPath
    ? JSON.parse(await readFile(resolve(courseReadsPath), "utf8")) as SmokeCourseRead[]
    : [];
  const teacherReads = teacherReadsPath
    ? JSON.parse(await readFile(resolve(teacherReadsPath), "utf8")) as SmokeTeacherRead[]
    : [];
  const index = buildSmokeContextIndex(inventory, courseReads, teacherReads);
  assertSmokeOutputPath(resolve(outputArgument));
  await writeJsonAtomic(resolve(outputArgument), index);
  console.log(JSON.stringify({
    output: resolve(outputArgument),
    pending_walk_up_rows: index.pending_walk_up_rows,
  }));
} else if (command === "plan-row") {
  const [inventoryPath, worksheet, rowText] = args;
  if (!inventoryPath || !worksheet || !rowText) usage();
  const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
  const plan = planSmokeRowCapture(inventory, worksheet, Number(rowText));
  console.log(JSON.stringify(plan, null, 2));
} else if (command === "qa") {
  const [inventoryPath, contextIndexPath, capturesPath, outputArgument, sportsRow6Path, probeNotesPath] = args;
  if (!inventoryPath || !contextIndexPath || !capturesPath || !outputArgument) usage();
  const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
  const contextIndex = JSON.parse(await readFile(resolve(contextIndexPath), "utf8"));
  validateSmokeContextIndex(contextIndex);
  const captures = JSON.parse(await readFile(resolve(capturesPath), "utf8")) as SmokeCellCapture[];
  const sportsRow6 = sportsRow6Path
    ? JSON.parse(await readFile(resolve(sportsRow6Path), "utf8")) as SmokeRowCaptureResult
    : null;
  const probeNotes = probeNotesPath
    ? JSON.parse(await readFile(resolve(probeNotesPath), "utf8")) as SmokeProbeNote[]
    : [];
  const reusedRecordSha256s = new Map(
    inventory.sheets.flatMap((sheet) => sheet.rows.flatMap((row) => row.reviews
      .filter((review) => review.record_sha256)
      .map((review) => [review.key, review.record_sha256!]))),
  );
  const qa = buildSmokeCaptureQa({
    inventory,
    contextIndex,
    captures,
    sportsRow6,
    probeNotes,
    reusedRecordSha256s,
  });
  assertSmokeOutputPath(resolve(outputArgument));
  await writeJsonAtomic(resolve(outputArgument), qa);
  console.log(JSON.stringify({ output: resolve(outputArgument), status: qa.status, issues: qa.issues.length }));
  if (qa.status !== "accepted") process.exitCode = 1;
} else if (command === "freeze-manifest") {
  const [inventoryPath, contextIndexPath, qaPath, outputArgument] = args;
  if (!inventoryPath || !contextIndexPath || !qaPath || !outputArgument) usage();
  const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
  const contextIndex = JSON.parse(await readFile(resolve(contextIndexPath), "utf8"));
  validateSmokeContextIndex(contextIndex);
  const qa = JSON.parse(await readFile(resolve(qaPath), "utf8"));
  validateSmokeCaptureQa(qa);
  const manifest = freezeSmokeManifest({
    matrix: buildSmokeReviewMatrixPlan(),
    inventory,
    contextIndex,
    qa,
  });
  assertSmokeOutputPath(resolve(outputArgument));
  await writeJsonAtomic(resolve(outputArgument), manifest);
  console.log(JSON.stringify({ output: resolve(outputArgument), sha256: manifest.manifest_sha256 }));
} else {
  usage();
}

function readInventory(text: string): SmokeReuseRecaptureInventory {
  const inventory = JSON.parse(text);
  validateSmokeReuseRecaptureInventory(inventory);
  return inventory;
}

function assertSmokeOutputPath(path: string) {
  const resolved = resolve(path).replaceAll("\\", "/");
  if (!resolved.includes("/scripts/legacy_evidence/output/")) {
    throw new Error("smoke output must stay inside scripts/legacy_evidence/output");
  }
  if (resolved.includes("/formula-bar-full-") || resolved.includes("/formula-bar-rebuild-")) {
    throw new Error("smoke output must not overwrite an existing formula-bar pack");
  }
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function usage(): never {
  throw new Error([
    "Usage:",
    "  pnpm run smoke-recapture inventory <formula-bar-evidence-root> <inventory.json> [generated-at]",
    "  pnpm run smoke-recapture freeze-matrix <matrix.json>",
    "  pnpm run smoke-recapture context-index <inventory.json> <context-index.json> [course-reads.json] [teacher-reads.json]",
    "  pnpm run smoke-recapture plan-row <inventory.json> <worksheet> <row>",
    "  pnpm run smoke-recapture qa <inventory.json> <context-index.json> <captures.json> <qa.json> [sports-row6.json] [probe-notes.json]",
    "  pnpm run smoke-recapture freeze-manifest <inventory.json> <context-index.json> <qa.json> <manifest.json>",
  ].join("\n"));
}
