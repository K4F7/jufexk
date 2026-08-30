/**
 * 把教师院系回填计划写入远端 D1。只通过 GHA production 的
 * CLOUDFLARE_API_TOKEN 执行，不在本机要 Cloudflare 登录。
 *
 *   pnpm exec tsx scripts/teacher-department-backfill/apply-remote.ts --remote --apply
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  chunkStatements,
  executeRemoteSql,
} from "../cta-sync/apply-remote";
import { sqlString } from "../cta-sync/shared";
import type { TeacherDepartmentFill } from "../../src/teacher-department-backfill";

export function departmentUpdateStatements(
  fills: readonly TeacherDepartmentFill[],
): string[] {
  return fills.map(
    (fill) =>
      `UPDATE teachers SET department=${sqlString(fill.department)} WHERE id=${fill.teacherId} AND trim(COALESCE(department,''))=''`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      remote: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      output: { type: "string", default: ".local-data/teacher-department-backfill" },
    },
  });
  if (!values.remote || !values.apply) {
    throw new Error(
      "必须同时传入 --remote --apply。GHA production 才会带 CLOUDFLARE_API_TOKEN。",
    );
  }
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error(
      "缺少 CLOUDFLARE_API_TOKEN。请走 GitHub Actions production 环境，不要在本机登录。",
    );
  }

  const output = resolve(values.output || ".local-data/teacher-department-backfill");
  const fills = JSON.parse(
    await readFile(resolve(output, "plan.json"), "utf8"),
  ) as TeacherDepartmentFill[];
  if (!Array.isArray(fills)) throw new Error("plan.json 不是回填数组");
  const chunks = chunkStatements(departmentUpdateStatements(fills));
  console.log("department sql chunks", chunks.length, "fills", fills.length);
  for (const [index, sql] of chunks.entries()) {
    console.log(`department ${index + 1}/${chunks.length}`);
    await executeRemoteSql(sql);
  }
  console.log(
    JSON.stringify(
      {
        chunks: chunks.length,
        fills: fills.length,
        catalog: fills.filter((fill) => fill.source === "catalog").length,
        cta: fills.filter((fill) => fill.source === "cta").length,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
