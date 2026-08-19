import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("pinyin-pro Worker global scope", () => {
  it("does not schedule timers when the segmentit module loads", () => {
    const source = readFileSync(
      join(dirname(require.resolve("pinyin-pro/package.json")), "dist/esm/common/segmentit/index.mjs"),
      "utf8",
    );
    expect(source).not.toMatch(/setTimeout\s*\(\s*ensureAcBuilt/);
    expect(source).not.toMatch(/requestIdleCallback\s*\(/);
    expect(source).not.toMatch(/^\s*scheduleAcBuild\(\);/m);
  });
});
