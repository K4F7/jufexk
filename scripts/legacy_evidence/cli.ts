import { runBatchCommand } from "./index";
import { runRecognitionTrial } from "./recognition";

const args = process.argv.slice(2);
const command = args.shift();

function option(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(name: string) {
  const raw = option(name);
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function usage() {
  return [
    "Usage:",
    "  bun scripts/legacy_evidence/cli.ts pilot --source <dir> --batch <dir> --out <dir> [--pilot-job <id> x3] [--max-concurrent-jobs 4]",
    "  bun scripts/legacy_evidence/cli.ts full --manifest <manifest.json> --approval <approval.json> --out <dir> [--max-concurrent-jobs 4]",
    "  bun scripts/legacy_evidence/cli.ts recognize --manifest <recapture-manifest.json> --out <dir> [--max-concurrent-groups 2]",
  ].join("\n");
}

if (command !== "pilot" && command !== "full" && command !== "recognize") {
  console.error(usage());
  process.exit(2);
}

let result;
try {
  if (command === "recognize") {
    const recognition = await runRecognitionTrial({
      manifestPath: option("--manifest") ?? "scripts/legacy_evidence/input/recapture-20260727/manifest.json",
      outDir: option("--out") ?? `scripts/legacy_evidence/runs/recapture-${Date.now()}`,
      maxConcurrentGroups: numberOption("--max-concurrent-groups"),
      sheets: args.flatMap((value, index) => value === "--sheet" && args[index + 1] ? [args[index + 1]] : []),
    });
    console.log(recognition.status === 0 ? "recognition trial completed" : "recognition trial completed with blockers");
    process.exit(recognition.status);
  }
  result = await runBatchCommand({
    mode: command as "pilot" | "full",
    sourceDir: option("--source"),
    batchDir: option("--batch"),
    manifestPath: option("--manifest"),
    approvalPath: option("--approval"),
    outDir: option("--out") ?? "scripts/legacy_evidence/output/latest",
    maxConcurrentJobs: numberOption("--max-concurrent-jobs"),
    maxJobs: numberOption("--max-jobs"),
    pilotJobIds: args.flatMap((value, index) => value === "--pilot-job" && args[index + 1] ? [args[index + 1]] : []),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

if (result.message) console.log(result.message);
process.exit(result.status);
