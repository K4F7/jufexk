import { describe, expect, it } from "vitest";
import {
  HISTORICAL_PRODUCTION_PACKAGE_ROOT,
  parseProductionImportArguments,
} from "../scripts/historical-import/production-arguments";

describe("historical production import arguments", () => {
  it.each([
    { argv: [], apply: false },
    { argv: [HISTORICAL_PRODUCTION_PACKAGE_ROOT], apply: false },
    { argv: ["--", HISTORICAL_PRODUCTION_PACKAGE_ROOT], apply: false },
    { argv: ["--apply"], apply: true },
    { argv: [HISTORICAL_PRODUCTION_PACKAGE_ROOT, "--apply"], apply: true },
    { argv: ["--", HISTORICAL_PRODUCTION_PACKAGE_ROOT, "--apply"], apply: true },
  ])("parses $argv", ({ argv, apply }) => {
    expect(parseProductionImportArguments(argv, "win32")).toEqual({
      apply,
      root: HISTORICAL_PRODUCTION_PACKAGE_ROOT,
    });
  });

  it.each([
    ["--unknown"],
    ["--apply", "--apply"],
    [HISTORICAL_PRODUCTION_PACKAGE_ROOT, HISTORICAL_PRODUCTION_PACKAGE_ROOT],
    ["D:/19016/Documents/Workload/other-package"],
  ])("rejects invalid arguments: %s", (...argv) => {
    expect(() => parseProductionImportArguments(argv, "win32")).toThrow();
  });

  it("rejects non-Windows execution instead of weakening the fixed path", () => {
    expect(() => parseProductionImportArguments([], "linux")).toThrow(
      "只允许在 Windows 执行",
    );
  });
});
