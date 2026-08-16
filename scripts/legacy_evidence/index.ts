import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const ANALYSIS_A_MODEL = "gpt-5.6-luna";
export const ANALYSIS_B_MODEL = "gpt-5.6-luna";
export const ARBITRATION_MODEL = "gpt-5.6-sol";
export const PROMPT_VERSION = "legacy-evidence-codex-orchestrator-v2";
export const SCHEMA_VERSION = "legacy-evidence-schema-v1";
export const MANIFEST_IMAGE_COUNT = 52;
export const DEFAULT_MAX_CONCURRENT_JOBS = 4;
export const GLOBAL_RPM = 20;
export const WORKSHEETS = ["主要课程", "数学课", "英语", "思政课", "外教", "MOOC", "体育课", "美育"] as const;

type Worksheet = (typeof WORKSHEETS)[number];
const WORKSHEET_DIRECTORIES: Record<Worksheet, readonly string[]> = {
  "主要课程": ["主要课程", "major"], "数学课": ["数学课", "maths"], "英语": ["英语", "english"],
  "思政课": ["思政课", "思政"], "外教": ["外教"], MOOC: ["MOOC"], "体育课": ["体育课", "体育"], "美育": ["美育"],
};
type Stage = "analysis_a" | "analysis_b" | "arbitration";
type JobStatus = "pending" | "analyzing_a" | "analyzing_b" | "diff_ready" | "arbitrating" | "completed" | "failed";

export type ManifestImage = {
  id: string;
  worksheet: Worksheet;
  filename: string;
  screenshot_time: string;
  target_path: string;
  previous_image_id: string | null;
  next_image_id: string | null;
  sha256: string;
};

export type Manifest = {
  manifest_path: string;
  manifest_hash: string;
  created_at: string;
  prompt_version: string;
  schema_version: string;
  models: { analysis_a: string; analysis_b: string; arbitration: string };
  images: ManifestImage[];
};

export type RunnerRequest = {
  stage: Stage;
  model: string;
  job: ManifestImage;
  manifest: Manifest;
  jobDir: string;
  prompt: string;
  files: string[];
  attempt: number;
  repair: boolean;
  continuationSessionId?: string;
  validationErrors?: string[];
};

export const analysisSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "jufexk.legacy_evidence.analysis",
  type: "object",
  required: ["schema_version", "target_image_id", "records", "context_rows", "carry_context"],
  additionalProperties: true,
} as const;

export const arbitrationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "jufexk.legacy_evidence.arbitration",
  type: "object",
  required: ["schema_version", "target_image_id", "status", "field_decisions", "records", "context_rows", "carry_context"],
  properties: { status: { enum: ["agreed", "arbitrated", "unresolved"] } },
  additionalProperties: true,
} as const;

export type RunnerResult = { sessionId: string; raw: string; json: unknown; exitCode?: number };
export type Runner = (request: RunnerRequest) => Promise<RunnerResult>;

export type BatchCommandOptions = {
  mode: "pilot" | "full";
  sourceDir?: string;
  batchDir?: string;
  manifestPath?: string;
  outDir: string;
  approvalPath?: string;
  runner?: Runner;
  maxConcurrentJobs?: number;
  maxJobs?: number;
  pilotJobIds?: string[];
  now?: () => string;
  env?: Record<string, string | undefined>;
};

export type BatchCommandResult = {
  status: number;
  message: string;
  processedJobs: string[];
  callTimestamps: number[];
};

type AuditEvent = {
  attempt: number;
  repair: boolean;
  session_id?: string;
  exit_code?: number;
  validation_errors?: string[];
  transient_error?: string;
  raw_response?: string;
};

type Diff = {
  schema_version: string;
  target_image_id: string;
  differences: Array<{ type: string; record_id: string; field?: string; analysis_a?: unknown; analysis_b?: unknown; char_diff?: string }>;
  row_alignment: Array<{ type: string; analysis_a_index?: number; analysis_b_index?: number; reason: string }>;
};

export async function buildManifest(options: { sourceDir: string; batchDir: string; expectedCount?: number; now?: () => string }) {
  const expectedCount = options.expectedCount ?? MANIFEST_IMAGE_COUNT;
  const sourceDir = resolveSafeInputDir(options.sourceDir);
  const batchDir = resolve(options.batchDir);
  await mkdir(batchDir, { recursive: true });
  const entries: Array<Omit<ManifestImage, "previous_image_id" | "next_image_id">> = [];

  const classifiedDirectories = new Set<string>();
  for (const worksheet of WORKSHEETS) {
    const available: string[] = [];
    for (const name of WORKSHEET_DIRECTORIES[worksheet]) if (await exists(join(sourceDir, name))) available.push(name);
    if (available.length > 1) throw new Error(`duplicate worksheet directories for ${worksheet}: ${available.join(", ")}`);
    if (!available.length) continue;
    classifiedDirectories.add(available[0]);
    const worksheetDir = join(sourceDir, available[0]);
    for (const file of await readdir(worksheetDir)) {
      const src = join(worksheetDir, file);
      const info = await stat(src);
      if (!info.isFile()) continue;
      const screenshot_time = parseScreenshotTime(file);
      const destDir = join(batchDir, "input", worksheet);
      const dest = join(destDir, file);
      await mkdir(destDir, { recursive: true });
      await writeFile(dest, await readFile(src));
      entries.push({
        id: `${worksheet}__${file}`,
        worksheet,
        filename: file,
        screenshot_time,
        target_path: dest,
        sha256: await sha256File(dest),
      });
    }
  }

  for (const item of await readdir(sourceDir, { withFileTypes: true })) {
    if (item.isDirectory() && !classifiedDirectories.has(item.name)) {
      const files = await readdir(join(sourceDir, item.name));
      if (files.some((file) => /^QQ\d{8}-\d{6}\.png$/i.test(file))) throw new Error(`unclassified worksheet: ${item.name}`);
    }
    if (item.isFile() && /^QQ\d{8}-\d{6}\.png$/i.test(item.name)) {
      throw new Error(`unclassified worksheet for image: ${item.name}`);
    }
  }

  if (entries.length !== expectedCount) throw new Error(`expected ${expectedCount} images, found ${entries.length}`);
  const hashOwners = new Map<string, string>();
  for (const entry of entries) {
    const owner = hashOwners.get(entry.sha256);
    if (owner) throw new Error(`duplicate image content: ${owner} and ${entry.id}`);
    hashOwners.set(entry.sha256, entry.id);
  }
  const seen = new Set<string>();
  const images: ManifestImage[] = [];
  for (const worksheet of WORKSHEETS) {
    const group = entries.filter((image) => image.worksheet === worksheet).sort((a, b) => a.screenshot_time.localeCompare(b.screenshot_time));
    if (group.length === 0) throw new Error(`missing worksheet: ${worksheet}`);
    for (let index = 0; index < group.length; index += 1) {
      const key = `${worksheet}:${group[index].screenshot_time}`;
      if (seen.has(key)) throw new Error(`duplicate screenshot timestamp: ${key}`);
      seen.add(key);
      images.push({
        ...group[index],
        previous_image_id: index === 0 ? null : group[index - 1].id,
        next_image_id: index === group.length - 1 ? null : group[index + 1].id,
      });
    }
  }

  const manifestWithoutHash = {
    created_at: options.now?.() ?? new Date().toISOString(),
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    models: { analysis_a: ANALYSIS_A_MODEL, analysis_b: ANALYSIS_B_MODEL, arbitration: ARBITRATION_MODEL },
    images,
  };
  const manifest_hash = hashJson(manifestHashPayload({ prompt_version: manifestWithoutHash.prompt_version, schema_version: manifestWithoutHash.schema_version, models: manifestWithoutHash.models, images }));
  const manifest: Manifest = { manifest_path: join(batchDir, "manifest.json"), manifest_hash, ...manifestWithoutHash };
  await writeJson(manifest.manifest_path, manifest);
  return manifest;
}

export function buildApproval(options: { manifestHash: string; approvedAt: string }) {
  return {
    approved_at: options.approvedAt,
    manifest_hash: options.manifestHash,
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
  };
}

export async function runBatchCommand(options: BatchCommandOptions): Promise<BatchCommandResult> {
  try {
    const manifest = options.manifestPath
      ? await readJson<Manifest>(options.manifestPath)
      : await buildManifest({ sourceDir: required(options.sourceDir, "sourceDir"), batchDir: required(options.batchDir, "batchDir"), now: options.now });
    await verifyManifest(manifest);
    const outDir = resolve(options.outDir);
    await mkdir(outDir, { recursive: true });
    if (options.mode === "full") {
      const approvalError = await validateApproval(manifest, options.approvalPath);
      if (approvalError) return { status: 2, message: approvalError, processedJobs: [], callTimestamps: [] };
    }

    const runner = options.runner ?? codexWorkflowRunner;
    const clock = new RateClock(options.now);
    const jobs = selectJobs(manifest, options.mode, options.maxJobs, options.pilotJobIds);
    const processedJobs = await processJobs({ jobs, manifest, outDir, runner, clock, env: options.env ?? {}, maxConcurrentJobs: options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS, mode: options.mode, stageCooldownMs: 0 });
    await writeSummaries(outDir, manifest, options.mode);
    const failedJobs: string[] = [];
    for (const job of jobs) if ((await readState(join(outDir, "jobs", job.id))).status === "failed") failedJobs.push(job.id);
    if (failedJobs.length) return { status: 1, message: `${options.mode} failed for ${failedJobs.join(", ")}`, processedJobs, callTimestamps: clock.timestamps };
    return { status: 0, message: `${options.mode} completed`, processedJobs, callTimestamps: clock.timestamps };
  } catch (error) {
    return { status: 1, message: errorMessage(error), processedJobs: [], callTimestamps: [] };
  }
}

export async function cleanupRunDirectory(options: { runDir: string; allowedRoot: string; token: string }) {
  const runDir = resolve(options.runDir);
  const allowedRoot = resolve(options.allowedRoot);
  const rel = relative(allowedRoot, runDir);
  if (!options.token.startsWith("legacy-evidence-test-") || rel.startsWith("..") || isAbsolute(rel) || basename(runDir) !== options.token) {
    throw new Error("refusing to clean unvalidated legacy evidence run directory");
  }
  await rm(runDir, { recursive: true, force: true });
}

async function processJobs(options: { jobs: ManifestImage[]; manifest: Manifest; outDir: string; runner: Runner; clock: RateClock; env: Record<string, string | undefined>; maxConcurrentJobs: number; mode: "pilot" | "full"; stageCooldownMs: number }) {
  if (options.mode === "pilot") {
    const processed: string[] = [];
    for (const job of options.jobs) {
      const ok = await processJob({ ...options, job });
      processed.push(job.id);
      if (!ok) break;
    }
    return processed;
  }

  const queues = new Map<Worksheet, ManifestImage[]>();
  for (const worksheet of WORKSHEETS) queues.set(worksheet, []);
  for (const job of options.jobs) queues.get(job.worksheet)?.push(job);
  const processed: string[] = [];
  const active = new Set<Promise<void>>();
  const activeWorksheets = new Set<Worksheet>();
  const blockedWorksheets = new Set<Worksheet>();
  const startNext = () => {
    for (const worksheet of WORKSHEETS) {
      if (active.size >= Math.max(1, options.maxConcurrentJobs)) return;
      if (activeWorksheets.has(worksheet) || blockedWorksheets.has(worksheet)) continue;
      const queue = queues.get(worksheet);
      if (!queue?.length) continue;
      const job = queue.shift()!;
      const promise = processJob({ ...options, job }).then((ok) => {
        processed.push(job.id);
        activeWorksheets.delete(worksheet);
        if (!ok) blockedWorksheets.add(worksheet);
        active.delete(promise);
      }).catch(() => {
        processed.push(job.id);
        activeWorksheets.delete(worksheet);
        blockedWorksheets.add(worksheet);
        active.delete(promise);
      });
      activeWorksheets.add(worksheet);
      active.add(promise);
    }
  };
  startNext();
  while (active.size) {
    await Promise.race(active);
    startNext();
  }
  return processed;
}

async function processJob(options: { job: ManifestImage; manifest: Manifest; outDir: string; runner: Runner; clock: RateClock; env: Record<string, string | undefined>; stageCooldownMs: number }) {
  const { job, manifest, outDir, runner, clock, env } = options;
  const jobDir = join(outDir, "jobs", job.id);
  await mkdir(jobDir, { recursive: true });
  const state = await readState(jobDir);
  const cacheBase = cacheBaseFor(job, manifest);
  try {
    await writeState(jobDir, { status: "analyzing_a", cache_base: cacheBase });
    const analysisA = await runStage({ stage: "analysis_a", model: ANALYSIS_A_MODEL, job, manifest, outDir, jobDir, runner, clock, env, cacheKey: `${cacheBase}:analysis_a:${ANALYSIS_A_MODEL}`, cached: state.stages?.analysis_a });
    await writeState(jobDir, { status: "analyzing_b", cache_base: cacheBase, stages: { analysis_a: analysisA.cacheKey } });
    if (options.stageCooldownMs) await new Promise((resolvePromise) => setTimeout(resolvePromise, options.stageCooldownMs));
    const analysisB = await runStage({ stage: "analysis_b", model: ANALYSIS_B_MODEL, job, manifest, outDir, jobDir, runner, clock, env, cacheKey: `${cacheBase}:analysis_b:${ANALYSIS_B_MODEL}`, cached: state.stages?.analysis_b });
    const diff = buildDiff(job.id, analysisA.json, analysisB.json);
    await writeJson(join(jobDir, "diff.json"), diff);
    await writeFile(join(jobDir, "diff.md"), renderDiffMarkdown(diff));
    await writeState(jobDir, { status: "diff_ready", cache_base: cacheBase, stages: { analysis_a: analysisA.cacheKey, analysis_b: analysisB.cacheKey } });
    if (options.stageCooldownMs) await new Promise((resolvePromise) => setTimeout(resolvePromise, options.stageCooldownMs));
    const arbitration = await runStage({ stage: "arbitration", model: ARBITRATION_MODEL, job, manifest, outDir, jobDir, runner, clock, env, cacheKey: `${cacheBase}:arbitration:${ARBITRATION_MODEL}:${hashJson(diff)}`, cached: state.stages?.arbitration, diff });
    const carry = (arbitration.json as any).carry_context ?? { course: { value: null, status: "unresolved" }, teacher: { value: null, status: "unresolved" } };
    await enforceInheritedRisk(job, outDir, carry);
    await writeJson(join(jobDir, "carry_context.json"), preserveRisk(carry));
    await writeState(jobDir, { status: "completed", cache_base: cacheBase, stages: { analysis_a: analysisA.cacheKey, analysis_b: analysisB.cacheKey, arbitration: arbitration.cacheKey } });
    return true;
  } catch (error) {
    await writeJson(join(jobDir, "failure.json"), { error: errorMessage(error), failed_at: new Date().toISOString() });
    await writeState(jobDir, { status: "failed", cache_base: cacheBase, error: errorMessage(error) });
    return false;
  }
}

async function runStage(options: { stage: Stage; model: string; job: ManifestImage; manifest: Manifest; outDir: string; jobDir: string; runner: Runner; clock: RateClock; env: Record<string, string | undefined>; cacheKey: string; cached?: string; diff?: Diff }) {
  const artifact = join(options.jobDir, `${options.stage}.json`);
  if (options.cached === options.cacheKey && (await exists(artifact))) return { cacheKey: options.cacheKey, json: await readJson(artifact) };
  const audit: AuditEvent[] = [];
  let transientAttempts = 0;
  let formatRepairUsed = false;
  let repairSessionId: string | undefined;
  let repairErrors: string[] | undefined;
  for (let attempt = 0; ; attempt += 1) {
    await options.clock.take();
    try {
      const fullPrompt = promptFor(options.stage, options.job, options.diff, formatRepairUsed, repairErrors);
      const attachedFiles = await filesFor(options.job, options.manifest, options.outDir, options.stage);
      let commandPrompt = fullPrompt;
      if (options.stage !== "arbitration") {
        const carryPath = attachedFiles.find((file) => basename(file) === "carry_context.json");
        if (carryPath) commandPrompt += `\nPrior validated carry_context.json: ${await readFile(carryPath, "utf8")}`;
      }
      if (!formatRepairUsed) {
        const promptPath = join(options.jobDir, `${options.stage}.prompt.txt`);
        await writeFile(promptPath, fullPrompt);
      }
      const result = await options.runner({
        stage: options.stage,
        model: options.model,
        job: options.job,
        manifest: options.manifest,
        jobDir: options.jobDir,
        prompt: commandPrompt,
        files: attachedFiles,
        attempt,
        repair: formatRepairUsed,
        continuationSessionId: repairSessionId,
        validationErrors: repairErrors,
      });
      const validation = validateStageOutput(options.stage, result.json, options.job.id);
      audit.push({ attempt, repair: formatRepairUsed, session_id: result.sessionId, exit_code: result.exitCode ?? 0, validation_errors: validation, raw_response: redact(result.raw, options.env) });
      await writeJson(join(options.jobDir, `${options.stage}.audit.json`), audit);
      if (validation.length === 0) {
        await writeJson(artifact, result.json);
        await writeJson(join(options.jobDir, `${options.stage}.meta.json`), { model: options.model, cache_key: options.cacheKey, session_id: result.sessionId });
        return { cacheKey: options.cacheKey, json: result.json };
      }
      if (!formatRepairUsed) {
        formatRepairUsed = true;
        repairSessionId = result.sessionId;
        repairErrors = validation;
        continue;
      }
      throw new Error(`${options.stage} schema validation failed: ${validation.join("; ")}`);
    } catch (error) {
      if (isTransient(error) && transientAttempts < 2) {
        transientAttempts += 1;
        audit.push({ attempt, repair: formatRepairUsed, transient_error: errorMessage(error) });
        await writeJson(join(options.jobDir, `${options.stage}.audit.json`), audit);
        if (!options.clock.isVirtual) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000 * 2 ** (transientAttempts - 1)));
        continue;
      }
      throw error;
    }
  }
}

async function codexWorkflowRunner(request: RunnerRequest): Promise<RunnerResult> {
  const envelopePath = join(request.jobDir, "codex_orchestration.json");
  if (!(await exists(envelopePath))) {
    if (request.stage !== "analysis_a") throw new Error("codex orchestration envelope is missing");
    const imageFiles = request.files.filter((file) => /\.png$/i.test(file));
    if (!imageFiles.length) throw new Error("codex orchestration has no image evidence");
    const promptPath = join(request.jobDir, "codex_orchestrator.prompt.txt");
    const outputPath = join(request.jobDir, "codex_orchestrator.response.json");
    let combined = "";
    if (!(await exists(outputPath))) {
      const runtime = await prepareCodexRuntime();
      await writeFile(promptPath, buildCodexOrchestratorPrompt(request.job, imageFiles));
      const args = [
        "exec", "--enable", "multi_agent", "--enable", "multi_agent_v2",
        "-c", 'agents.default_subagent_model="gpt-5.6-luna"',
        "-c", 'agents.default_subagent_reasoning_effort="low"',
        "-C", runtime.workDir, "-m", ARBITRATION_MODEL, "-s", "read-only", "--color", "never",
        ...imageFiles.flatMap((file) => ["-i", resolve(file)]), "-o", outputPath, "-",
      ];
      combined = (await runCodexProcess(args, runtime.homeDir, promptPath, request.jobDir)).combined;
    }
    const envelope = JSON.parse(await readFile(outputPath, "utf8"));
    if (envelope?.image_quality?.status === "recapture_required") await writeJson(join(request.jobDir, "image_quality.json"), envelope.image_quality);
    const errors = validateCodexOrchestrationOutput(envelope, request.job.id);
    if (errors.length) throw new Error(errors.join("; "));
    await writeJson(envelopePath, envelope);
    if (combined) await writeFile(join(request.jobDir, "codex_orchestrator.raw.log"), redact(combined, process.env));
  }
  const envelope = await readJson<any>(envelopePath);
  const json = envelope[request.stage];
  return { sessionId: envelope.session_id ?? `codex-${request.job.sha256.slice(0, 16)}`, raw: JSON.stringify(json), json, exitCode: 0 };
}

export function buildCodexOrchestratorPrompt(job: Pick<ManifestImage, "id" | "previous_image_id" | "next_image_id">, imageFiles: string[]) {
  const roles = imageFiles.map((file, index) => {
    const filename = basename(file);
    const targetFilename = job.id.split("__").at(-1);
    const previousFilename = job.previous_image_id?.split("__").at(-1);
    const nextFilename = job.next_image_id?.split("__").at(-1);
    const role = filename === targetFilename ? "TARGET" : filename === previousFilename ? "PREVIOUS" : filename === nextFilename ? "NEXT" : "EVIDENCE";
    return `${index + 1}. ${role}: ${resolve(file)}`;
  }).join("\n");
  return `You are the Sol orchestrator for one visual transcription job. Use only the listed image files and this task. Do not inspect any repository files or external documentation.

Job: ${job.id}
Images:
${roles}

First assess whether every nonempty table cell can be read reliably at the supplied resolution. If not, do not transcribe. Return image_quality.status=recapture_required with affected image filenames, concrete issues, and actionable recapture instructions including zoom, crop boundaries, overlap, and filename ordering.

If usable, spawn exactly two independent visual-analysis subagents. For both calls set agent_type="default" and fork_turns="none". Give each a self-contained task with the exact image paths, image roles, extraction contract, and output shape. They may open only the listed images. They must not see each other's result. Wait until both reach completed status; never fabricate a subagent result.

Each nonempty student-evaluation cell is one record. Do not merge adjacent cells or teacher rows. Preserve literal raw text, use [unclear] rather than guessing, keep corrections separate with explicit edits, use normalized TARGET bbox, emit only cells starting in TARGET, retain context-only rows separately, and never invent catalog IDs. A clipped first/last cell must carry missing_prefix/missing_suffix and unresolved status.

After both complete, align by bbox and row order, preserve both analyses in the envelope, deterministically describe disagreements, and arbitrate without hiding uncertainty. Return JSON only:
{
  "session_id":"string",
  "image_quality":{"status":"usable|recapture_required","affected_images":["filename"],"issues":["string"],"recapture_instructions":["string"]},
  "subagents":{"analysis_a":{"task_id":"string","status":"completed|failed"},"analysis_b":{"task_id":"string","status":"completed|failed"}},
  "analysis_a":<legacy-evidence-schema-v1 analysis object>,
  "analysis_b":<legacy-evidence-schema-v1 analysis object>,
  "arbitration":<legacy-evidence-schema-v1 arbitration object>
}
All three objects use target_image_id=${JSON.stringify(job.id)}. Analysis objects require records, context_rows, carry_context. Arbitration additionally requires status=agreed|arbitrated|unresolved and field_decisions. Output no prose or Markdown.`;
}

export function validateCodexOrchestrationOutput(value: any, imageId: string) {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["codex orchestration output must be an object"];
  const quality = value.image_quality;
  if (!quality || !["usable", "recapture_required"].includes(quality.status)) errors.push("image_quality status is invalid");
  if (quality?.status === "recapture_required") {
    const images = Array.isArray(quality.affected_images) ? quality.affected_images.join(", ") : imageId;
    const issues = Array.isArray(quality.issues) ? quality.issues.join(", ") : "unspecified image quality issue";
    const instructions = Array.isArray(quality.recapture_instructions) ? quality.recapture_instructions.join(", ") : "provide a readable recapture";
    errors.push(`image recapture required: ${images}: ${issues}; ${instructions}`);
    return errors;
  }
  for (const stage of ["analysis_a", "analysis_b"] as const) {
    if (value.subagents?.[stage]?.status !== "completed") errors.push(`${stage} subagent did not complete`);
    if (typeof value.subagents?.[stage]?.task_id !== "string" || !value.subagents[stage].task_id) errors.push(`${stage} task_id is required`);
    errors.push(...validateStageOutput(stage, value[stage], imageId).map((error) => `${stage}: ${error}`));
  }
  errors.push(...validateStageOutput("arbitration", value.arbitration, imageId).map((error) => `arbitration: ${error}`));
  return errors;
}

async function prepareCodexRuntime() {
  const root = resolve(tmpdir(), "jufexk-codex-image-runtime");
  const homeDir = join(root, "home");
  const workDir = join(root, "work");
  await mkdir(homeDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  const sourceHome = process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : resolve(process.env.USERPROFILE ?? "", ".codex");
  for (const name of ["auth.json", "config.toml"]) {
    const destination = join(homeDir, name);
    if (!(await exists(destination))) await link(join(sourceHome, name), destination);
  }
  return { homeDir, workDir };
}

async function runCodexProcess(args: string[], codexHome: string, promptPath: string, jobDir: string) {
  const prompt = await readFile(promptPath);
  return new Promise<{ combined: string }>((resolvePromise, reject) => {
    const child = spawn(resolveCodexExecutable(), args, { cwd: dirname(codexHome), env: { ...process.env, CODEX_HOME: codexHome }, shell: process.platform === "win32" });
    let combined = "";
    child.stdout.on("data", (chunk) => (combined += String(chunk)));
    child.stderr.on("data", (chunk) => {
      combined += String(chunk);
      void appendFile(join(jobDir, "codex_orchestrator.stderr.log"), redact(String(chunk), process.env));
    });
    child.on("error", reject);
    child.stdin.end(prompt);
    child.on("close", (code) => code === 0
      ? resolvePromise({ combined })
      : reject(Object.assign(new Error(`codex exec exited ${code}: ${combined.slice(-1000)}`), { transient: /rate|limit|timeout|network/i.test(combined) })));
  });
}

function resolveCodexExecutable() {
  if (process.platform === "win32" && process.env.SCOOP) return join(process.env.SCOOP, "apps", "nodejs-lts", "current", "bin", "codex.cmd");
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function promptFor(stage: Stage, job: ManifestImage, diff?: Diff, repair = false, validationErrors: string[] = []) {
  if (repair) {
    return `Your previous response failed JSON Schema validation for ${job.id}: ${validationErrors.join("; ")}. Return JSON only, fixing format/schema issues only. Do not change any substantive extraction, evidence, coordinates, uncertainty, or arbitration decision.`;
  }
  if (stage === "arbitration") {
    return `Arbitrate attached A/B/diff for ${job.id}. Return contract ${SCHEMA_VERSION} JSON only. Preserve disagreements; no catalog IDs or approval.`;
  }
  return `Extract target-start reviews for ${job.id} from attached prev/target/next stack. Return ${SCHEMA_VERSION} JSON only. Preserve raw text; never guess or add catalog IDs.`;
}

async function filesFor(job: ManifestImage, manifest: Manifest, outDir: string, stage: Stage) {
  const byId = new Map(manifest.images.map((image) => [image.id, image]));
  const files = [job.previous_image_id, job.id, job.next_image_id]
    .filter((id): id is string => !!id)
    .map((id) => byId.get(id)?.target_path)
    .filter((path): path is string => !!path);
  if (stage !== "arbitration" && job.previous_image_id) {
    const carryPath = join(outDir, "jobs", job.previous_image_id, "carry_context.json");
    if (await exists(carryPath)) files.push(carryPath);
  }
  if (stage === "arbitration") {
    for (const name of ["analysis_a.json", "analysis_b.json", "diff.json"]) files.push(join(outDir, "jobs", job.id, name));
  }
  return files;
}

function buildDiff(imageId: string, a: any, b: any): Diff {
  const aRecords = Array.isArray(a.records) ? a.records : [];
  const bRecords = Array.isArray(b.records) ? b.records : [];
  const differences: Diff["differences"] = [];
  const row_alignment: Diff["row_alignment"] = [];
  const pairs = alignRecords(aRecords, bRecords);
  for (const pair of pairs) {
    if (pair.a == null || pair.b == null) {
      row_alignment.push({ type: "row_alignment", analysis_a_index: pair.a ?? undefined, analysis_b_index: pair.b ?? undefined, reason: "record count or boundary mismatch" });
      continue;
    }
    for (const field of ["course_name", "teacher_name", "body", "raw_transcription", "corrected_text"] as const) {
      const av = aRecords[pair.a][field] ?? "";
      const bv = bRecords[pair.b][field] ?? "";
      if (av !== bv) differences.push({ type: "field", record_id: stableRecordId(imageId, aRecords[pair.a], pair.a), field, analysis_a: av, analysis_b: bv, char_diff: charDiff(String(av), String(bv)) });
    }
  }
  return { schema_version: SCHEMA_VERSION, target_image_id: imageId, differences, row_alignment };
}

function alignRecords(a: any[], b: any[]) {
  const pairs: Array<{ a: number | null; b: number | null }> = [];
  const usedB = new Set<number>();
  const sortedA = a.map((record, index) => ({ index, y: Number(record.bbox?.y ?? index) })).sort((x, y) => x.y - y.y);
  const sortedB = b.map((record, index) => ({ index, y: Number(record.bbox?.y ?? index) })).sort((x, y) => x.y - y.y);
  for (const left of sortedA) {
    let best: { index: number; distance: number } | null = null;
    for (const right of sortedB) {
      if (usedB.has(right.index)) continue;
      const overlap = verticalOverlap(a[left.index].bbox, b[right.index].bbox);
      const distance = Math.abs(left.y - right.y);
      if (overlap > 0.2 || distance < 0.04) {
        if (!best || distance < best.distance) best = { index: right.index, distance };
      }
    }
    if (best) {
      usedB.add(best.index);
      pairs.push({ a: left.index, b: best.index });
    } else {
      pairs.push({ a: left.index, b: null });
    }
  }
  for (const right of sortedB) if (!usedB.has(right.index)) pairs.push({ a: null, b: right.index });
  return pairs;
}

function renderDiffMarkdown(diff: Diff) {
  const lines = ["# Character Diff", "", `Target image: ${diff.target_image_id}`, ""];
  if (diff.row_alignment.length) {
    lines.push("## Row Alignment", "");
    for (const item of diff.row_alignment) lines.push(`- ${item.reason}: A=${item.analysis_a_index ?? "-"} B=${item.analysis_b_index ?? "-"}`);
    lines.push("");
  }
  lines.push("## Field Differences", "");
  if (!diff.differences.length) lines.push("No field differences.");
  for (const item of diff.differences) lines.push(`- ${item.record_id} ${item.field}: ${item.char_diff}`);
  return `${lines.join("\n")}\n`;
}

async function writeSummaries(outDir: string, manifest: Manifest, mode: "pilot" | "full") {
  const jobsDir = join(outDir, "jobs");
  const jobs: any[] = [];
  if (await exists(jobsDir)) {
    for (const image of manifest.images) {
      const jobDir = join(jobsDir, image.id);
      if (!(await exists(jobDir))) continue;
      const state = await readState(jobDir);
      const diff = (await exists(join(jobDir, "diff.json"))) ? await readJson<Diff>(join(jobDir, "diff.json")) : { differences: [], row_alignment: [] };
      const arbitration = (await exists(join(jobDir, "arbitration.json"))) ? await readJson<any>(join(jobDir, "arbitration.json")) : null;
      jobs.push({
        job_id: image.id,
        worksheet: image.worksheet,
        status: state.status,
        records: Array.isArray(arbitration?.records) ? arbitration.records.length : 0,
        differences: diff.differences.length + diff.row_alignment.length,
        uncertainties: countUncertainties(arbitration),
        cross_page: countCrossPage(arbitration),
        arbitration_status: arbitration?.status ?? "",
        failure_reason: state.error ?? "",
        diff_json: `jobs/${image.id}/diff.json`,
        diff_md: `jobs/${image.id}/diff.md`,
        arbitration_json: `jobs/${image.id}/arbitration.json`,
      });
    }
  }
  jobs.sort((a, b) => riskRank(a) - riskRank(b) || a.worksheet.localeCompare(b.worksheet) || a.job_id.localeCompare(b.job_id));
  await writeJson(join(outDir, "summary.json"), { schema_version: SCHEMA_VERSION, mode, manifest_hash: manifest.manifest_hash, generated_at: new Date().toISOString(), jobs });
  const csvRows = ["job_id,worksheet,status,records,differences,uncertainties,cross_page,arbitration_status,failure_reason"];
  for (const job of jobs) csvRows.push([job.job_id, job.worksheet, job.status, job.records, job.differences, job.uncertainties, job.cross_page, job.arbitration_status, job.failure_reason].map(csvCell).join(","));
  await writeFile(join(outDir, "summary.csv"), `${csvRows.join("\n")}\n`);
  const md = ["# Legacy Evidence Summary", "", `Mode: ${mode}`, `Manifest: ${manifest.manifest_hash}`, "", "| Job | Worksheet | Status | Records | Differences |", "| --- | --- | --- | ---: | ---: |"];
  for (const job of jobs) md.push(`| [${job.job_id}](${job.diff_md}) | ${job.worksheet} | ${job.status}${job.arbitration_status ? `/${job.arbitration_status}` : ""} | ${job.records} | ${job.differences} |`);
  await writeFile(join(outDir, "summary.md"), `${md.join("\n")}\n`);
}

function validateStageOutput(stage: Stage, value: any, imageId: string) {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["output must be an object"];
  if (value.schema_version !== SCHEMA_VERSION) errors.push("schema_version mismatch");
  if (value.target_image_id !== imageId) errors.push("target_image_id mismatch");
  if (!Array.isArray(value.records)) errors.push("records must be an array");
  if (!Array.isArray(value.context_rows)) errors.push("context_rows must be an array");
  if (!value.carry_context || typeof value.carry_context !== "object") errors.push("carry_context is required");
  if (stage === "arbitration" && !["agreed", "arbitrated", "unresolved"].includes(value.status)) errors.push("arbitration status must be agreed, arbitrated or unresolved");
  for (const [index, record] of (Array.isArray(value.records) ? value.records : []).entries()) {
    for (const field of ["raw_transcription", "corrected_text", "course_name", "teacher_name", "body", "mapping_status"]) {
      if (typeof record[field] !== "string") errors.push(`records[${index}].${field} must be a string`);
    }
    if (record.mapping_status !== "pending_mapping") errors.push(`records[${index}].mapping_status must be pending_mapping`);
    if ("course_id" in record || "teacher_id" in record || "offering_id" in record) errors.push(`records[${index}] must not contain catalog IDs`);
    if (!Array.isArray(record.edits)) errors.push(`records[${index}].edits must be an array`);
    for (const [editIndex, edit] of (Array.isArray(record.edits) ? record.edits : []).entries()) for (const field of ["original", "corrected", "reason"]) if (typeof edit?.[field] !== "string") errors.push(`records[${index}].edits[${editIndex}].${field} must be a string`);
    if (!record.confidence || ["course_name", "teacher_name", "body"].some((field) => typeof record.confidence[field] !== "number" || record.confidence[field] < 0 || record.confidence[field] > 1)) errors.push(`records[${index}].confidence must contain normalized field confidence`);
    if (!Array.isArray(record.uncertainty_markers)) errors.push(`records[${index}].uncertainty_markers must be an array`);
    if (!validBbox(record.bbox)) errors.push(`records[${index}].bbox must be normalized`);
    if (!record.evidence || record.evidence.target_image !== imageId || record.evidence.row_start_image !== imageId || !Array.isArray(record.evidence.adjacent_images) || !Array.isArray(record.evidence.flags)) errors.push(`records[${index}].evidence is invalid`);
  }
  for (const [index, row] of (Array.isArray(value.context_rows) ? value.context_rows : []).entries()) if (!validBbox(row.bbox) || typeof row.raw_transcription !== "string") errors.push(`context_rows[${index}] is invalid`);
  for (const field of ["course", "teacher"]) if (!value.carry_context?.[field] || !["agreed", "arbitrated", "unresolved"].includes(value.carry_context[field].status) || typeof value.carry_context[field].evidence_image !== "string") errors.push(`carry_context.${field} is invalid`);
  if (stage === "arbitration" && !Array.isArray(value.field_decisions)) errors.push("field_decisions must be an array");
  return errors;
}

function selectJobs(manifest: Manifest, mode: "pilot" | "full", maxJobs?: number, pilotJobIds?: string[]) {
  const images = mode === "pilot" ? pilotJobs(manifest, pilotJobIds) : manifest.images;
  return typeof maxJobs === "number" ? images.slice(0, maxJobs) : images;
}

function pilotJobs(manifest: Manifest, requested?: string[]) {
  if (requested) {
    if (requested.length !== 3 || new Set(requested).size !== 3) throw new Error("pilot requires exactly three distinct representative job IDs");
    const byId = new Map(manifest.images.map((image) => [image.id, image]));
    return requested.map((id) => {
      const image = byId.get(id);
      if (!image) throw new Error(`unknown pilot job ID: ${id}`);
      return image;
    });
  }
  const firstMajor = manifest.images.find((image) => image.worksheet === "主要课程");
  const crossPage = manifest.images.find((image) => image.previous_image_id && image.next_image_id);
  const normal = manifest.images.find((image) => image.worksheet !== firstMajor?.worksheet && image.previous_image_id && image.next_image_id);
  const selected = uniqueImages([firstMajor, crossPage, normal].filter((image): image is ManifestImage => !!image)).slice(0, 3);
  if (selected.length !== 3) throw new Error("manifest does not contain three distinct representative pilot jobs");
  return selected;
}

function uniqueImages(images: ManifestImage[]) {
  const seen = new Set<string>();
  return images.filter((image) => (seen.has(image.id) ? false : (seen.add(image.id), true)));
}

async function validateApproval(manifest: Manifest, approvalPath?: string) {
  if (!approvalPath) return "full run requires approval file bound to manifest, prompt and schema";
  const approval = await readJson<any>(approvalPath).catch(() => null);
  if (!approval) return "full run approval file is unreadable";
  if (approval.manifest_hash !== manifest.manifest_hash || approval.prompt_version !== PROMPT_VERSION || approval.schema_version !== SCHEMA_VERSION) {
    return "full run approval is stale for current manifest, prompt or schema";
  }
  if (typeof approval.approved_at !== "string" || Number.isNaN(Date.parse(approval.approved_at))) return "full run approval has invalid approved_at";
  return "";
}

async function verifyManifest(manifest: Manifest) {
  if (manifest.prompt_version !== PROMPT_VERSION) throw new Error("manifest prompt_version mismatch");
  if (manifest.schema_version !== SCHEMA_VERSION) throw new Error("manifest schema_version mismatch");
  if (manifest.models.analysis_a !== ANALYSIS_A_MODEL || manifest.models.analysis_b !== ANALYSIS_B_MODEL || manifest.models.arbitration !== ARBITRATION_MODEL) {
    throw new Error("manifest model binding mismatch");
  }
  if (manifest.images.length !== MANIFEST_IMAGE_COUNT) throw new Error(`manifest expected ${MANIFEST_IMAGE_COUNT} images, found ${manifest.images.length}`);
  const expectedHash = hashJson(manifestHashPayload(manifest));
  if (manifest.manifest_hash !== expectedHash) throw new Error("manifest hash mismatch");
  const byWorksheet = new Map<Worksheet, ManifestImage[]>();
  for (const worksheet of WORKSHEETS) byWorksheet.set(worksheet, []);
  const ids = new Set<string>();
  const hashes = new Map<string, string>();
  for (const image of manifest.images) {
    if (!WORKSHEETS.includes(image.worksheet)) throw new Error(`unclassified worksheet: ${image.worksheet}`);
    if (ids.has(image.id)) throw new Error(`duplicate image id: ${image.id}`);
    ids.add(image.id);
    if ((await sha256File(image.target_path)) !== image.sha256) throw new Error(`hash mismatch for ${image.id}`);
    const owner = hashes.get(image.sha256);
    if (owner) throw new Error(`duplicate image content: ${owner} and ${image.id}`);
    hashes.set(image.sha256, image.id);
    byWorksheet.get(image.worksheet)?.push(image);
  }
  for (const worksheet of WORKSHEETS) {
    const images = byWorksheet.get(worksheet) ?? [];
    if (!images.length) throw new Error(`missing worksheet: ${worksheet}`);
    for (let index = 0; index < images.length; index += 1) {
      const expectedPrevious = index === 0 ? null : images[index - 1].id;
      const expectedNext = index === images.length - 1 ? null : images[index + 1].id;
      if (images[index].previous_image_id !== expectedPrevious || images[index].next_image_id !== expectedNext) throw new Error(`adjacency mismatch for ${images[index].id}`);
    }
  }
}

function parseScreenshotTime(file: string) {
  const match = /^QQ(\d{8})-(\d{6})\.png$/i.exec(file);
  if (!match) throw new Error(`invalid screenshot filename: ${file}`);
  const date = match[1];
  const time = match[2];
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const second = Number(time.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) throw new Error(`invalid screenshot timestamp: ${file}`);
  return `${date}T${time}`;
}

function manifestHashPayload(manifest: Pick<Manifest, "prompt_version" | "schema_version" | "models" | "images">) {
  return {
    prompt_version: manifest.prompt_version,
    schema_version: manifest.schema_version,
    models: manifest.models,
    images: manifest.images.map(({ target_path, ...image }) => image),
  };
}

function resolveSafeInputDir(input: string) {
  const resolved = resolve(input);
  const sourceFromWorkspace = relative(resolve("."), resolved);
  if (sourceFromWorkspace === "" || (!sourceFromWorkspace.startsWith("..") && !isAbsolute(sourceFromWorkspace))) throw new Error("source directory must be outside the repository workspace");
  return resolved;
}

async function enforceInheritedRisk(job: ManifestImage, outDir: string, carry: any) {
  if (!job.previous_image_id) return;
  const previousPath = join(outDir, "jobs", job.previous_image_id, "carry_context.json");
  if (!(await exists(previousPath))) return;
  const previous = await readJson<any>(previousPath);
  for (const field of ["course", "teacher"]) {
    const prior = previous?.[field];
    const next = carry?.[field];
    if ((prior?.status === "arbitrated" || prior?.status === "unresolved" || prior?.inherited_risk) && next?.status === "agreed" && prior?.value === next?.value) {
      throw new Error(`carry_context.${field} inherited risk cannot be promoted to agreed`);
    }
  }
}

class RateClock {
  timestamps: number[] = [];
  private virtualNow = 0;
  private gate: Promise<void> = Promise.resolve();
  constructor(private readonly now?: () => string) {}
  get isVirtual() { return !!this.now; }
  async take() {
    const turn = this.gate.then(() => this.takeLocked());
    this.gate = turn.catch(() => undefined);
    await turn;
  }
  private async takeLocked() {
    let current = this.now ? Date.parse(this.now()) : Date.now();
    if (!Number.isFinite(current)) current = Date.now();
    current = Math.max(current, this.virtualNow);
    const twentiethBack = this.timestamps.at(-GLOBAL_RPM);
    if (twentiethBack != null && current - twentiethBack < 60_000) {
      const waitMs = twentiethBack + 60_000 - current;
      if (!this.now) await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
      current += waitMs;
    }
    this.virtualNow = current;
    this.timestamps.push(current);
  }
}

async function readState(jobDir: string): Promise<{ status?: JobStatus; cache_base?: string; stages?: Record<Stage, string>; error?: string }> {
  const path = join(jobDir, "state.json");
  return (await exists(path)) ? readJson(path) : { status: "pending", stages: {} as Record<Stage, string> };
}

async function writeState(jobDir: string, state: unknown) {
  await writeJson(join(jobDir, "state.json"), state);
}

function cacheBaseFor(job: ManifestImage, manifest: Manifest) {
  const byId = new Map(manifest.images.map((image) => [image.id, image]));
  const hashes = [job.previous_image_id, job.id, job.next_image_id].filter((id): id is string => !!id).map((id) => byId.get(id)?.sha256 ?? "missing");
  return hashJson({ job_id: job.id, hashes, prompt: PROMPT_VERSION, schema: SCHEMA_VERSION });
}

function preserveRisk(carry: any) {
  for (const key of ["course", "teacher"]) {
    if (carry?.[key]?.status === "arbitrated" || carry?.[key]?.status === "unresolved") carry[key].inherited_risk = true;
  }
  return carry;
}

function countUncertainties(arbitration: any) {
  return (arbitration?.records ?? []).reduce((total: number, record: any) => total + (Array.isArray(record.uncertainty_markers) ? record.uncertainty_markers.length : 0), 0);
}

function countCrossPage(arbitration: any) {
  return (arbitration?.records ?? []).filter((record: any) => record?.evidence?.flags?.some((flag: string) => /prefix|suffix|continu/.test(flag))).length;
}

function riskRank(job: any) {
  if (job.status === "failed") return 0;
  if (job.arbitration_status === "unresolved") return 1;
  if (job.arbitration_status === "arbitrated") return 2;
  return 3;
}

function validBbox(bbox: any) {
  return bbox && ["x", "y", "width", "height"].every((key) => typeof bbox[key] === "number" && bbox[key] >= 0 && bbox[key] <= 1) && bbox.width > 0 && bbox.height > 0 && bbox.x + bbox.width <= 1.000001 && bbox.y + bbox.height <= 1.000001;
}

function verticalOverlap(a: any, b: any) {
  if (!validBbox(a) || !validBbox(b)) return 0;
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, bottom - top) / Math.max(a.height, b.height);
}

function stableRecordId(imageId: string, record: any, index: number) {
  return `${imageId}#${createHash("sha256").update(JSON.stringify({ y: record?.bbox?.y ?? index, raw: record?.raw_transcription ?? "" })).digest("hex").slice(0, 12)}`;
}

function charDiff(a: string, b: string) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let aEnd = a.length - 1;
  let bEnd = b.length - 1;
  while (aEnd >= start && bEnd >= start && a[aEnd] === b[bEnd]) {
    aEnd -= 1;
    bEnd -= 1;
  }
  return `${a.slice(0, start)}[-${a.slice(start, aEnd + 1)}-]{+${b.slice(start, bEnd + 1)}+}${a.slice(aEnd + 1)}`;
}

export function extractJson(stdout: string) {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "text" && typeof event?.part?.text === "string") return JSON.parse(event.part.text);
      if (event?.type === "message" && typeof event.message === "string") return JSON.parse(event.message);
      if (event?.message && typeof event.message === "object") return event.message;
      if (event?.schema_version) return event;
    } catch {}
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("response did not contain valid JSON");
  }
}

function extractSessionId(stdout: string) {
  const match = /"session(?:ID|Id|_id)"\s*:\s*"([^"]+)"/.exec(stdout);
  return match?.[1];
}

function redact(value: string, env: Record<string, string | undefined>) {
  let result = value;
  for (const [key, secret] of Object.entries(env)) {
    if (!secret || !/(key|token|secret|password)/i.test(key)) continue;
    result = result.split(secret).join("[REDACTED]");
  }
  result = result.replace(/(api[_-]?key|token|secret|password)["'=:\s]+[^"'\s,}]+/gi, "$1=[REDACTED]");
  return result;
}

function isTransient(error: unknown) {
  return !!(error && typeof error === "object" && "transient" in error && (error as any).transient) || /rate|limit|concurrency|timeout|network|ECONNRESET|ETIMEDOUT/i.test(errorMessage(error));
}

async function sha256File(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function hashJson(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readJson<T = any>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function required<T>(value: T | undefined, name: string): T {
  if (value == null) throw new Error(`${name} is required`);
  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
