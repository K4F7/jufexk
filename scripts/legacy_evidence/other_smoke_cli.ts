import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeJsonAtomic } from "./formula_bar_smoke";
import { validateFormulaBarEvidence, type FormulaBarEvidence } from "./formula_bar";
import {
  buildOtherSmokeCaptureQa,
  buildOtherSmokeInventory,
  buildOtherSmokeReviewMatrixPlan,
  evidenceToSmokeSource,
  freezeOtherSmokeManifest,
  otherSmokeReviewKeys,
  planOtherSmokeRowCapture,
  validateOtherSmokeCaptureQa,
  validateOtherSmokeInventory,
} from "./other_smoke";

const [command, ...args] = process.argv.slice(2);

if (command === "inventory") {
  const [evidenceRootArgument, outputArgument, generatedAt] = args;
  if (!evidenceRootArgument || !outputArgument) usage();
  const evidenceRoot = resolve(evidenceRootArgument);
  const evidenceByKey = new Map();
  for (const key of otherSmokeReviewKeys()) {
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
  const inventory = buildOtherSmokeInventory({
    evidenceByKey,
    sourceEvidenceRoot: evidenceRootArgument.replaceAll("\\", "/"),
    generatedAt: generatedAt ?? new Date().toISOString(),
  });
  assertOtherSmokeOutputPath(resolve(outputArgument));
  await writeJsonAtomic(resolve(outputArgument), inventory);
  console.log(JSON.stringify({
    output: resolve(outputArgument),
    totals: inventory.totals,
    inventory_sha256: inventory.inventory_sha256,
  }));
} else if (command === "freeze-matrix") {
  const [outputArgument] = args;
  if (!outputArgument) usage();
  const plan = buildOtherSmokeReviewMatrixPlan();
  assertOtherSmokeOutputPath(resolve(outputArgument));
  await writeJsonAtomic(resolve(outputArgument), plan);
  console.log(JSON.stringify({ output: resolve(outputArgument), planned_cells: plan.planned_cells, sha256: plan.plan_sha256 }));
} else if (command === "plan-row") {
  const [inventoryPath, worksheet, rowText] = args;
  if (!inventoryPath || !worksheet || !rowText) usage();
  const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
  console.log(JSON.stringify(planOtherSmokeRowCapture(inventory, worksheet, Number(rowText)), null, 2));
} else if (command === "qa") {
  const [inventoryPath, outputArgument, capturesPath, compositionFailuresPath] = args;
  if (!inventoryPath || !outputArgument) usage();
  const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
  const captures = capturesPath
    ? JSON.parse(await readFile(resolve(capturesPath), "utf8"))
    : [];
  const compositionFailures = compositionFailuresPath
    ? JSON.parse(await readFile(resolve(compositionFailuresPath), "utf8"))
    : [];
  const qa = buildOtherSmokeCaptureQa({ inventory, captures, compositionFailures });
  assertOtherSmokeOutputPath(resolve(outputArgument));
  await writeJsonAtomic(resolve(outputArgument), qa);
  console.log(JSON.stringify({ output: resolve(outputArgument), status: qa.status, issues: qa.issues.length }));
  if (qa.status !== "accepted") process.exitCode = 1;
} else if (command === "freeze-manifest") {
  const [inventoryPath, qaPath, outputArgument] = args;
  if (!inventoryPath || !qaPath || !outputArgument) usage();
  const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
  const qa = JSON.parse(await readFile(resolve(qaPath), "utf8"));
  validateOtherSmokeCaptureQa(qa);
  const manifest = freezeOtherSmokeManifest({
    matrix: buildOtherSmokeReviewMatrixPlan(),
    inventory,
    qa,
  });
  assertOtherSmokeOutputPath(resolve(outputArgument));
  await writeJsonAtomic(resolve(outputArgument), manifest);
  console.log(JSON.stringify({ output: resolve(outputArgument), sha256: manifest.manifest_sha256 }));
} else {
  usage();
}

function readInventory(text: string) {
  const inventory = JSON.parse(text);
  validateOtherSmokeInventory(inventory);
  return inventory;
}

function assertOtherSmokeOutputPath(path: string) {
  const resolved = resolve(path).replaceAll("\\", "/");
  if (!resolved.includes("/scripts/legacy_evidence/output/")) {
    throw new Error("other-smoke output must stay inside scripts/legacy_evidence/output");
  }
  if (!resolved.includes("/other-smoke")) {
    throw new Error("other-smoke output must stay under scripts/legacy_evidence/output/other-smoke*");
  }
  if (resolved.includes("/smoke-20260818-v1") || resolved.includes("/formula-bar-full-") || resolved.includes("/formula-bar-rebuild-")) {
    throw new Error("other-smoke output must not overwrite the #180 smoke pack or formula-bar packs");
  }
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function usage(): never {
  throw new Error([
    "Usage:",
    "  pnpm run other-smoke inventory <formula-bar-evidence-root> <inventory.json> [generated-at]",
    "  pnpm run other-smoke freeze-matrix <matrix.json>",
    "  pnpm run other-smoke plan-row <inventory.json> <worksheet> <row>",
    "  pnpm run other-smoke qa <inventory.json> <qa.json> [captures.json] [composition-failures.json]",
    "  pnpm run other-smoke freeze-manifest <inventory.json> <qa.json> <manifest.json>",
  ].join("\n"));
}
