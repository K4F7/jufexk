import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

type WranglerCommandOptions = {
  nodeExecutable?: string;
  resolvePackage?: (specifier: string) => string;
};

export function createProductionD1ExportCommand(
  backupPath: string,
  options: WranglerCommandOptions = {},
) {
  const wranglerPackage = options.resolvePackage
    ? options.resolvePackage("wrangler/package.json")
    : createRequire(import.meta.url).resolve("wrangler/package.json");
  const wranglerCli = resolve(dirname(wranglerPackage), "bin/wrangler.js");

  return {
    executable: options.nodeExecutable ?? process.execPath,
    args: [
      wranglerCli,
      "d1",
      "export",
      "jufexk",
      "--remote",
      `--output=${backupPath}`,
      "-y",
    ],
    wranglerCli,
  };
}
