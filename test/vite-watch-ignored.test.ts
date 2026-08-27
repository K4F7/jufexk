import { describe, expect, it } from "vitest";
import viteConfigSource from "../vite.config.ts?raw";

describe("vite file watcher", () => {
  it("ignores agent worktrees so prototype HMR stays responsive", () => {
    expect(viteConfigSource).toContain(".worktree/**");
    expect(viteConfigSource).not.toContain("**/.worktree/**");
    expect(viteConfigSource).toMatch(/watch:\s*\{[\s\S]*ignored:/);
  });
});
