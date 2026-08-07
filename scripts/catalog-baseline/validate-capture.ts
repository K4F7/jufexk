import { resolve } from "node:path";
import { validateCapturePackage } from "./capture-package";

function usage(): never {
  throw new Error("usage: pnpm run validate:catalog-capture <capture-directory> [--require-complete]");
}

const args = process.argv.slice(2);
const rootArgument = args.find((argument) => !argument.startsWith("--"));
if (!rootArgument) usage();

const unknownFlags = args.filter((argument) => argument.startsWith("--") && argument !== "--require-complete");
if (unknownFlags.length) throw new Error(`unknown option: ${unknownFlags.join(", ")}`);

const root = resolve(rootArgument);
const manifest = await validateCapturePackage(root);
const exceptionCount = manifest.counts.statuses.exception ?? 0;

if (args.includes("--require-complete") && (manifest.status !== "complete" || exceptionCount !== 0)) {
  throw new Error(`capture is not complete: status=${manifest.status}, exceptions=${exceptionCount}`);
}

console.log(JSON.stringify({
  valid: true,
  root,
  batchId: manifest.batchId,
  status: manifest.status,
  queries: manifest.counts.queries,
  pages: manifest.counts.pages,
  records: manifest.counts.records,
  bytes: manifest.counts.bytes,
  statuses: manifest.counts.statuses,
  manifestContentSha256: manifest.manifestContentSha256,
}, null, 2));
