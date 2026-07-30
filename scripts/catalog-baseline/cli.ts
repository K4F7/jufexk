import { resolve } from "node:path";
import { compileApprovedCatalogBaseline } from "./approve";
import { buildArchiveManifest, type ArchiveManifest } from "./archive";
import { deriveCatalogBaseline } from "./derive";
import { runCatalogQuality } from "./quality";
import { exportCatalogReview } from "./review";

const usage = "usage: bun run catalog-baseline derive <capture-directory> [--output <derivation-directory>] | bun run catalog-baseline quality <derivation-directory> [--decisions <decisions.jsonl>] [--output <quality-directory>] | bun run catalog-baseline review <quality-directory> [--output <review-directory>] | bun run catalog-baseline approve <quality-directory> [--output <approved-directory>] | bun run catalog-baseline archive <capture-directory> --derived <derivation-directory> --approved <approved-directory> [--output <archive-manifest.json>]";
const [command, inputArgument, ...rest] = process.argv.slice(2);
if (!inputArgument || !["derive", "quality", "review", "approve", "archive"].includes(command ?? "")) {
  throw new Error(usage);
}
const outputFlag = rest.indexOf("--output");
const decisionsFlag = rest.indexOf("--decisions");
const derivedFlag = rest.indexOf("--derived");
const approvedFlag = rest.indexOf("--approved");
const claimed = new Set<number>();
for (const index of [outputFlag, decisionsFlag, derivedFlag, approvedFlag]) {
  if (index < 0) continue;
  if (!rest[index + 1]) throw new Error(usage);
  claimed.add(index);
  claimed.add(index + 1);
}
if (rest.some((_value, index) => !claimed.has(index)) || (command !== "quality" && decisionsFlag >= 0)
  || (command === "archive" ? derivedFlag < 0 || approvedFlag < 0 : derivedFlag >= 0 || approvedFlag >= 0)) throw new Error(usage);
const inputRoot = resolve(inputArgument);
const outputRoot = resolve(outputFlag >= 0 ? rest[outputFlag + 1] : command === "archive" ? `${inputRoot}-archive-manifest.json` : `${inputRoot}-${command === "derive" ? "derived" : command === "quality" ? "quality" : command === "review" ? "review" : "approved"}`);
const manifest = command === "derive"
  ? await deriveCatalogBaseline(inputRoot, outputRoot)
  : command === "quality"
    ? await runCatalogQuality(inputRoot, outputRoot, decisionsFlag >= 0 ? rest[decisionsFlag + 1] : undefined)
    : command === "review"
      ? await exportCatalogReview(inputRoot, outputRoot)
      : command === "approve"
        ? await compileApprovedCatalogBaseline(inputRoot, outputRoot)
        : await buildArchiveManifest(inputRoot, resolve(rest[derivedFlag + 1]), resolve(rest[approvedFlag + 1]), outputRoot);
const archiveManifest = command === "archive" ? manifest as ArchiveManifest : undefined;
console.log(JSON.stringify(archiveManifest ? {
  schemaVersion: archiveManifest.schemaVersion,
  status: archiveManifest.status,
  contentSha256: archiveManifest.contentSha256,
  packages: Object.fromEntries(Object.entries(archiveManifest.packages).map(([name, value]) => [name, {
    schemaVersion: value.schemaVersion,
    status: value.status,
    manifestContentSha256: value.manifestContentSha256,
    records: value.records,
    bytes: value.bytes,
    files: value.files.length,
  }])),
  outputRoot,
} : { ...manifest, outputRoot }, null, 2));
