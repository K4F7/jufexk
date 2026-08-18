import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PRINT_WINDOW_CAPTURE_SCRIPT = "print_window_capture.ps1";

export type PrintWindowCaptureResult = {
  method: "print_window";
  path: string;
  width: number;
  height: number;
};

export type WindowCaptureRunner = (
  command: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export function printWindowCaptureScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), PRINT_WINDOW_CAPTURE_SCRIPT);
}

export function readPrintWindowCaptureScript(): string {
  return readFileSync(printWindowCaptureScriptPath(), "utf8");
}

export function assertPrintWindowOnlyScript(source: string): void {
  if (!/PrintWindow\s*\([^)]*,\s*[^)]*,\s*2\s*\)/.test(source)) {
    throw new Error("window capture must call PrintWindow(..., 2)");
  }
  if (/\.CopyFromScreen\s*\(/.test(source)) {
    throw new Error("window capture must not use CopyFromScreen");
  }
}

export async function captureSheetWindowPng(options: {
  hwnd: string;
  outPng: string;
  width?: number;
  height?: number;
  run?: WindowCaptureRunner;
}): Promise<PrintWindowCaptureResult> {
  const source = options.run ? undefined : readPrintWindowCaptureScript();
  if (source) assertPrintWindowOnlyScript(source);
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    printWindowCaptureScriptPath(),
    "-Hwnd",
    options.hwnd,
    "-OutPng",
    options.outPng,
  ];
  if (options.width) args.push("-Width", String(options.width));
  if (options.height) args.push("-Height", String(options.height));
  const run = options.run ?? runPowerShell;
  const result = await run("powershell.exe", args);
  if (result.code !== 0) {
    throw new Error(`PrintWindow capture failed: ${result.stderr || result.stdout}`.trim());
  }
  const parsed = parseLastJson(result.stdout);
  if (!isRecord(parsed) || parsed.method !== "print_window" || typeof parsed.path !== "string"
    || !Number.isInteger(parsed.width) || !Number.isInteger(parsed.height)) {
    throw new Error("PrintWindow capture returned an invalid result");
  }
  return {
    method: "print_window",
    path: parsed.path,
    width: parsed.width,
    height: parsed.height,
  };
}

function parseLastJson(stdout: string): unknown {
  const line = stdout.trim().split(/\r?\n/).filter((item) => item.length > 0).at(-1);
  if (!line) throw new Error("PrintWindow capture returned no JSON");
  return JSON.parse(line);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runPowerShell(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
