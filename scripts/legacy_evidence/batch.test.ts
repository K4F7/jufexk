import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_A_MODEL,
  ANALYSIS_B_MODEL,
  ARBITRATION_MODEL,
  MANIFEST_IMAGE_COUNT,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  buildApproval,
  buildManifest,
  cleanupRunDirectory,
  buildCodexOrchestratorPrompt,
  validateCodexOrchestrationOutput,
  extractJson,
  runBatchCommand,
} from "./index";

const worksheetNames = [
  "主要课程",
  "数学课",
  "英语",
  "思政课",
  "外教",
  "MOOC",
  "体育课",
  "美育",
] as const;

async function createFixtureImages(root: string) {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  const names: string[] = [];
  let minute = 1;
  for (const worksheet of worksheetNames) {
    const count = worksheet === "美育" ? 3 : 7;
    const dir = join(source, worksheet);
    await mkdir(dir, { recursive: true });
    for (let index = 0; index < count; index += 1) {
      const stamp = String(minute++).padStart(6, "0");
      const file = `QQ20240501-${stamp}.png`;
      await writeFile(join(dir, file), `${worksheet}:${file}`);
      names.push(file);
    }
  }
  return { source, names };
}

async function createTempRoot(name: string) {
  const root = resolve(tmpdir(), `jufexk-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  return root;
}

describe("legacy evidence batch command", () => {
  it("builds a clean Sol orchestration prompt and rejects incomplete or unreadable results", () => {
    const job = { id: "主要课程__QQ20240501-000001.png", previous_image_id: null, next_image_id: "主要课程__QQ20240501-000002.png" } as any;
    const prompt = buildCodexOrchestratorPrompt(job, ["C:/evidence/QQ20240501-000001.png", "C:/evidence/QQ20240501-000002.png"]);
    expect(prompt).toContain('fork_turns="none"');
    expect(prompt).toContain('agent_type="default"');
    expect(prompt).toContain("exactly two independent");
    expect(prompt).toContain("1. TARGET:");
    expect(prompt).toContain("2. NEXT:");
    expect(prompt).not.toContain("AGENTS.md");
    expect(prompt).not.toContain("issue #22");

    const valid = {
      image_quality: { status: "usable", affected_images: [], issues: [], recapture_instructions: [] },
      subagents: { analysis_a: { task_id: "a", status: "completed" }, analysis_b: { task_id: "b", status: "completed" } },
      analysis_a: analysisPayload(job.id),
      analysis_b: analysisPayload(job.id),
      arbitration: arbitrationPayload(job.id),
    };
    expect(validateCodexOrchestrationOutput(valid, job.id)).toEqual([]);
    expect(validateCodexOrchestrationOutput({ ...valid, image_quality: { status: "recapture_required", affected_images: [job.id], issues: ["text too small"], recapture_instructions: ["capture at 200% zoom"] } }, job.id)).toEqual(["image recapture required: 主要课程__QQ20240501-000001.png: text too small; capture at 200% zoom"]);
    expect(validateCodexOrchestrationOutput({ ...valid, subagents: { ...valid.subagents, analysis_b: { task_id: "b", status: "failed" } } }, job.id)).toContain("analysis_b subagent did not complete");
  });

  it("parses structured JSON text events", () => {
    const trace = JSON.stringify({ type: "text", sessionID: "ses_example", part: { type: "text", text: "{\"ok\":true}" } });
    expect(extractJson(trace)).toEqual({ ok: true });
  });
  it("builds a deterministic manifest with timestamps, hashes, adjacency and 52-image validation", async () => {
    const root = await createTempRoot("manifest");
    try {
      const { source } = await createFixtureImages(root);
      const batch = join(root, "batch");
      const manifest = await buildManifest({ sourceDir: source, batchDir: batch });

      expect(manifest.images).toHaveLength(MANIFEST_IMAGE_COUNT);
      expect(manifest.prompt_version).toBe(PROMPT_VERSION);
      expect(manifest.schema_version).toBe(SCHEMA_VERSION);
      expect(manifest.models).toEqual({
        analysis_a: ANALYSIS_A_MODEL,
        analysis_b: ANALYSIS_B_MODEL,
        arbitration: ARBITRATION_MODEL,
      });
      expect(manifest.images.every((image) => image.sha256.match(/^[a-f0-9]{64}$/))).toBe(true);
      expect(manifest.images.every((image) => image.screenshot_time.match(/^20240501T\d{6}$/))).toBe(true);
      expect(manifest.images[0]).toMatchObject({ previous_image_id: null });
      expect(manifest.images[1].previous_image_id).toBe(manifest.images[0].id);
      expect(manifest.images.at(-1)?.worksheet).toBe("美育");
      await expect(stat(manifest.images[0].target_path)).resolves.toBeTruthy();

      const secondManifest = await buildManifest({ sourceDir: source, batchDir: join(root, "batch-stable") });
      expect(secondManifest.manifest_hash).toBe(manifest.manifest_hash);

      await expect(buildManifest({ sourceDir: source, batchDir: join(root, "again"), expectedCount: 51 })).rejects.toThrow(/expected 51 images, found 52/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unknown worksheets, duplicate hashes, missing worksheets and unsafe source paths", async () => {
    const root = await createTempRoot("manifest-reject");
    try {
      const { source } = await createFixtureImages(root);
      await mkdir(join(source, "未知"), { recursive: true });
      await writeFile(join(source, "未知", "QQ20240501-235959.png"), "bad");
      await expect(buildManifest({ sourceDir: source, batchDir: join(root, "batch") })).rejects.toThrow(/unclassified worksheet/);

      await rm(join(source, "未知"), { recursive: true, force: true });
      await writeFile(join(source, "主要课程", "QQ20240501-235959.png"), "主要课程:QQ20240501-000001.png");
      await expect(buildManifest({ sourceDir: source, batchDir: join(root, "batch2"), expectedCount: 53 })).rejects.toThrow(/duplicate image content/);

      await rm(join(source, "主要课程", "QQ20240501-235959.png"), { force: true });
      await rm(join(source, "美育"), { recursive: true, force: true });
      await expect(buildManifest({ sourceDir: source, batchDir: join(root, "batch-missing"), expectedCount: 49 })).rejects.toThrow(/missing worksheet/);

      await expect(buildManifest({ sourceDir: root, batchDir: join(root, "batch3") })).rejects.toThrow(/unclassified worksheet|expected/);
      await expect(buildManifest({ sourceDir: resolve("scripts"), batchDir: join(root, "batch4") })).rejects.toThrow(/outside the repository/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs a three-image pilot, writes observable artifacts, and never continues into full", async () => {
    const root = await createTempRoot("pilot");
    try {
      const { source } = await createFixtureImages(root);
      const outDir = join(root, "output");
      const calls: Array<{ model: string; image: string; stage: string; worksheet: string }> = [];
      const result = await runBatchCommand({
        mode: "pilot",
        sourceDir: source,
        batchDir: join(root, "batch"),
        outDir,
        now: () => "2026-07-27T00:00:00.000Z",
        pilotJobIds: ["主要课程__QQ20240501-000001.png", "主要课程__QQ20240501-000002.png", "英语__QQ20240501-000015.png"],
        runner: async (request) => {
          calls.push({ model: request.model, image: request.job.id, stage: request.stage, worksheet: request.job.worksheet });
          return {
            sessionId: `${request.stage}-${request.job.id}`,
            raw: JSON.stringify({ ok: true, stage: request.stage }),
            json: request.stage === "arbitration" ? arbitrationPayload(request.job.id) : analysisPayload(request.job.id),
          };
        },
      });

      expect(result.status).toBe(0);
      expect(result.processedJobs).toHaveLength(3);
      expect(calls).toHaveLength(9);
      expect(calls.map((call) => call.model)).toContain(ANALYSIS_A_MODEL);
      expect(calls.map((call) => call.model)).toContain(ANALYSIS_B_MODEL);
      expect(calls.map((call) => call.model)).toContain(ARBITRATION_MODEL);

      const summary = JSON.parse(await readFile(join(outDir, "summary.json"), "utf8"));
      expect(summary.mode).toBe("pilot");
      expect(summary.jobs).toHaveLength(3);
      expect(summary.jobs.every((job: { status: string }) => job.status === "completed")).toBe(true);
      expect(await readFile(join(outDir, "summary.csv"), "utf8")).toContain("job_id,worksheet,status,records,differences");
      expect(await readFile(join(outDir, "summary.md"), "utf8")).toContain("# Legacy Evidence Summary");

      const firstJob = summary.jobs[0].job_id;
      expect(JSON.parse(await readFile(join(outDir, "jobs", firstJob, "analysis_a.json"), "utf8")).records[0].mapping_status).toBe("pending_mapping");
      expect(await readFile(join(outDir, "jobs", firstJob, "diff.md"), "utf8")).toContain("Character Diff");
      expect(JSON.parse(await readFile(join(outDir, "jobs", firstJob, "carry_context.json"), "utf8")).course.status).toBe("agreed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires full approval bound to manifest, prompt and schema", async () => {
    const root = await createTempRoot("approval");
    try {
      const { source } = await createFixtureImages(root);
      const manifest = await buildManifest({ sourceDir: source, batchDir: join(root, "batch") });
      const outDir = join(root, "output");
      const denied = await runBatchCommand({ mode: "full", manifestPath: manifest.manifest_path, outDir, runner: noopRunner });
      expect(denied.status).toBe(2);
      expect(denied.message).toMatch(/approval/);

      const approvalPath = join(root, "approval.json");
      await writeFile(approvalPath, JSON.stringify(buildApproval({ manifestHash: manifest.manifest_hash, approvedAt: "2026-07-27T00:00:00.000Z" }), null, 2));
      const accepted = await runBatchCommand({ mode: "full", manifestPath: manifest.manifest_path, outDir, approvalPath, runner: noopRunner, maxJobs: 1 });
      expect(accepted.status).toBe(0);

      const activeByWorksheet = new Map<string, number>();
      let sameWorksheetOverlap = false;
      const concurrent = await runBatchCommand({
        mode: "full",
        manifestPath: manifest.manifest_path,
        outDir: join(root, "concurrent"),
        approvalPath,
        maxConcurrentJobs: 4,
        maxJobs: 16,
        now: advancingClock(),
        runner: async (request) => {
          activeByWorksheet.set(request.job.worksheet, (activeByWorksheet.get(request.job.worksheet) ?? 0) + 1);
          if ((activeByWorksheet.get(request.job.worksheet) ?? 0) > 2) sameWorksheetOverlap = true;
          await new Promise((resolve) => setTimeout(resolve, 1));
          activeByWorksheet.set(request.job.worksheet, (activeByWorksheet.get(request.job.worksheet) ?? 1) - 1);
          return noopRunner(request);
        },
      });
      expect(concurrent.status).toBe(0);
      expect(concurrent.processedJobs).toHaveLength(16);
      expect(sameWorksheetOverlap).toBe(false);

      await writeFile(approvalPath, JSON.stringify(buildApproval({ manifestHash: "0".repeat(64), approvedAt: "2026-07-27T00:00:00.000Z" }), null, 2));
      const stale = await runBatchCommand({ mode: "full", manifestPath: manifest.manifest_path, outDir: join(root, "stale"), approvalPath, runner: noopRunner, maxJobs: 1 });
      expect(stale.status).toBe(2);
      expect(stale.message).toMatch(/approval/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses completed stages on resume, invalidates downstream changes, rate-limits calls, repairs format once, and audits without secrets", async () => {
    const root = await createTempRoot("resume");
    try {
      const { source } = await createFixtureImages(root);
      const outDir = join(root, "output");
      let calls = 0;
      let repairSession: string | undefined;
      const first = await runBatchCommand({
        mode: "pilot",
        sourceDir: source,
        batchDir: join(root, "batch"),
        outDir,
        env: { OPENCODE_API_KEY: "secret-token" },
        runner: async (request) => {
          calls += 1;
          if (request.stage === "analysis_b" && calls < 3) throw Object.assign(new Error("rate limited"), { transient: true });
          if (request.stage === "arbitration") return { sessionId: "arb", raw: "{}", json: arbitrationPayload(request.job.id) };
          if (request.stage === "analysis_a" && request.attempt === 0) return { sessionId: "bad", raw: "{}", json: { invalid: true } };
          if (request.stage === "analysis_a" && request.repair) repairSession = request.continuationSessionId;
          return { sessionId: `${request.stage}-${calls}`, raw: JSON.stringify({ token: "secret-token" }), json: analysisPayload(request.job.id) };
        },
        now: (() => {
          let tick = 0;
          return () => new Date(Date.UTC(2026, 6, 27, 0, 0, tick++ * 4)).toISOString();
        })(),
      });
      expect(first.status).toBe(0);
      expect(repairSession).toBe("bad");
      expect(first.callTimestamps.length).toBeGreaterThan(9);
      expect(first.callTimestamps.every((value, index, all) => index < 20 || value - all[index - 20] >= 60_000)).toBe(true);

      const audit = await readFile(join(outDir, "jobs", first.processedJobs[0], "analysis_a.audit.json"), "utf8");
      expect(audit).toContain("validation_errors");
      expect(audit).not.toContain("secret-token");

      calls = 0;
      const resumed = await runBatchCommand({ mode: "pilot", manifestPath: join(root, "batch", "manifest.json"), outDir, runner: noopRunner });
      expect(resumed.status).toBe(0);
      expect(calls).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans only a validated exact temporary run directory", async () => {
    const root = await createTempRoot("cleanup");
    try {
      const runDir = join(root, "runs", "legacy-evidence-test-abc123");
      const sourceDir = join(root, "input");
      await mkdir(runDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(runDir, "artifact.txt"), "delete me");
      await writeFile(join(sourceDir, "source.txt"), "keep me");
      await cleanupRunDirectory({ runDir, allowedRoot: join(root, "runs"), token: "legacy-evidence-test-abc123" });
      await expect(stat(runDir)).rejects.toThrow();
      await expect(stat(join(sourceDir, "source.txt"))).resolves.toBeTruthy();

      await expect(cleanupRunDirectory({ runDir: sourceDir, allowedRoot: root, token: "legacy-evidence-test-abc123" })).rejects.toThrow(/refusing/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a failing exit status when any pilot job fails", async () => {
    const root = await createTempRoot("failed-pilot");
    try {
      const { source } = await createFixtureImages(root);
      const result = await runBatchCommand({ mode: "pilot", sourceDir: source, batchDir: join(root, "batch"), outDir: join(root, "output"), runner: async () => { throw new Error("model failed"); } });
      expect(result.status).toBe(1);
      expect(result.message).toMatch(/pilot failed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function noopRunner(request: { stage: string; job: { id: string } }) {
  return {
    sessionId: `${request.stage}-${request.job.id}`,
    raw: "{}",
    json: request.stage === "arbitration" ? arbitrationPayload(request.job.id) : analysisPayload(request.job.id),
  };
}

function analysisPayload(imageId: string) {
  return {
    schema_version: SCHEMA_VERSION,
    target_image_id: imageId,
    records: [
      {
        raw_transcription: "老师讲得清楚",
        corrected_text: "老师讲得清楚",
        edits: [],
        course_name: "测试课程",
        teacher_name: "测试教师",
        body: "老师讲得清楚",
        confidence: { course_name: 0.95, teacher_name: 0.95, body: 0.95 },
        evidence: { target_image: imageId, adjacent_images: [], row_start_image: imageId, flags: [] },
        bbox: { x: 0.1, y: 0.2, width: 0.6, height: 0.05 },
        uncertainty_markers: [],
        mapping_status: "pending_mapping",
      },
    ],
    context_rows: [
      {
        raw_transcription: "测试课程 / 测试教师",
        course_name: "测试课程",
        teacher_name: "测试教师",
        bbox: { x: 0, y: 0.1, width: 1, height: 0.05 },
        evidence: { target_image: imageId, adjacent_images: [] },
        status: "agreed",
      },
    ],
    carry_context: {
      course: { value: "测试课程", evidence_image: imageId, status: "agreed" },
      teacher: { value: "测试教师", evidence_image: imageId, status: "agreed" },
    },
  };
}

function arbitrationPayload(imageId: string) {
  return {
    schema_version: SCHEMA_VERSION,
    target_image_id: imageId,
    status: "agreed",
    field_decisions: [
      { field: "body", selected: "analysis_a", reason: "identical" },
    ],
    records: analysisPayload(imageId).records,
    context_rows: analysisPayload(imageId).context_rows,
    carry_context: analysisPayload(imageId).carry_context,
  };
}

function advancingClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 27, 0, 0, tick++ * 4)).toISOString();
}
