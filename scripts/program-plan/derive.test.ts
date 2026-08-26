import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { writeCapturePackage } from "./capture-package";
import { deriveProgramPlan } from "./derive";
import { softwareEngineeringPackage } from "./test-package";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function tempRoot(name: string) {
  const root = join(tmpdir(), `jufexk-program-plan-derive-${name}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function readJsonLines(path: string) {
  return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("program plan offline derivation", () => {
  it("keeps the same course across suggested terms and leaves missing course codes out of the course table", async () => {
    const captureRoot = await tempRoot("capture");
    const outputRoot = await tempRoot("output");
    await writeCapturePackage(captureRoot, await softwareEngineeringPackage());

    const manifest = await deriveProgramPlan(captureRoot, outputRoot, { catalogCourseCodes: ["10100001", "10100002"] });
    const courses = await readJsonLines(join(outputRoot, "courses.jsonl"));
    const exceptions = await readJsonLines(join(outputRoot, "exceptions.jsonl"));
    const matches = await readJsonLines(join(outputRoot, "catalog-match.jsonl"));

    expect(manifest.status).toBe("derived_with_exceptions");
    expect(courses.map((course) => `${course.courseCode}:${course.suggestedTerm}`)).toEqual([
      "10100001:2025-2026学年第一学期",
      "10100002:2025-2026学年第二学期",
      "20800001:2025-2026学年第一学期",
      "20800001:2026-2027学年第一学期",
    ]);
    expect(courses.find((course) => course.courseCode === "10100001")).toMatchObject({
      grade: "2025",
      majorCode: "080902",
      courseName: "高等数学A",
      categoryText: "必修课/公共课/公共必修课",
      studyKind: "主修",
      hours: { total: "64", lecture: "64", experiment: "0", practice: "0", other: "0", weekly: "4" },
    });
    expect(courses.find((course) => course.courseCode === "20800001" && course.suggestedTerm.startsWith("2025"))).toMatchObject({
      categoryText: "必修课/2025专业教育课/专业必修课",
      hours: { practice: "", experiment: "16" },
    });
    expect(exceptions).toEqual([expect.objectContaining({ code: "MISSING_COURSE_CODE", detail: "专业导论（缺课号）" })]);
    expect(matches).toEqual([
      expect.objectContaining({ courseCode: "10100001", status: "matched" }),
      expect.objectContaining({ courseCode: "10100002", status: "matched" }),
      expect.objectContaining({ courseCode: "20800001", status: "unmatched" }),
    ]);
    expect(courses.some((course) => course.courseName.includes("专业导论"))).toBe(false);
  });

  it("re-parses the same fixture HTML with a stable hash", async () => {
    const input = await softwareEngineeringPackage();
    const firstCapture = await tempRoot("hash-capture-1");
    const secondCapture = await tempRoot("hash-capture-2");
    const firstOutput = await tempRoot("hash-output-1");
    const secondOutput = await tempRoot("hash-output-2");
    await writeCapturePackage(firstCapture, input);
    await writeCapturePackage(secondCapture, input);
    const first = await deriveProgramPlan(firstCapture, firstOutput);
    const second = await deriveProgramPlan(secondCapture, secondOutput);
    expect(first.contentSha256).toBe(second.contentSha256);
    expect(first.files).toEqual(second.files);
  });

  it("runs through pnpm run program-plan derive without network access", async () => {
    const captureRoot = await tempRoot("cli-capture");
    const outputRoot = await tempRoot("cli-output");
    await writeCapturePackage(captureRoot, await softwareEngineeringPackage());
    const isWindows = process.platform === "win32";
    const packageManager = isWindows ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
    const packageManagerArgs = isWindows ? ["/d", "/s", "/c", "pnpm.cmd"] : [];
    const { stdout } = await execFileAsync(packageManager, [...packageManagerArgs, "--silent", "run", "program-plan", "derive", captureRoot, "--output", outputRoot], {
      cwd: repositoryRoot,
      env: { ...process.env, HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1", NO_PROXY: "" },
    });
    const manifest = JSON.parse(stdout);
    expect(manifest.schemaVersion).toBe("program-plan-derivation/v1");
    expect(manifest.status).toBe("derived_with_exceptions");
    expect(await readdir(outputRoot)).toEqual(expect.arrayContaining(["courses.jsonl", "exceptions.jsonl", "catalog-match.jsonl", "manifest.json"]));
  }, 15_000);
});
