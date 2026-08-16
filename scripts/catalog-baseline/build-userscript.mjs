import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptRoot, "../../..");
const output = resolve(scriptRoot, "userscript/jufexk-catalog-collector.user.js");
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
const header = `// ==UserScript==\n// @name         选课志目录基线采集器\n// @namespace    https://github.com/K4F7/jufexk\n// @version      1.6.1\n// @description  人工登录后串行采集 KINGOSOFT 课程目录原始页面\n// @match        https://jwxt.jxufe.edu.cn/*\n// @grant        none\n// @run-at       document-idle\n// ==/UserScript==\n\n`;
await writeFile(output, header + result.outputFiles[0].text);
console.log(`built ${output.slice(root.length + 1)}`);
