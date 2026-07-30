import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { readFormulaBarEvidence } from "./formula_bar";
import { auditFormulaBarFullScan } from "./formula_bar_full_scan";
import {
  buildFrozenFormulaBarMatrixPlan,
  validateFormulaBarLocatorCheckpoint,
  type FormulaBarLocatorCheckpoint,
} from "./formula_bar_locator";
import { validateSmokeTargetSet, writeJsonAtomic, type FormulaBarSmokeTargetSet } from "./formula_bar_smoke";

const [rootArgument, targetsArgument, outputArgument] = process.argv.slice(2);
if (!rootArgument || !targetsArgument) usage();

const root = resolve(rootArgument);
const targetsPath = resolve(targetsArgument);
const outputPath = resolve(outputArgument ?? join(root, "full-scan-audit.json"));
const auditName = relative(root, outputPath).replaceAll("\\", "/");
if (!auditName || auditName.startsWith("../") || resolve(root, auditName) !== outputPath) {
  throw new Error("full-scan audit output must stay inside scan root");
}
const targetSet: unknown = JSON.parse(await readFile(targetsPath, "utf8"));
validateSmokeTargetSet(targetSet);
const targets = targetSet as FormulaBarSmokeTargetSet;
const plan = buildFrozenFormulaBarMatrixPlan();
const evidencePaths = await jsonFiles(join(root, "evidence"));
const checkpointPaths = await jsonFiles(join(root, "checkpoints"));
const evidence = await Promise.all(evidencePaths.map(readFormulaBarEvidence));
const images: Record<string, { key: string; kind: "cell" | "conflict"; sha256: string }> = {};
for (let index = 0; index < evidence.length; index += 1) {
  const item = evidence[index];
  for (const reference of [item.evidence.cell_image, item.evidence.conflict_image]) {
    if (!reference) continue;
    const imagePath = resolve(dirname(evidencePaths[index]), reference.path);
    const imageName = relative(root, imagePath).replaceAll("\\", "/");
    if (!imageName || imageName.startsWith("../") || resolve(root, imageName) !== imagePath) {
      throw new Error(`formula-bar screenshot must stay inside scan root: ${item.key}`);
    }
    if (images[imageName]) throw new Error(`duplicate formula-bar screenshot path: ${imageName}`);
    const actualSha256 = await fileSha256(imagePath);
    if (actualSha256 !== reference.sha256) {
      throw new Error(`formula-bar screenshot hash mismatch: ${item.key}`);
    }
    images[imageName] = { key: item.key, kind: reference.kind, sha256: actualSha256 };
  }
}
const checkpoints = await Promise.all(checkpointPaths.map(async (path) => {
  const checkpoint: unknown = JSON.parse(await readFile(path, "utf8"));
  validateFormulaBarLocatorCheckpoint(checkpoint);
  return checkpoint as FormulaBarLocatorCheckpoint;
}));
checkpoints.sort((left, right) => left.sequence - right.sequence);

const audit = auditFormulaBarFullScan({
  plan,
  evidence,
  checkpoints,
  strong_keys: new Set(targets.targets.map((target) => target.key)),
  expected_strong_key_count: 110,
  checkpoint_rows: 25,
});
await writeJsonAtomic(outputPath, audit);
const files = Object.fromEntries(await Promise.all(evidencePaths.map(async (path, index) => [
  relative(root, path).replaceAll("\\", "/"),
  { key: evidence[index].key, sha256: await fileSha256(path) },
])));
const evidenceManifest = {
  contract_version: "formula-bar-evidence-set-v1",
  source_locator_plan_sha256: plan.plan_sha256,
  evidence_count: evidence.length,
  strong_suspect_count: targets.target_count,
  strong_suspect_target_set_sha256: targets.target_set_sha256,
  strong_suspect_keys: targets.targets.map((target) => target.key).sort(),
  strong_suspect_keys_sha256: audit.strong_suspect_keys_sha256,
  full_scan_audit: { path: auditName, sha256: await fileSha256(outputPath) },
  files,
  image_count: Object.keys(images).length,
  images,
};
await writeJsonAtomic(join(root, "evidence-manifest.json"), evidenceManifest);
console.log(JSON.stringify({
  output: outputPath,
  evidence_manifest: join(root, "evidence-manifest.json"),
  status: audit.status,
  completed_cells: audit.completed_cells,
  strong_suspect_cells: audit.strong_suspect_cells,
  checkpoint_count: audit.checkpoint_count,
  audit_sha256: audit.audit_sha256,
}));

async function fileSha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function jsonFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
  }
  return files.sort();
}

function usage(): never {
  throw new Error(
    "Usage: bun scripts/legacy_evidence/formula_bar_full_scan_cli.ts <scan-root> <targets.json> [audit.json]",
  );
}
