import { describe, expect, it } from "vitest";
import {
  ISSUE111_RELATION_PACKAGE_ROOT,
  parseRelationAdditionArguments,
} from "../scripts/catalog-relation-additions/production-arguments";

describe("issue111 relation addition arguments", () => {
  it.each([
    { argv: [], apply: false, viaPairs: false },
    { argv: [ISSUE111_RELATION_PACKAGE_ROOT], apply: false, viaPairs: false },
    { argv: ["--via-pairs"], apply: false, viaPairs: true },
    { argv: [ISSUE111_RELATION_PACKAGE_ROOT, "--apply"], apply: true, viaPairs: false },
    {
      argv: ["--", ISSUE111_RELATION_PACKAGE_ROOT, "--apply", "--via-pairs"],
      apply: true,
      viaPairs: true,
    },
  ])("parses $argv", ({ argv, apply, viaPairs }) => {
    expect(parseRelationAdditionArguments(argv, "win32")).toEqual({
      apply,
      viaPairs,
      root: ISSUE111_RELATION_PACKAGE_ROOT,
    });
  });

  it.each([["--unknown"], ["--apply", "--apply"], ["D:/tmp/other"]])(
    "rejects invalid arguments: %s",
    (...argv) => {
      expect(() => parseRelationAdditionArguments(argv, "win32")).toThrow();
    },
  );

  it("rejects non-Windows execution", () => {
    expect(() => parseRelationAdditionArguments([], "linux")).toThrow(
      "只允许在 Windows 执行",
    );
  });
});
