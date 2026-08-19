import { describe, expect, it } from "vitest";
import { classifyChangedPaths } from "../scripts/ci/classify-changed-paths.mjs";
import deployWorkflow from "../.github/workflows/deploy.yml?raw";

describe("classifyChangedPaths", () => {
  it("treats an empty change set as web so CI stays conservative", () => {
    expect(classifyChangedPaths([])).toEqual({ web: true, offline: false });
  });

  it("skips web CI for documentation and markdown-only changes", () => {
    expect(
      classifyChangedPaths(["docs/adr/0001-legacy-review-tiered-moderation.md", "README.md", "AGENTS.md"]),
    ).toEqual({ web: false, offline: false });
  });

  it("skips web CI for agent docs", () => {
    expect(classifyChangedPaths([".agents/skills/heroui-react/SKILL.md"])).toEqual({
      web: false,
      offline: false,
    });
  });

  it("routes OCR and evidence scripts to offline CI without Playwright", () => {
    expect(
      classifyChangedPaths([
        "scripts/legacy_ocr/ocr_review_cells.py",
        "scripts/legacy_evidence/formula_bar.ts",
        "scripts/legacy_evidence/formula_bar.test.ts",
      ]),
    ).toEqual({ web: false, offline: true });
  });

  it("keeps mixed OCR and docs changes on the offline path", () => {
    expect(
      classifyChangedPaths(["docs/adr/0019-grok-workflow-legacy-review-package.md", "scripts/legacy_ocr/approval.py"]),
    ).toEqual({ web: false, offline: true });
  });

  it("runs full web CI when the site, worker, or GitHub workflow changes", () => {
    expect(classifyChangedPaths(["src/pages/CoursesPage.tsx"])).toEqual({ web: true, offline: false });
    expect(classifyChangedPaths([".github/workflows/ci.yml"])).toEqual({ web: true, offline: false });
    expect(classifyChangedPaths(["package.json", "scripts/legacy_ocr/approval.py"])).toEqual({
      web: true,
      offline: true,
    });
  });

  it("keeps grok matrix workflows on the offline path", () => {
    expect(classifyChangedPaths([".grok/workflows/legacy-matrix-freeze.rhai"])).toEqual({
      web: false,
      offline: true,
    });
  });

  it("keeps deploy gated on web changes and ignores offline trees", () => {
    expect(deployWorkflow).toContain("if: needs.changes.outputs.web == 'true'");
    expect(deployWorkflow).toContain("scripts/legacy_ocr/**");
    expect(deployWorkflow).toContain("scripts/legacy_evidence/**");
    expect(deployWorkflow).toContain(".grok/**");
  });

  it("does not send PR 312 style matrix-freeze changes through Playwright", () => {
    expect(
      classifyChangedPaths([
        ".grok/workflows/legacy-matrix-freeze.rhai",
        "CONTEXT.md",
        "docs/adr/0019-grok-workflow-legacy-review-package.md",
        "scripts/legacy_evidence/matrix_freeze.test.ts",
        "scripts/legacy_evidence/matrix_freeze.ts",
        "scripts/legacy_evidence/matrix_freeze_cli.ts",
      ]),
    ).toEqual({ web: false, offline: true });
  });
});
