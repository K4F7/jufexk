import { describe, expect, it } from "vitest";
import {
  ISSUE111_FREEZE_PACKAGE_ROOT,
  parseIssue111ImportArguments,
} from "../scripts/historical-import/issue111-arguments";

describe("issue111 historical import arguments", () => {
  it.each([
    { argv: [], apply: false },
    { argv: [ISSUE111_FREEZE_PACKAGE_ROOT], apply: false },
    { argv: ["--", ISSUE111_FREEZE_PACKAGE_ROOT, "--apply"], apply: true },
  ])("parses $argv", ({ argv, apply }) => {
    expect(parseIssue111ImportArguments(argv, "win32")).toEqual({
      apply,
      root: ISSUE111_FREEZE_PACKAGE_ROOT,
    });
  });

  it.each([["--unknown"], [ISSUE111_FREEZE_PACKAGE_ROOT, ISSUE111_FREEZE_PACKAGE_ROOT]])(
    "rejects invalid arguments: %s",
    (...argv) => {
      expect(() => parseIssue111ImportArguments(argv, "win32")).toThrow();
    },
  );
});
