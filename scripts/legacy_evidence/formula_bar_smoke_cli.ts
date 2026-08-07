import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildFormulaBarSmokeGate,
  buildStrongSuspectTargetSet,
  validateSmokeTargetSet,
  writeJsonAtomic,
  type FormulaBarManualExpectation,
  type FormulaBarManualResolution,
  type FormulaBarSmokeTargetSet,
  type HistoricalEvaluationForSmoke,
} from "./formula_bar_smoke";
import { readFormulaBarEvidence } from "./formula_bar";

const [command, ...args] = process.argv.slice(2);

if (command === "build-targets") {
  const [evaluationsPath, outputPath] = args;
  if (!evaluationsPath || !outputPath) usage();
  const rows = (await readFile(resolve(evaluationsPath), "utf8"))
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) as HistoricalEvaluationForSmoke[];
  const targetSet = buildStrongSuspectTargetSet(rows);
  await writeJsonAtomic(resolve(outputPath), targetSet);
  console.log(JSON.stringify({
    output: resolve(outputPath),
    groups: targetSet.group_count,
    targets: targetSet.target_count,
    sha256: targetSet.target_set_sha256,
  }));
} else if (command === "verify") {
  const [targetsPath, evidenceDirectory, outputPath, manualExpectationsPath, manualResolutionsPath] = args;
  if (!targetsPath || !evidenceDirectory || !outputPath) usage();
  const targetSet: unknown = JSON.parse(await readFile(resolve(targetsPath), "utf8"));
  validateSmokeTargetSet(targetSet);
  const evidence = await Promise.all((targetSet as FormulaBarSmokeTargetSet).targets.map((target) => (
    readFormulaBarEvidence(resolve(evidenceDirectory, `${target.worksheet}/${target.address}.json`))
  )));
  const manualExpectations = manualExpectationsPath
    ? JSON.parse(await readFile(resolve(manualExpectationsPath), "utf8")) as FormulaBarManualExpectation[]
    : [];
  const manualResolutions = manualResolutionsPath
    ? JSON.parse(await readFile(resolve(manualResolutionsPath), "utf8")) as FormulaBarManualResolution[]
    : [];
  const gate = buildFormulaBarSmokeGate(
    targetSet as FormulaBarSmokeTargetSet,
    evidence,
    manualExpectations,
    manualResolutions,
  );
  await writeJsonAtomic(resolve(outputPath), gate);
  console.log(JSON.stringify({
    output: resolve(outputPath),
    conclusion: gate.conclusion,
    counts: gate.counts,
    sha256: gate.gate_sha256,
  }));
  if (gate.conclusion !== "pass") process.exitCode = 1;
} else {
  usage();
}

function usage(): never {
  throw new Error([
    "Usage:",
    "  pnpm run formula-bar-smoke build-targets <historical-evaluations.jsonl> <targets.json>",
    "  pnpm run formula-bar-smoke verify <targets.json> <evidence-dir> <gate.json> [manual-expectations.json] [manual-resolutions.json]",
  ].join("\n"));
}
