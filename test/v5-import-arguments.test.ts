import { describe, expect, it } from "vitest";
import {
  V5_CANDIDATE_PACKAGE_ROOT,
  assertV5PreviewOnly,
  parseV5ImportArguments,
} from "../scripts/historical-import/v5-arguments";

describe("v5 production candidate import arguments", () => {
  it.each([
    { argv: [], apply: false },
    { argv: [V5_CANDIDATE_PACKAGE_ROOT], apply: false },
    { argv: ["--", V5_CANDIDATE_PACKAGE_ROOT], apply: false },
    { argv: ["--apply"], apply: true },
    { argv: [V5_CANDIDATE_PACKAGE_ROOT, "--apply"], apply: true },
    { argv: ["--", V5_CANDIDATE_PACKAGE_ROOT, "--apply"], apply: true },
  ])("parses $argv", ({ argv, apply }) => {
    expect(parseV5ImportArguments(argv, "win32")).toEqual({
      apply,
      root: V5_CANDIDATE_PACKAGE_ROOT,
    });
  });

  it.each([
    ["--unknown"],
    ["--apply", "--apply"],
    [V5_CANDIDATE_PACKAGE_ROOT, V5_CANDIDATE_PACKAGE_ROOT],
    ["D:/19016/Documents/Workload/other-package"],
  ])("rejects invalid arguments: %s", (...argv) => {
    expect(() => parseV5ImportArguments(argv, "win32")).toThrow();
  });

  it("rejects non-Windows execution instead of weakening the fixed path", () => {
    expect(() => parseV5ImportArguments([], "linux")).toThrow(
      "只允许在 Windows 执行",
    );
  });

  it("refuses --apply until the issue authorizes a production write", () => {
    expect(() => assertV5PreviewOnly(true)).toThrow("未授权 --apply");
    expect(() => assertV5PreviewOnly(false)).not.toThrow();
  });
});
