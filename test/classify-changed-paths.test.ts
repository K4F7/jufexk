import { describe, expect, it } from "vitest";
import { classifyChangedPaths } from "../scripts/ci/classify-changed-paths.mjs";
import deployWorkflow from "../.github/workflows/deploy.yml?raw";
import migrateWorkflow from "../.github/workflows/migrate.yml?raw";

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

  it("routes grok workflows to offline CI without Playwright", () => {
    expect(classifyChangedPaths([".grok/workflows/ustc-aligned-review-v1.rhai"])).toEqual({
      web: false,
      offline: true,
    });
  });

  it("keeps mixed grok and docs changes on the offline path", () => {
    expect(
      classifyChangedPaths(["docs/adr/0024-retire-ocr-and-old-import-packages.md", ".grok/workflows/ustc-aligned-review-v1.rhai"]),
    ).toEqual({ web: false, offline: true });
  });

  it("runs full web CI when the site, worker, or GitHub workflow changes", () => {
    expect(classifyChangedPaths(["src/pages/CoursesPage.tsx"])).toEqual({ web: true, offline: false });
    expect(classifyChangedPaths([".github/workflows/ci.yml"])).toEqual({ web: true, offline: false });
    expect(classifyChangedPaths(["package.json", ".grok/workflows/ustc-aligned-review-v1.rhai"])).toEqual({
      web: true,
      offline: true,
    });
  });

  it("keeps deploy gated on web changes and ignores offline trees", () => {
    expect(deployWorkflow).toContain("if: needs.changes.outputs.web == 'true'");
    expect(deployWorkflow).toContain(".grok/**");
    expect(deployWorkflow).not.toContain("scripts/legacy_ocr/**");
    expect(deployWorkflow).not.toContain("scripts/legacy_evidence/**");
  });

  it("keeps production deploy to build and wrangler deploy only", () => {
    expect(deployWorkflow).toContain("pnpm run build");
    expect(deployWorkflow).toContain("wrangler deploy");
    expect(deployWorkflow).not.toContain("playwright");
    expect(deployWorkflow).not.toContain("pnpm run check");
    expect(deployWorkflow).not.toContain("ensure-remote");
    expect(deployWorkflow).not.toContain("migrations list");
    expect(deployWorkflow).not.toContain("migrations apply");
  });

  it("applies remote D1 migrations only from an on-demand workflow", () => {
    expect(migrateWorkflow).toContain("workflow_dispatch");
    expect(migrateWorkflow).not.toContain("push:");
    expect(migrateWorkflow).not.toContain("migrations/**");
    expect(migrateWorkflow).toContain("production-d1-migrate");
    expect(migrateWorkflow).toContain("wrangler d1 migrations list jufexk --remote");
    expect(migrateWorkflow).toContain("wrangler d1 migrations apply jufexk --remote");
  });
});
