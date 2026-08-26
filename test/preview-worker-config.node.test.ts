import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("preview Worker configuration", () => {
  const source = readFileSync(resolve("wrangler.jsonc"), "utf8");
  const preview = source.slice(source.indexOf('"preview"'));

  it("pins a workers.dev preview Worker with an isolated D1 and no production queue", () => {
    expect(source).toMatch(/"PUBLIC_SURFACE"\s*:\s*"production"/);
    expect(preview).toMatch(/"name"\s*:\s*"jufexk-preview"/);
    expect(preview).toMatch(/"workers_dev"\s*:\s*true/);
    expect(preview).toMatch(/"PUBLIC_SURFACE"\s*:\s*"preview"/);
    expect(preview).toMatch(/"database_name"\s*:\s*"jufexk-preview"/);
    expect(preview).not.toMatch(/AI_SUMMARY_QUEUE/);
    expect(preview).not.toMatch(/jufexk-ai-summary/);
  });
});
