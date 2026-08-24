import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI summary Queue production configuration", () => {
  it("pins dual concurrency, one-message batches, retries and a DLQ", () => {
    const source = readFileSync(resolve("wrangler.jsonc"), "utf8");

    expect(source).toMatch(
      /"binding"\s*:\s*"AI_SUMMARY_QUEUE"\s*,\s*"queue"\s*:\s*"jufexk-ai-summary"/,
    );
    expect(source).toMatch(/"max_batch_size"\s*:\s*1/);
    expect(source).toMatch(/"max_concurrency"\s*:\s*2/);
    expect(source).toMatch(/"max_retries"\s*:\s*3/);
    expect(source).toMatch(/"retry_delay"\s*:\s*30/);
    expect(source).toMatch(
      /"dead_letter_queue"\s*:\s*"jufexk-ai-summary-dlq"/,
    );
  });
});
