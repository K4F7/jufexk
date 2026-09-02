import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { assertReadOnlySelectSql } from "./sql";

const execFileAsync = promisify(execFileCallback);

export type WranglerCommandOptions = {
  nodeExecutable?: string;
  resolvePackage?: (specifier: string) => string;
};

export type WranglerD1ExecuteBatch = {
  results?: unknown[];
  success?: boolean;
  error?: string;
  meta?: {
    changes?: number;
    rows_written?: number;
    changed_db?: boolean;
    duration?: number;
  };
};

type ExecFileImpl = (
  executable: string,
  args: string[],
  options: { cwd?: string; timeout?: number; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

export function resolveWranglerCli(
  resolvePackage: (specifier: string) => string = (specifier) =>
    createRequire(import.meta.url).resolve(specifier),
): string {
  return resolve(dirname(resolvePackage("wrangler/package.json")), "bin/wrangler.js");
}

export function createPeMappingAuditExecuteCommand(
  options: {
    sql: string;
    remote: boolean;
  } & WranglerCommandOptions,
) {
  assertReadOnlySelectSql(options.sql);
  const wranglerCli = resolveWranglerCli(options.resolvePackage);
  return {
    executable: options.nodeExecutable ?? process.execPath,
    wranglerCli,
    args: [
      wranglerCli,
      "d1",
      "execute",
      "jufexk",
      options.remote ? "--remote" : "--local",
      "--json",
      "-y",
      "--command",
      options.sql,
    ],
  };
}

export function createWranglerJsonCommand(
  args: string[],
  options: WranglerCommandOptions = {},
) {
  const wranglerCli = resolveWranglerCli(options.resolvePackage);
  return {
    executable: options.nodeExecutable ?? process.execPath,
    wranglerCli,
    args: [wranglerCli, ...args],
  };
}

export function extractJsonValue(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("wrangler 输出为空");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[\[{]/);
    if (start < 0) {
      throw new Error(`wrangler 输出不含 JSON: ${trimmed.slice(0, 200)}`);
    }
    return JSON.parse(trimmed.slice(start));
  }
}

export function parseWranglerD1ExecuteJson(stdout: string): WranglerD1ExecuteBatch[] {
  const parsed = extractJsonValue(stdout);
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  return batches.map((batch, index) => {
    if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
      throw new Error(`D1 JSON 结果 ${index} 不是对象`);
    }
    return batch as WranglerD1ExecuteBatch;
  });
}

export function assertWranglerD1ReadOnly(batches: WranglerD1ExecuteBatch[]): void {
  for (const [index, batch] of batches.entries()) {
    if (batch.success === false) {
      throw new Error(`D1 查询 ${index} 失败: ${batch.error ?? "unknown"}`);
    }
    const meta = batch.meta ?? {};
    if (
      Number(meta.changes ?? 0) > 0 ||
      Number(meta.rows_written ?? 0) > 0 ||
      meta.changed_db === true
    ) {
      throw new Error(`D1 查询 ${index} 写入了数据，已中止审计`);
    }
  }
}

export function resultRows(batch: WranglerD1ExecuteBatch | undefined): unknown[] {
  const rows = batch?.results;
  if (!Array.isArray(rows)) throw new Error("D1 查询缺少 results");
  return rows;
}

export async function executePeMappingAuditSql(options: {
  sql: string;
  remote: boolean;
  execFile?: ExecFileImpl;
  cwd?: string;
} & WranglerCommandOptions): Promise<WranglerD1ExecuteBatch[]> {
  assertReadOnlySelectSql(options.sql);
  const command = createPeMappingAuditExecuteCommand(options);
  const execFile = options.execFile ?? execFileAsync;
  const result = await execFile(command.executable, command.args, {
    cwd: options.cwd ?? process.cwd(),
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const batches = parseWranglerD1ExecuteJson(result.stdout || result.stderr);
  assertWranglerD1ReadOnly(batches);
  return batches;
}

function createdOnMs(record: Record<string, unknown>): number {
  const raw = record.created_on ?? record.createdOn ?? record.created_at;
  const parsed = Date.parse(String(raw ?? ""));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function versionIdFromRecord(record: Record<string, unknown>): string | null {
  const nested = record.versions;
  if (Array.isArray(nested) && nested[0] && typeof nested[0] === "object") {
    const versionId = (nested[0] as Record<string, unknown>).version_id;
    if (typeof versionId === "string" && versionId) return versionId;
  }
  for (const key of ["version_id", "versionId", "id", "deployment_id"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function parseWorkerVersionId(jsonText: string): string | null {
  const parsed = extractJsonValue(jsonText);
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { deployments?: unknown }).deployments)
      ? (parsed as { deployments: unknown[] }).deployments
      : [];
  const records = items.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
  if (!records.length) return null;
  const latest = [...records].sort((left, right) => createdOnMs(right) - createdOnMs(left))[0];
  return versionIdFromRecord(latest);
}
