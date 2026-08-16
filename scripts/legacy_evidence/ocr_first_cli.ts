import { access, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { runCellReviewWorkflow, type CellArbitrationRunner, type CellArbitrationRunnerRequest, type CellReviewRunner, type CellReviewRunnerRequest } from "./ocr_first";

function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

function optionalOption(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : undefined;
}

const workflowMode = optionalOption("--mode") ?? "review";

function extractJson(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("agent output did not contain JSON");
  return JSON.parse(trimmed.slice(first, last + 1));
}

async function codexCommand() {
  const override = process.env.CODEX_EXECUTABLE;
  if (override) return { executable: override, prefixArgs: [] as string[] };
  if (process.platform !== "win32") return { executable: "codex", prefixArgs: [] as string[] };

  for (const entry of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const shim = join(entry.replace(/^"|"$/g, ""), "codex.cmd");
    try {
      await access(shim);
    } catch {
      continue;
    }
    const root = dirname(shim);
    const script = join(root, "node_modules", "@openai", "codex", "bin", "codex.js");
    await access(script);
    const bundledNode = join(root, "node.exe");
    try {
      await access(bundledNode);
      return { executable: bundledNode, prefixArgs: [script] };
    } catch {
      return { executable: "node.exe", prefixArgs: [script] };
    }
  }
  throw new Error("codex.cmd was not found on PATH; set CODEX_EXECUTABLE to a native executable");
}

export function isolatedPrompt(request: CellReviewRunnerRequest, stagedNames: string[], mode = workflowMode) {
  let cells = request.cells.map((source, index) => {
    const { image: _sourcePath, ...cell } = source;
    return { ...cell, image: stagedNames[index] };
  });
  if (mode === "review-uncertain") cells = request.cells.map((source, index) => ({
    key: source.key,
    image: stagedNames[index],
    ...(request.side === "analysis_b" ? { ocr: source.ocr } : {}),
  })) as typeof cells;
  const evidenceRule = request.side === "analysis_a"
    ? "You are side A. Use only the attached crop images. OCR text is intentionally absent; do not infer or seek it."
    : "You are side B. Use the attached crop images and the OCR evidence included in each cell.";
  if (mode === "context") return [
    "You are an isolated legacy spreadsheet row-context transcription agent.",
    "Do not inspect any files, directories, repository state, instructions, issues, ADRs, Git data, network resources, or other project context.",
    evidenceRule,
    "Each attachment is one row crop. The display_header declares the source-column mapping. Read only the visible course and teacher cells from those declared columns; ignore course introduction and review text. Never infer a blank merged continuation cell and never guess. Use [blank] for visibly blank, [unclear] for unreadable. For multiple declared teacher columns, preserve both visible values joined by ' / '.",
    "raw_transcription and corrected_text must be identical and exactly two lines: course=<literal|[blank]|[unclear]> then teacher=<literal|[blank]|[unclear]>. edits must be [] and uncertainty_markers must list every [unclear] field.",
    "Return JSON only: {\"cells\":[{\"key\":string,\"raw_transcription\":string,\"corrected_text\":string,\"edits\":[],\"uncertainty_markers\":[]}]}. Return every key exactly once and no other keys.",
    JSON.stringify({ contract_version: request.contract_version, task_id: request.task_id, side: request.side, cells }, null, 2),
  ].join("\n\n");
  return [
    "You are an isolated legacy-review cell transcription agent.",
    "Do not inspect any files, directories, repository state, instructions, issues, ADRs, Git data, network resources, or other project context.",
    evidenceRule,
    mode === "review-uncertain"
      ? "For every declared cell, transcribe all review text visibly continuing across the marked spreadsheet cell boundary. Ignore unrelated text in neighboring cells. Preserve raw_transcription literally, including meaningful line breaks. corrected_text must equal raw_transcription and edits must be empty. Use uncertainty_markers for every still-clipped or unreadable span and never guess."
      : "For every declared cell, transcribe only visible review text. Preserve raw_transcription literally. corrected_text may only contain an explicitly justified correction; list each correction in edits. Use uncertainty_markers for unreadable spans and never guess.",
    "Return JSON only: {\"cells\":[{\"key\":string,\"raw_transcription\":string,\"corrected_text\":string,\"edits\":[],\"uncertainty_markers\":[]}]}. Return every key exactly once and no other keys.",
    JSON.stringify({ contract_version: request.contract_version, task_id: request.task_id, side: request.side, cells }, null, 2),
  ].join("\n\n");
}

export function arbitrationPrompt(request: CellArbitrationRunnerRequest, stagedNames: string[], mode = workflowMode) {
  let cells = request.cells.map((source, index) => {
    const { image: _sourcePath, ...cell } = source;
    return { ...cell, image: stagedNames[index] };
  });
  if (mode === "review-uncertain") cells = request.cells.map((source, index) => ({
    key: source.key,
    image: stagedNames[index],
    analysis_a: source.analysis_a,
    analysis_b: source.analysis_b,
  })) as typeof cells;
  const subject = mode === "context"
    ? "Use only each attached row crop and its two declared course/teacher candidates. Check only the source columns declared in display_header."
    : "Use only each attached crop and its two declared candidate transcriptions.";
  return [
    "You are an isolated legacy-review cell arbitration agent.",
    "Do not inspect any files, directories, repository state, instructions, issues, ADRs, Git data, network resources, or other project context.",
    `${subject} Do not use OCR and never invent, merge, normalize, or produce a third transcription.`,
    "For every cell choose analysis_a or analysis_b only when that candidate exactly matches the visible text, including punctuation and meaningful line breaks. Choose null when neither candidate can be verified. Give a concise evidence reason.",
    "Return JSON only: {\"cells\":[{\"key\":string,\"selected\":\"analysis_a\"|\"analysis_b\"|null,\"reason\":string}]}. Return every key exactly once and no other keys.",
    JSON.stringify({ contract_version: request.contract_version, task_id: request.task_id, side: request.side, cells }, null, 2),
  ].join("\n\n");
}

async function runCodexRequest(request: CellReviewRunnerRequest | CellArbitrationRunnerRequest) {
  const working = await mkdtemp(join(tmpdir(), "jufexk-cell-review-"));
  const responsePath = join(working, "response.json");
  const stagedNames: string[] = [];
  try {
    for (const [index, cell] of request.cells.entries()) {
      if (!cell.image) throw new Error(`cell image is missing: ${cell.key}`);
      const extension = basename(cell.image).toLowerCase().endsWith(".png") ? ".png" : ".jpg";
      const name = `cell-${String(index + 1).padStart(2, "0")}${extension}`;
      await copyFile(resolve(cell.image), join(working, name));
      stagedNames.push(name);
    }
    const prompt = request.side === "arbitration" ? arbitrationPrompt(request, stagedNames) : isolatedPrompt(request, stagedNames);
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    const args = [
      "exec", "--ephemeral", "--ignore-rules", "-C", working, "-m", request.model,
      "-s", "read-only", "--color", "never", "-o", responsePath,
      ...stagedNames.flatMap((name) => ["-i", name]), "-",
    ];
    const command = await codexCommand();
    const { exitCode, stdout, stderr } = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolveRun, reject) => {
      const child = spawn(command.executable, [...command.prefixArgs, ...args], { cwd: working, env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolveRun({ exitCode: code ?? -1, stdout, stderr }));
      child.stdin.end(prompt);
    });
    if (exitCode !== 0) throw new Error(`codex exit ${exitCode}: ${(stderr || stdout).slice(-4000)}`);
    const raw = await readFile(responsePath, "utf8");
    const sessionId = stderr.match(/session id:\s*([0-9a-f-]+)/i)?.[1];
    return { ...extractJson(raw), session_id: sessionId };
  } finally {
    await rm(working, { recursive: true, force: true });
  }
}

export const codexCellRunner: CellReviewRunner = async (request) => runCodexRequest(request);
export const codexArbitrationRunner: CellArbitrationRunner = async (request) => runCodexRequest(request);

if (process.argv[1]?.endsWith("ocr_first_cli.ts")) {
  const result = await runCellReviewWorkflow({
    inputPath: option("--input"),
    outDir: option("--out"),
    runner: codexCellRunner,
    arbitrator: codexArbitrationRunner,
  });
  console.log(JSON.stringify(result));
}
