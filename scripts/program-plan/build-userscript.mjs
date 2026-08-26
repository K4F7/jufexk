import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptRoot, "../..");
const output = resolve(scriptRoot, "userscript/jufexk-program-plan-collector.user.js");
const result = await build({
  entryPoints: [resolve(scriptRoot, "userscript/index.ts")],
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "iife",
  charset: "utf8",
  minify: false,
  write: false,
});
const header = `// ==UserScript==\n// @name         选课志培养方案采集器\n// @namespace    https://github.com/K4F7/jufexk\n// @version      1.0.0\n// @description  人工登录后串行采集 KINGOSOFT 培养方案理论课程原始页面\n// @match        https://jwxt.jxufe.edu.cn/*\n// @grant        none\n// @run-at       document-idle\n// ==/UserScript==\n\n`;
await writeFile(output, header + result.outputFiles[0].text);
console.log(`built ${output.slice(root.length + 1)}`);
