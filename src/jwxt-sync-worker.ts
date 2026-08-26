import iconv from "iconv-lite";
import { z } from "zod";
import {
  EhallCookieAuthAdapter,
  JwxtAuthenticationError,
  JwxtCookieExpiredError,
} from "../scripts/jwxt-collector/auth-adapter";
import {
  collectJwxt,
  type CollectorCheckpoint,
  type RedactedJwxtCapture,
} from "../scripts/jwxt-collector/collector";
import type { Bindings, RuntimeSecret } from "./app-env";
import {
  publishJwxtSyncGeneration,
  stageJwxtSyncGeneration,
  type JwxtSyncGenerationInput,
  type JwxtSyncMode,
  type JwxtSyncStagedRow,
} from "./jwxt-sync-publication";
import { looksLikeForbidden } from "./lib/jwxt-offering";

const sourceOfferingSchema = z.object({
  courseCode: z.string(),
  courseName: z.string(),
  section: z.string().default(""),
  teacherName: z.string(),
  termId: z.string(),
  campus: z.string().default(""),
  weekText: z.string().default(""),
  timeText: z.string().default(""),
  place: z.string().default(""),
});

const captureSchema = z.object({
  capturedAt: z.string().datetime(),
  complete: z.boolean(),
  offerings: z.array(sourceOfferingSchema),
});

export type WorkerJwxtMode = JwxtSyncMode | "resume";

export type WorkerJwxtSyncResult = {
  generationId: string;
  mode: JwxtSyncMode;
  state: "staged" | "published";
  rowCount: number;
  capturedAt: string;
};

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rowFromSource(source: z.infer<typeof sourceOfferingSchema>): Promise<JwxtSyncStagedRow> {
  const classNumber = clean(source.section);
  const publicFields = {
    courseCode: clean(source.courseCode),
    courseName: clean(source.courseName),
    teacherSourceLabel: clean(source.teacherName),
    termId: clean(source.termId),
    campus: clean(source.campus),
    weekText: clean(source.weekText),
    timeText: clean(source.timeText),
    place: clean(source.place),
    // The class number remains only inside the one-way source identity below.
    // It is not placed in R2 or D1, where it would be an unnecessary private field.
    classNumber: "",
  };
  if (!publicFields.courseCode || !publicFields.courseName || !publicFields.teacherSourceLabel || !publicFields.termId) {
    throw new Error("jwxt_row_identity_missing");
  }
  if (looksLikeForbidden(Object.values(publicFields).join(" "))) {
    throw new Error("jwxt_forbidden_field");
  }
  const identity = JSON.stringify([
    publicFields.termId,
    publicFields.courseCode,
    classNumber || [publicFields.campus, publicFields.weekText, publicFields.timeText, publicFields.place].join("|"),
    publicFields.teacherSourceLabel,
  ]);
  return {
    sourceKey: await sha256Hex(identity),
    sourceRowSha256: await sha256Hex(JSON.stringify(publicFields)),
    ...publicFields,
  };
}

async function buildWorkerInput(
  source: RedactedJwxtCapture,
  requestedMode: WorkerJwxtMode,
): Promise<{ input: JwxtSyncGenerationInput; ndjson: string }> {
  const capture = captureSchema.parse(source);
  const mode: JwxtSyncMode = requestedMode === "resume" ? "full" : requestedMode;
  const rows = (await Promise.all(capture.offerings.map(rowFromSource)))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  if (new Set(rows.map((row) => row.sourceKey)).size !== rows.length) {
    throw new Error("jwxt_duplicate_source_identity");
  }
  const ndjson = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  const sourceSha256 = await sha256Hex(ndjson);
  const generationHash = await sha256Hex(JSON.stringify({ mode, complete: mode !== "pilot", sourceSha256 }));
  return {
    ndjson,
    input: {
      generationId: `jwxt-${generationHash.slice(0, 24)}`,
      mode,
      sourceSha256,
      // Incremental is a complete generation for its selected term. Pilot is
      // deliberately staged only and must never become the active generation.
      complete: mode !== "pilot",
      capturedAt: capture.capturedAt,
      expectedRowCount: rows.length,
      rows,
    },
  };
}

function decodeJwxtBytes(bytes: Uint8Array): string {
  return iconv.decode(Buffer.from(bytes), "gb18030");
}

async function readSecret(value: RuntimeSecret | undefined): Promise<string> {
  if (!value) return "";
  return (typeof value === "string" ? value : await value.get()).trim();
}

const CHECKPOINT_KEY = "checkpoints/collector-latest.json";

function safeReason(error: unknown): string {
  if (error instanceof JwxtCookieExpiredError) return "jwxt_cookie_expired";
  if (error instanceof JwxtAuthenticationError) return error.message.split(":", 1)[0] || "auth_failed";
  if (error instanceof Error && /^jwxt_[a-z0-9_]+$/.test(error.message)) return error.message;
  return "sync_failed";
}

export async function runJwxtWorkerSync(
  env: Bindings,
  requestedMode: WorkerJwxtMode,
): Promise<WorkerJwxtSyncResult> {
  const cookie = await readSecret(env.JWXT_EHALL_COOKIE);
  if (!cookie) throw new Error("jwxt_cookie_missing");
  if (!env.JWXT_SYNC_BUCKET) throw new Error("jwxt_sync_bucket_missing");

  const bucket = env.JWXT_SYNC_BUCKET;
  let resume: CollectorCheckpoint | undefined;
  if (requestedMode === "resume") {
    const object = await bucket.get(CHECKPOINT_KEY);
    if (!object) throw new Error("jwxt_resume_checkpoint_missing");
    resume = JSON.parse(await object.text()) as CollectorCheckpoint;
  }
  const capture = await collectJwxt(
    new EhallCookieAuthAdapter(cookie),
    requestedMode,
    undefined,
    {
      resume,
      save: async (checkpoint) => {
        await bucket.put(CHECKPOINT_KEY, JSON.stringify(checkpoint), {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
        });
      },
    },
    decodeJwxtBytes,
  );
  const { input, ndjson } = await buildWorkerInput(capture, requestedMode);
  if (input.mode !== "pilot" && input.rows.length === 0) {
    throw new Error("jwxt_empty_generation");
  }
  await stageJwxtSyncGeneration(env.DB, input);
  const manifest = {
    schemaVersion: 1,
    generationId: input.generationId,
    mode: input.mode,
    complete: input.complete,
    capturedAt: input.capturedAt,
    rowCount: input.rows.length,
    contentSha256: input.sourceSha256,
    compression: "none",
  } as const;
  await bucket.put(`generations/${input.generationId}/manifest.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  await bucket.put(`generations/${input.generationId}/offerings.ndjson`, ndjson, {
    httpMetadata: { contentType: "application/x-ndjson; charset=utf-8" },
  });
  let state: WorkerJwxtSyncResult["state"] = "staged";
  if (input.mode !== "pilot") {
    await publishJwxtSyncGeneration(env.DB, input);
    state = "published";
  }
  const result: WorkerJwxtSyncResult = {
    generationId: input.generationId,
    mode: input.mode,
    state,
    rowCount: input.rows.length,
    capturedAt: input.capturedAt,
  };
  await bucket.put("checkpoints/latest.json", JSON.stringify(result), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  return result;
}

export function workerSyncErrorReason(error: unknown): string {
  return safeReason(error);
}
