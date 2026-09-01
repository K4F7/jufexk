import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
const files = (await readdir(directory)).filter((file) => file.endsWith(".sql"));
const prefixes = new Map();
const legacyDuplicatePrefixes = new Set(["0008", "0010", "0011", "0034", "0039", "0042", "0044", "0046", "0047"]);
const legacyUnsafeDrops = new Set(["0010", "0011", "0038"]);
let failed = false;
for (const file of files) {
  const match = /^(\d+)[a-z]?_/.exec(file);
  if (!match) { console.error(`migration missing numeric prefix: ${file}`); failed = true; continue; }
  const group = prefixes.get(match[1]) ?? [];
  group.push(file); prefixes.set(match[1], group);
  const sql = await readFile(join(directory, file), "utf8");
  if (/\bDROP\s+TABLE\b/i.test(sql) && !/\bIF\s+EXISTS\b/i.test(sql) && !legacyUnsafeDrops.has(match[1])) {
    console.error(`migration DROP TABLE requires explicit safety review: ${file}`); failed = true;
  }
}
for (const [prefix, group] of prefixes) if (group.length > 1 && !legacyDuplicatePrefixes.has(prefix)) {
  console.error(`duplicate migration prefix ${prefix}: ${group.join(", ")}`); failed = true;
}
if (failed) process.exit(1);
console.log(`checked ${files.length} migrations`);
