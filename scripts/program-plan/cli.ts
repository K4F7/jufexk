import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deriveProgramPlan } from "./derive";

const usage = "usage: pnpm run program-plan derive <capture-directory> [--output <derivation-directory>] [--catalog-codes <codes.txt>]";
const [command, inputArgument, ...rest] = process.argv.slice(2);
if (!inputArgument || command !== "derive") throw new Error(usage);
const outputFlag = rest.indexOf("--output");
const catalogFlag = rest.indexOf("--catalog-codes");
const claimed = new Set<number>();
for (const index of [outputFlag, catalogFlag]) {
  if (index < 0) continue;
  if (!rest[index + 1]) throw new Error(usage);
  claimed.add(index);
  claimed.add(index + 1);
}
if (rest.some((_value, index) => !claimed.has(index))) throw new Error(usage);
const inputRoot = resolve(inputArgument);
const outputRoot = resolve(outputFlag >= 0 ? rest[outputFlag + 1] : `${inputRoot}-derived`);
const catalogCourseCodes = catalogFlag >= 0
  ? (await readFile(resolve(rest[catalogFlag + 1]), "utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  : undefined;
const manifest = await deriveProgramPlan(inputRoot, outputRoot, { catalogCourseCodes });
console.log(JSON.stringify({ ...manifest, outputRoot }, null, 2));
