import { describe, expect, it } from "vitest";
import { shouldShowScheduleNav } from "../src/lib/public-surface";

describe("shouldShowScheduleNav", () => {
  it("shows the schedule nav on loopback even with a production surface", () => {
    expect(
      shouldShowScheduleNav({ publicSurface: "production", loopback: true }),
    ).toBe(true);
  });

  it("shows the schedule nav on the preview surface", () => {
    expect(
      shouldShowScheduleNav({ publicSurface: "preview", loopback: false }),
    ).toBe(true);
  });

  it("hides the schedule nav on the production surface", () => {
    expect(
      shouldShowScheduleNav({ publicSurface: "production", loopback: false }),
    ).toBe(false);
  });
});
