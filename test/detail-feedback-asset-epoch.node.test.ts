import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("detail feedback asset epoch", () => {
  it("keeps a minify-surviving marker so the hashed filename can change", () => {
    const source = readFileSync("src/components/DetailFeedback.tsx", "utf8");
    expect(source).toMatch(
      /export const DETAIL_FEEDBACK_ASSET_EPOCH = "881";/,
    );
    expect(source).toMatch(/data-asset-epoch=\{DETAIL_FEEDBACK_ASSET_EPOCH\}/);
  });
});
