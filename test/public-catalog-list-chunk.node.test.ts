import { describe, expect, it } from "vitest";
import {
  D1_MAX_BOUND_PARAMETERS,
  extraMergeChunkSize,
} from "../src/lib/public-catalog-list";

describe("PE extras D1 bind chunking", () => {
  it("keeps reviews-sort extras under the D1 bound-parameter cap", () => {
    const extraCount = 38;
    const bindsPerExtra = 3;
    const argCount = 2;
    const chunk = extraMergeChunkSize(
      extraCount,
      extraCount * bindsPerExtra,
      argCount,
    );
    expect(chunk * bindsPerExtra + argCount).toBeLessThanOrEqual(
      D1_MAX_BOUND_PARAMETERS,
    );
    expect(chunk).toBeGreaterThan(0);
    expect(chunk).toBeLessThan(extraCount);
  });

  it("keeps rating-sort extras under the cap", () => {
    const extraCount = 38;
    const bindsPerExtra = 5;
    const chunk = extraMergeChunkSize(
      extraCount,
      extraCount * bindsPerExtra,
      2,
    );
    expect(chunk * bindsPerExtra + 2).toBeLessThanOrEqual(
      D1_MAX_BOUND_PARAMETERS,
    );
  });
});
