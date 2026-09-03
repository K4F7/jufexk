import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TYPECHECKED_ROOTS = ["src", "scripts"] as const;
const SKIP_DIR_NAMES = new Set([
  "_legacy",
  "_deferred",
  "node_modules",
]);
const EXPLICIT_ANY = /\bany\b/;

type Tsconfig = {
  compilerOptions?: {
    strict?: boolean;
    noImplicitAny?: boolean;
  };
};

function walkTypecheckedFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walkTypecheckedFiles(path, files);
      continue;
    }
    if (stats.isFile() && /\.(ts|tsx)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function explicitAnyHits(source: string): number[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "");
  return stripped.split(/\r?\n/).flatMap((line, index) =>
    EXPLICIT_ANY.test(line) ? [index + 1] : [],
  );
}

describe("tsconfig strictness", () => {
  it("lets strict imply noImplicitAny", () => {
    const tsconfig = JSON.parse(
      readFileSync(join(ROOT, "tsconfig.json"), "utf8"),
    ) as Tsconfig;
    expect(tsconfig.compilerOptions?.strict).toBe(true);
    expect(tsconfig.compilerOptions?.noImplicitAny).toBeUndefined();
  });

  it("keeps first-party typechecked sources free of explicit any", () => {
    const hits: string[] = [];
    for (const root of TYPECHECKED_ROOTS) {
      for (const file of walkTypecheckedFiles(join(ROOT, root))) {
        const lines = explicitAnyHits(readFileSync(file, "utf8"));
        const rel = relative(ROOT, file).replaceAll("\\", "/");
        for (const line of lines) hits.push(`${rel}:${line}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
