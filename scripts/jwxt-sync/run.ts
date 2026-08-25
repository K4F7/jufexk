import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  buildJwxtSyncBundle,
  validateJwxtSyncBundle,
  type JwxtSyncManifest,
} from "./bundle";
import {
  publishJwxtSyncQueries,
  stageJwxtSyncQueries,
  type D1BatchQuery,
  type JwxtSyncGenerationInput,
  type JwxtSyncMode,
} from "../../src/jwxt-sync-publication";

const DATABASE_ID = "7bd119f3-b8a2-4c9d-9e70-2809396ee26c";
const STAGE_BATCH_SIZE = 50;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function d1Batch(
  accountId: string,
  token: string,
  queries: D1BatchQuery[],
): Promise<void> {
  if (queries.length === 0) return;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch: queries.map((query) => ({ sql: query.sql, params: query.params })),
      }),
    },
  );
  const body = (await response.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: Array<{ success?: boolean; error?: string }>;
  };
  const queryFailure = body.result?.find((result) => result.success === false);
  if (!response.ok || body.success !== true || queryFailure) {
    const message =
      queryFailure?.error || body.errors?.map((error) => error.message).filter(Boolean).join("; ") || "D1 query failed";
    throw new Error(message);
  }
}

function rowsFromManifest(
  manifest: JwxtSyncManifest,
  rows: JwxtSyncGenerationInput["rows"],
): JwxtSyncGenerationInput {
  return {
    generationId: manifest.generationId,
    mode: manifest.mode,
    sourceSha256: manifest.contentSha256,
    complete: manifest.complete,
    capturedAt: manifest.capturedAt,
    expectedRowCount: manifest.rowCount,
    rows,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: "string" },
      capture: { type: "string", default: ".local-data/jwxt-sync/capture.json" },
      output: { type: "string", default: ".local-data/jwxt-sync/out" },
      "stage-only": { type: "boolean", default: false },
    },
  });
  const requestedMode = values.mode;
  if (!requestedMode || !["pilot", "incremental", "full", "resume"].includes(requestedMode)) {
    throw new Error("--mode must be pilot, incremental, full, or resume");
  }
  const mode: JwxtSyncMode = requestedMode === "resume" ? "full" : requestedMode as JwxtSyncMode;
  const capturePath = resolve(values.capture);
  const outputDirectory = resolve(values.output);
  const capture = JSON.parse(await readFile(capturePath, "utf8")) as unknown;
  const bundle = buildJwxtSyncBundle(capture, mode);
  const rows = validateJwxtSyncBundle(
    bundle.manifest,
    bundle.compressedRows,
  );
  const input = rowsFromManifest(bundle.manifest, rows);

  await mkdir(outputDirectory, { recursive: true });
  const manifestPath = resolve(outputDirectory, `${bundle.manifest.generationId}.manifest.json`);
  const bundlePath = resolve(outputDirectory, `${bundle.manifest.generationId}.ndjson.gz`);
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(bundle.manifest, null, 2) + "\n", "utf8"),
    writeFile(bundlePath, bundle.compressedRows),
  ]);

  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const token = required("CLOUDFLARE_API_TOKEN");
  const stage = stageJwxtSyncQueries(input);
  for (let offset = 0; offset < stage.length; offset += STAGE_BATCH_SIZE) {
    await d1Batch(accountId, token, stage.slice(offset, offset + STAGE_BATCH_SIZE));
  }
  if (!values["stage-only"]) {
    await d1Batch(accountId, token, publishJwxtSyncQueries(input));
  }

  process.stdout.write(
    JSON.stringify({
      generationId: bundle.manifest.generationId,
      manifestPath,
      bundlePath,
      r2Prefix: `generations/${bundle.manifest.generationId}`,
      state: values["stage-only"] ? "staged" : "published",
    }) + "\n",
  );
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`JWXT sync failed: ${message}\n`);
  process.exitCode = 1;
});
