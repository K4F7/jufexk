import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const output = resolve(import.meta.dir, "userscript/jufexk-catalog-collector.user.js");
const result = await Bun.build({ entrypoints: [resolve(import.meta.dir, "userscript/index.ts")], target: "browser", format: "iife", minify: false });
if (!result.success) throw new AggregateError(result.logs, "userscript build failed");
const header = `// ==UserScript==\n// @name         选课志目录基线采集器\n// @namespace    https://github.com/K4F7/jufexk\n// @version      1.6.1\n// @description  人工登录后串行采集 KINGOSOFT 课程目录原始页面\n// @match        https://jwxt.jxufe.edu.cn/*\n// @grant        none\n// @run-at       document-idle\n// ==/UserScript==\n\n`;
await writeFile(output, header + await result.outputs[0].text());
console.log(`built ${output.slice(root.length + 1)}`);
