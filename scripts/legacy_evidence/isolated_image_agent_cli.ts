import { createHash } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, join, resolve } from "node:path";

function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

async function codexCommand() {
  if (process.platform !== "win32") return { executable: "codex", prefixArgs: [] as string[] };
  for (const entry of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const root = entry.replace(/^"|"$/g, "");
    const script = join(root, "node_modules", "@openai", "codex", "bin", "codex.js");
    try {
      await access(script);
    } catch {
      continue;
    }
    const node = join(dirname(root), "node.exe");
    try {
      await access(node);
      return { executable: node, prefixArgs: [script] };
    } catch {
      return { executable: "node.exe", prefixArgs: [script] };
    }
  }
  throw new Error("Codex JavaScript entrypoint was not found on PATH");
}

type Input = {
  task_id: string;
  model: "gpt-5.6-luna" | "gpt-5.5" | "gpt-5.4";
  prompt: string;
  images: Array<{ path: string; source_name: string }>;
};

async function main() {
  const inputPath = resolve(option("--input"));
  const outPath = resolve(option("--out"));
  const rawInput = await readFile(inputPath, "utf8");
  const input = JSON.parse(rawInput) as Input;
  if (!input.task_id || !input.prompt || !Array.isArray(input.images) || input.images.length < 1 || input.images.length > 8) throw new Error("invalid isolated image task");
  const working = await mkdtemp(join(tmpdir(), "jufexk-isolated-image-"));
  const responsePath = join(working, "response.txt");
  const startedAt = new Date().toISOString();
  const record: Record<string, unknown> = {
    task_id: input.task_id,
    model: input.model,
    input_sha256: createHash("sha256").update(rawInput).digest("hex"),
    image_sha256: [],
    started_at: startedAt,
  };
  try {
    const staged: string[] = [];
    const hashes: Array<{ source_name: string; sha256: string }> = [];
    for (const [index, image] of input.images.entries()) {
      const bytes = await readFile(resolve(image.path));
      const name = `image-${String(index + 1).padStart(2, "0")}${extname(image.path).toLowerCase() || ".png"}`;
      await copyFile(resolve(image.path), join(working, name));
      staged.push(name);
      hashes.push({ source_name: image.source_name, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    record.image_sha256 = hashes;
    const prompt = `${input.prompt}\n\nATTACHMENT MAPPING:\n${staged.map((name, index) => `${name} => ${input.images[index].source_name}`).join("\n")}`;
    const command = await codexCommand();
    const args = [
      ...command.prefixArgs, "exec", "--ephemeral", "--ignore-rules", "-C", working, "-m", input.model,
      "-s", "read-only", "--color", "never", "-o", responsePath,
      ...staged.flatMap((name) => ["-i", name]), "-",
    ];
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((finish, reject) => {
      const child = spawn(command.executable, args, { cwd: working, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => finish({ code: code ?? -1, stdout, stderr }));
      child.stdin.end(prompt);
    });
    if (result.code !== 0) throw new Error(`codex exit ${result.code}: ${(result.stderr || result.stdout).slice(-4000)}`);
    const rawResponse = await readFile(responsePath, "utf8");
    Object.assign(record, {
      status: "completed",
      completed_at: new Date().toISOString(),
      session_id: result.stderr.match(/session id:\s*([0-9a-f-]+)/i)?.[1] ?? null,
      raw_response: rawResponse,
      stderr_tail: result.stderr.slice(-4000),
    });
  } catch (error) {
    Object.assign(record, { status: "failed", completed_at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
  } finally {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`);
    await rm(working, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ task_id: record.task_id, status: record.status, session_id: record.session_id ?? null }));
  if (record.status !== "completed") process.exitCode = 1;
}

await main();
