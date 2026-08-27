import { describe, expect, it } from "vitest";
import { classifyChangedPaths } from "../scripts/ci/classify-changed-paths.mjs";
import bindAdminWorkflow from "../.github/workflows/bind-admin-students.yml?raw";
import ctaSyncWorkflow from "../.github/workflows/cta-sync.yml?raw";
import ciWorkflow from "../.github/workflows/ci.yml?raw";
import playwrightConfig from "../playwright.config.ts?raw";
import deployWorkflow from "../.github/workflows/deploy.yml?raw";
import migrateWorkflow from "../.github/workflows/migrate.yml?raw";
import packageJsonRaw from "../package.json?raw";

const packageScripts = (JSON.parse(packageJsonRaw) as { scripts: Record<string, string> }).scripts;

describe("classifyChangedPaths", () => {
  it("treats an empty change set as web so CI stays conservative", () => {
    expect(classifyChangedPaths([])).toEqual({ web: true });
  });

  it("skips web CI for documentation and markdown-only changes", () => {
    expect(
      classifyChangedPaths(["docs/adr/0001-legacy-review-tiered-moderation.md", "README.md", "AGENTS.md"]),
    ).toEqual({ web: false });
  });

  it("skips web CI for agent docs", () => {
    expect(classifyChangedPaths([".agents/skills/heroui-react/SKILL.md"])).toEqual({
      web: false,
    });
  });

  it("runs full web CI for changes outside the documented skip paths", () => {
    expect(classifyChangedPaths([".grok/workflows/ustc-aligned-review-v1.rhai"])).toEqual({
      web: true,
    });
    expect(classifyChangedPaths(["src/pages/CoursesPage.tsx"])).toEqual({ web: true });
    expect(classifyChangedPaths([".github/workflows/ci.yml"])).toEqual({ web: true });
    expect(classifyChangedPaths(["package.json", ".grok/workflows/ustc-aligned-review-v1.rhai"])).toEqual({
      web: true,
    });
  });

  it("splits full web CI across static, Workers, and browser jobs", () => {
    expect(ciWorkflow).not.toContain("offline");
    expect(ciWorkflow.match(/^  web_static:/gm)).toHaveLength(1);
    expect(ciWorkflow).toContain("pnpm run check:static");
    expect(packageScripts["check:static"]).toBe(
      "wrangler types && tsc --noEmit && pnpm run test:static && vite build && wrangler deploy --dry-run --env=\"\"",
    );
    expect(packageScripts["test:static"]).toBe(
      "vitest run --config vitest.node.config.ts && vitest run --config vitest.catalog-baseline.config.ts && vitest run --config vitest.program-plan.config.ts && vitest run --config vitest.secrets.config.ts",
    );
    expect(ciWorkflow.match(/shard: \["1\/2", "2\/2"\]/g)).toHaveLength(2);
    expect(ciWorkflow).toContain(
      "pnpm exec vitest run --no-file-parallelism --shard=${{ matrix.shard }}",
    );
    expect(ciWorkflow.match(/fail-fast: true/g)).toHaveLength(2);

    expect(ciWorkflow).toContain(
      "pnpm exec playwright test --project=chromium --shard=${{ matrix.shard }}",
    );
    expect(ciWorkflow).toContain(
      "pnpm exec playwright test --project=mobile-chromium --grep @mobile-smoke --shard=${{ matrix.shard }}",
    );
    expect(ciWorkflow).not.toContain("matrix.project");
    expect(playwrightConfig).toContain('name: "mobile-chromium"');
    expect(playwrightConfig).toContain('testIgnore: ["admin*.browser.test.ts"]');
  });

  it("requires every selected CI matrix to complete successfully", () => {
    expect(ciWorkflow).toContain("needs: [changes, web_static, vitest_workers, browser]");
    expect(ciWorkflow).toContain("if: always()");
    expect(ciWorkflow).toContain('if [[ "$web_required" == "true" ]]');
    expect(ciWorkflow).toContain('expected="success"');
    expect(ciWorkflow).toContain('elif [[ "$web_required" == "false" ]]');
    expect(ciWorkflow).toContain('expected="skipped"');
    expect(ciWorkflow).toMatch(/elif \[\[ "\$web_required" == "false" \]\][\s\S]*else\s+exit 1/);
    expect(ciWorkflow).toContain('if [[ "$result" != "$expected" ]]');
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
    expect(deployWorkflow).toContain("wrangler deploy --env preview");
    expect(deployWorkflow).not.toContain("playwright");
    expect(deployWorkflow).not.toContain("pnpm run check");
    expect(deployWorkflow).not.toContain("ensure-remote");
    expect(deployWorkflow).not.toContain("migrations list");
    expect(deployWorkflow).not.toContain("migrations apply");
  });

  it("applies remote D1 migrations from a separate workflow, not deploy", () => {
    expect(migrateWorkflow).toContain("workflow_dispatch");
    expect(migrateWorkflow).toContain("push:");
    expect(migrateWorkflow).toContain("migrations/**");
    expect(migrateWorkflow).toContain("production-d1-migrate");
    expect(migrateWorkflow).toContain("wrangler d1 migrations list jufexk --remote");
    expect(migrateWorkflow).toContain("wrangler d1 migrations apply jufexk --remote");
    expect(migrateWorkflow).toContain(
      "wrangler d1 migrations list jufexk-preview --env preview --remote",
    );
    expect(migrateWorkflow).toContain(
      "wrangler d1 migrations apply jufexk-preview --env preview --remote",
    );
    expect(deployWorkflow).not.toContain("migrations apply");
  });

  it("binds admin student IDs only from an on-demand workflow using the identity secret", () => {
    expect(bindAdminWorkflow).toContain("workflow_dispatch");
    expect(bindAdminWorkflow).not.toContain("push:");
    expect(bindAdminWorkflow).toContain("production-admin-student-bind");
    expect(bindAdminWorkflow).toContain("secrets.CAMPUS_IDENTITY_SECRET");
    expect(bindAdminWorkflow).toContain("JUFEXK_ADMIN_STUDENT_IDS");
    expect(bindAdminWorkflow).toContain(
      "scripts/admin/bind-student-ids.ts --remote --apply",
    );
  });

  it("writes CTA homepages only from an on-demand production workflow", () => {
    expect(ctaSyncWorkflow).toContain("workflow_dispatch");
    expect(ctaSyncWorkflow).not.toContain("push:");
    expect(ctaSyncWorkflow).toContain("production-cta-sync");
    expect(ctaSyncWorkflow).toContain("environment: production");
    expect(ctaSyncWorkflow).toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(ctaSyncWorkflow).toContain("pnpm cta-sync");
    expect(ctaSyncWorkflow).toContain(
      "scripts/cta-sync/apply-remote.ts --remote --apply",
    );
  });

});
