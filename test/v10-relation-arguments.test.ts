import { describe, expect, it } from "vitest";
import {
  ISSUE365_RELATION_PACKAGE_ROOT,
  parseV10RelationArguments,
} from "../scripts/catalog-relation-additions/v10-arguments";

describe("issue365 relation addition arguments", () => {
  it.each([
    { argv: [], apply: false },
    { argv: [ISSUE365_RELATION_PACKAGE_ROOT], apply: false },
    { argv: ["--", ISSUE365_RELATION_PACKAGE_ROOT], apply: false },
    { argv: [ISSUE365_RELATION_PACKAGE_ROOT, "--apply"], apply: true },
    {
      argv: ["--", ISSUE365_RELATION_PACKAGE_ROOT, "--apply"],
      apply: true,
    },
  ])("parses $argv", ({ argv, apply }) => {
    expect(parseV10RelationArguments(argv, "win32")).toEqual({
      apply,
      root: ISSUE365_RELATION_PACKAGE_ROOT,
    });
  });

  it.each([
    ["--unknown"],
    ["--apply", "--apply"],
    ["--via-pairs"],
    [ISSUE365_RELATION_PACKAGE_ROOT, ISSUE365_RELATION_PACKAGE_ROOT],
    ["D:/19016/Documents/Workload/other-package"],
  ])("rejects invalid arguments: %s", (...argv) => {
    expect(() => parseV10RelationArguments(argv, "win32")).toThrow();
  });

  it("rejects non-Windows execution", () => {
    expect(() => parseV10RelationArguments([], "linux")).toThrow(
      "只允许在 Windows 执行",
    );
  });
});
