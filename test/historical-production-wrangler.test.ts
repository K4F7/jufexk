import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createProductionD1ExportCommand } from "../scripts/historical-import/production-wrangler";

describe("historical production Wrangler command", () => {
  it("uses the project Wrangler CLI without nesting through pnpm", () => {
    const resolvePackage = vi.fn(() =>
      resolve("node_modules/wrangler/package.json"),
    );
    const backupPath = resolve("backups/historical-production.sql");

    const command = createProductionD1ExportCommand(backupPath, {
      nodeExecutable: "node-for-test",
      resolvePackage,
    });

    expect(resolvePackage).toHaveBeenCalledOnce();
    expect(resolvePackage).toHaveBeenCalledWith("wrangler/package.json");
    expect(command).toEqual({
      executable: "node-for-test",
      wranglerCli: resolve("node_modules/wrangler/bin/wrangler.js"),
      args: [
        resolve("node_modules/wrangler/bin/wrangler.js"),
        "d1",
        "export",
        "jufexk",
        "--remote",
        `--output=${backupPath}`,
        "-y",
      ],
    });
    expect(command.args).not.toContain("pnpm");
  });
});
