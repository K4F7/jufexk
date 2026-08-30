import { describe, expect, it } from "vitest";
import { reviewCardClassName } from "../src/components/ReviewFoldedBody";

describe("reviewCardClassName", () => {
  it("does not put a last-child border on course cards (list items wrap them)", () => {
    const className = reviewCardClassName({
      compact: false,
      variant: "course",
    });
    expect(className).toContain("scroll-mt-20");
    expect(className).not.toContain("border-b");
    expect(className).not.toContain("last:border-b-0");
  });
});
