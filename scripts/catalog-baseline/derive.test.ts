import { execFile } from "node:child_process";
import { readFile, readdir, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import iconv from "iconv-lite";
import { afterEach, describe, expect, it } from "vitest";
import { CAPTURE_PACKAGE_SCHEMA_VERSION, sourceDictionaryContentSha256, writeCapturePackage, type CapturePackageInput } from "./capture-package";
import { deriveCatalogBaseline } from "./derive";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(scriptRoot, "fixtures", "pilot");
const repositoryRoot = resolve(scriptRoot, "../..");

async function tempRoot(name: string) {
  const root = join(tmpdir(), `jufexk-derive-${name}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function query(queryId: string, semester: string, declaredRecordCount: number, pageCount = 1) {
  return {
    schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
    queryId,
    kind: "main" as const,
    dimensions: { semester, educationLevel: "undergraduate", grade: "2025" },
    filters: { department: "", major: "", campus: "", category: "", courseName: "", teacherName: "", homeUnit: "" },
    status: "complete" as const,
    declaredRecordCount,
    capturedRecordCount: declaredRecordCount,
    pageCount,
    requestParameters: { semester, educationLevel: "undergraduate", grade: "2025" },
  };
}

function sourceDictionary() {
  const content = {
    schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
    semesters: [],
    educationLevels: [],
    grades: [],
    homeUnits: [
      { id: "UNIT-1", label: "[101]本校单位甲" },
      { id: "FIXTURE-UNIT-1", label: "[201]字段5-1" },
      { id: "FIXTURE-UNIT-2", label: "[202]字段5-2" },
    ],
    majors: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
  return { ...content, sha256: sourceDictionaryContentSha256(content) };
}

const headers = ["课程", "开课校区", "学分", "总学时", "课程类别", "承担单位", "上课班号", "上课班组", "上课班级名称", "限选人数", "已选/免听", "可选人数", "周次", "授课方式", "任课教师", "上课时间", "上课地点", "双语教学", "精品课程", "上课班号", "授课方式", "校区代码"];

function syntheticHtml(rows: string) {
  return iconv.encode(`<!doctype html><html><head><meta charset="gbk"></head><body>
    <table id="keywords"><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></body></html>`, "gbk");
}

function sourceShapedHtml(rows?: string) {
  const sourceHeaders = headers.map((header, index) => index === 6 ? "上课<br>班号" : header);
  return iconv.encode(`<!doctype html><html><head><meta charset="gbk"></head><body>
    <table id="keywords"><thead><tr>${sourceHeaders.map((header) => `<td>${header}</td>`).join("")}</tr></thead>
    ${rows === undefined ? "" : `<tbody>${rows}</tbody>`}</table></body></html>`, "gbk");
}

function cells(course: string, teacher: string, courseAttributes = "", evidence: Partial<Record<"campus" | "category" | "homeUnit" | "location", string>> = {}) {
  const values = Array.from({ length: 22 }, () => "");
  values[0] = course;
  values[1] = evidence.campus ?? "麦庐园校区";
  values[4] = evidence.category ?? "必修课";
  values[5] = evidence.homeUnit ?? "本校单位甲";
  values[14] = teacher;
  values[16] = evidence.location ?? "麦庐园教学楼";
  return values.map((value, index) => `<td${index === 0 ? courseAttributes : ""}>${value}</td>`).join("");
}

async function buildBehaviorPackage(root: string): Promise<CapturePackageInput> {
  const pagination = await readFile(join(fixtureRoot, "pagination.html"));
  const digitSuffix = await readFile(join(fixtureRoot, "teacher-digit-suffix.html"));
  const oldName = syntheticHtml(`<tr>${cells("[COURSE-RENAME]课程旧名", "教师乙")}</tr>`);
  const newNameAndInherited = syntheticHtml([
    `<tr>${cells("[COURSE-RENAME]课程新名", "教师乙", ' rowspan="2"')}</tr>`,
    `<tr>${cells("", "").replace(/^<td><\/td>/, "")}</tr>`,
  ].join(""));
  const input: CapturePackageInput = {
    batchId: "derive-behavior",
    status: "complete",
    sourceDictionarySha256: sourceDictionary().sha256,
    sourceDictionary: sourceDictionary(),
    queries: [
      query("main-older", "2025-1", 1),
      query("main-newer", "2026-1", 2),
      query("main-paged", "2026-1", 3, 2),
    ],
    snapshots: [
      { queryId: "main-older", page: 1, bytes: oldName },
      { queryId: "main-newer", page: 1, bytes: newNameAndInherited },
      { queryId: "main-paged", page: 1, bytes: pagination },
      { queryId: "main-paged", page: 2, bytes: digitSuffix },
    ],
  };
  await writeCapturePackage(root, input);
  return input;
}

async function readJsonLines(path: string) {
  return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function bytesByName(root: string) {
  const result = new Map<string, Buffer>();
  for (const name of (await readdir(root)).sort()) result.set(name, await readFile(join(root, name)));
  return result;
}

describe("catalog baseline deterministic offline derivation", () => {
  it("accepts the source table's td headers, embedded header whitespace, and absent empty tbody", async () => {
    const captureRoot = await tempRoot("source-shape-capture");
    const outputRoot = await tempRoot("source-shape-output");
    await writeCapturePackage(captureRoot, {
      batchId: "source-shape",
      status: "complete",
      sourceDictionarySha256: sourceDictionary().sha256,
      sourceDictionary: sourceDictionary(),
      queries: [query("main-data", "2026-1", 1), query("main-empty", "2026-1", 0)],
      snapshots: [
        { queryId: "main-data", page: 1, bytes: sourceShapedHtml(`<tr>${cells("[COURSE-SOURCE]来源结构课程", "来源教师1")}</tr>`) },
        { queryId: "main-empty", page: 1, bytes: sourceShapedHtml() },
      ],
    });

    const manifest = await deriveCatalogBaseline(captureRoot, outputRoot);
    const inventory = await readJsonLines(join(outputRoot, "inventory.jsonl"));

    expect(manifest.status).toBe("derived");
    expect(inventory).toEqual([expect.objectContaining({
      courseCode: "COURSE-SOURCE",
      rawTeacherLabels: ["来源教师1"],
      sourceCampus: "麦庐园校区",
      sourceCategoryText: "必修课",
      sourceHomeUnit: "本校单位甲",
      sourceHomeUnitCode: "UNIT-1",
      sourceLocation: "麦庐园教学楼",
    })]);
  });

  it("splits the verified Chinese space-separated multi-teacher format", async () => {
    const captureRoot = await tempRoot("space-separated-teachers-capture");
    const outputRoot = await tempRoot("space-separated-teachers-output");
    await writeCapturePackage(captureRoot, {
      batchId: "space-separated-teachers",
      status: "complete",
      sourceDictionarySha256: sourceDictionary().sha256,
      sourceDictionary: sourceDictionary(),
      queries: [query("main-space-teachers", "2026-1", 1)],
      snapshots: [{
        queryId: "main-space-teachers",
        page: 1,
        bytes: sourceShapedHtml(`<tr>${cells("[COURSE-SPACE]空格分隔教师课程", "教师甲 教师乙2")}</tr>`),
      }],
    });

    const manifest = await deriveCatalogBaseline(captureRoot, outputRoot);
    const teachers = await readJsonLines(join(outputRoot, "teachers.jsonl"));
    const relations = await readJsonLines(join(outputRoot, "relations.jsonl"));
    const exceptions = await readJsonLines(join(outputRoot, "exceptions.jsonl"));

    expect(manifest.status).toBe("derived");
    expect(teachers.map((teacher) => teacher.sourceTeacherLabel)).toEqual(["教师乙2", "教师甲"]);
    expect(relations.map((relation) => relation.sourceTeacherLabel)).toEqual(["教师乙2", "教师甲"]);
    expect(exceptions).toEqual([]);
  });

  it("inherits a blank course cell within and across pages of the same query", async () => {
    const captureRoot = await tempRoot("inheritance-capture");
    const outputRoot = await tempRoot("inheritance-output");
    const blankCourseCells = cells("", "教师丙");
    await writeCapturePackage(captureRoot, {
      batchId: "inheritance-shape",
      status: "complete",
      sourceDictionarySha256: sourceDictionary().sha256,
      sourceDictionary: sourceDictionary(),
      queries: [query("main-inherit", "2026-1", 3, 2)],
      snapshots: [
        { queryId: "main-inherit", page: 1, bytes: sourceShapedHtml(`<tr>${cells("[COURSE-INHERIT]继承课程", "教师丙")}</tr><tr>${blankCourseCells}</tr>`) },
        { queryId: "main-inherit", page: 2, bytes: sourceShapedHtml(`<tr>${blankCourseCells}</tr>`) },
      ],
    });

    const manifest = await deriveCatalogBaseline(captureRoot, outputRoot);
    const inventory = await readJsonLines(join(outputRoot, "inventory.jsonl"));

    expect(manifest.status).toBe("derived");
    expect(inventory).toHaveLength(3);
    expect(inventory.every((record) => record.courseCode === "COURSE-INHERIT")).toBe(true);
  });

  it("preserves distinct raw teacher identities when minimal normalization collides", async () => {
    const captureRoot = await tempRoot("teacher-collision-capture");
    const outputRoot = await tempRoot("teacher-collision-output");
    await writeCapturePackage(captureRoot, {
      batchId: "teacher-normalization-collision",
      status: "complete",
      sourceDictionarySha256: sourceDictionary().sha256,
      sourceDictionary: sourceDictionary(),
      queries: [query("main-collision", "2026-1", 2)],
      snapshots: [{
        queryId: "main-collision",
        page: 1,
        bytes: sourceShapedHtml([
          `<tr>${cells("[COURSE-COLLISION]碰撞课程", "教师&nbsp;&nbsp;丁2")}</tr>`,
          `<tr>${cells("[COURSE-COLLISION]碰撞课程", "教师 丁2")}</tr>`,
        ].join("")),
      }],
    });

    const manifest = await deriveCatalogBaseline(captureRoot, outputRoot);
    const teachers = await readJsonLines(join(outputRoot, "teachers.jsonl"));
    const exceptions = await readJsonLines(join(outputRoot, "exceptions.jsonl"));

    expect(manifest.status).toBe("derived_with_exceptions");
    expect(teachers).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceTeacherLabel: "教师  丁2", normalizedTeacherLabel: "教师 丁2" }),
      expect.objectContaining({ sourceTeacherLabel: "教师 丁2", normalizedTeacherLabel: "教师 丁2" }),
    ]));
    expect(exceptions).toContainEqual(expect.objectContaining({ code: "NORMALIZED_TEACHER_COLLISION" }));
  });

  it("derives course-code, source-teacher, and relation identities through the public seam", async () => {
    const captureRoot = await tempRoot("behavior-capture");
    const outputRoot = await tempRoot("behavior-output");
    await buildBehaviorPackage(captureRoot);

    const manifest = await deriveCatalogBaseline(captureRoot, outputRoot);
    const courses = await readJsonLines(join(outputRoot, "courses.jsonl"));
    const teachers = await readJsonLines(join(outputRoot, "teachers.jsonl"));
    const relations = await readJsonLines(join(outputRoot, "relations.jsonl"));
    const inventory = await readJsonLines(join(outputRoot, "inventory.jsonl"));

    expect(manifest.status).toBe("derived");
    expect(courses.find((course) => course.courseCode === "COURSE-RENAME")).toMatchObject({
      currentName: "课程新名",
      nameVariants: [
        { rawName: "课程新名", normalizedName: "课程新名" },
        { rawName: "课程旧名", normalizedName: "课程旧名" },
      ],
    });
    expect(teachers.map((teacher) => teacher.sourceTeacherLabel)).toEqual(expect.arrayContaining(["教师甲", "教师甲2"]));
    expect(relations).toContainEqual(expect.objectContaining({ courseCode: "COURSE-001", sourceTeacherLabel: "教师甲2" }));
    expect(inventory).toContainEqual(expect.objectContaining({
      courseCode: "COURSE-RENAME",
      queryId: "main-newer",
      page: 1,
      row: 2,
      rawTeacherLabels: [],
    }));
  });

  it("writes byte-identical sorted artifacts and hashes for the same capture package", async () => {
    const captureRoot = await tempRoot("determinism-capture");
    const firstRoot = await tempRoot("determinism-first");
    const secondRoot = await tempRoot("determinism-second");
    await buildBehaviorPackage(captureRoot);

    const first = await deriveCatalogBaseline(captureRoot, firstRoot);
    const second = await deriveCatalogBaseline(captureRoot, secondRoot);

    expect(second).toEqual(first);
    const firstFiles = await bytesByName(firstRoot);
    const secondFiles = await bytesByName(secondRoot);
    expect([...secondFiles.keys()]).toEqual([...firstFiles.keys()]);
    for (const [name, bytes] of firstFiles) expect(secondFiles.get(name)).toEqual(bytes);
  });

  it.each([
    ["missing course code", syntheticHtml(`<tr>${cells("课程没有课号", "教师甲")}</tr>`), "MISSING_COURSE_CODE"],
    ["unverified multi-teacher structure", syntheticHtml(`<tr>${cells("[COURSE-MULTI]多教师合成契约样本", "教师甲、教师乙")}</tr>`), "UNKNOWN_TEACHER_STRUCTURE"],
    ["unknown table structure", iconv.encode("<html><body><table id=\"other\"></table></body></html>", "gbk"), "UNKNOWN_TABLE_STRUCTURE"],
    ["invalid GBK", Buffer.from([0x81, 0x30, 0x81]), "GBK_DECODE_ERROR"],
  ])("records %s as an explicit exception", async (_name, bytes, code) => {
    const captureRoot = await tempRoot(`exception-${code}-capture`);
    const outputRoot = await tempRoot(`exception-${code}-output`);
    await writeCapturePackage(captureRoot, {
      batchId: `exception-${code.toLowerCase()}`,
      status: "complete",
      sourceDictionarySha256: sourceDictionary().sha256,
      sourceDictionary: sourceDictionary(),
      queries: [query("main-error", "2026-1", 1)],
      snapshots: [{ queryId: "main-error", page: 1, bytes }],
    });

    const manifest = await deriveCatalogBaseline(captureRoot, outputRoot);
    const exceptions = await readJsonLines(join(outputRoot, "exceptions.jsonl"));

    expect(manifest.status).toBe("derived_with_exceptions");
    expect(exceptions).toContainEqual(expect.objectContaining({ code, queryId: "main-error", page: 1 }));
    if (code !== "UNKNOWN_TEACHER_STRUCTURE")
      expect(exceptions).toContainEqual(expect.objectContaining({ code: "PARSED_RECORD_COUNT_MISMATCH", queryId: "main-error", page: 0 }));
    else {
      const courses = await readJsonLines(join(outputRoot, "courses.jsonl"));
      const relations = await readJsonLines(join(outputRoot, "relations.jsonl"));
      expect(courses).toContainEqual(expect.objectContaining({ courseCode: "COURSE-MULTI" }));
      expect(relations).not.toContainEqual(expect.objectContaining({ courseCode: "COURSE-MULTI" }));
      expect(exceptions).toContainEqual(expect.objectContaining({ code, row: 1 }));
    }
  });

  it("runs through pnpm run catalog-baseline derive without network access", async () => {
    const captureRoot = await tempRoot("cli-capture");
    const outputRoot = await tempRoot("cli-output");
    await buildBehaviorPackage(captureRoot);

    const isWindows = process.platform === "win32";
    const packageManager = isWindows ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
    const packageManagerArgs = isWindows ? ["/d", "/s", "/c", "pnpm.cmd"] : [];
    const { stdout } = await execFileAsync(packageManager, [...packageManagerArgs, "--silent", "run", "catalog-baseline", "derive", captureRoot, "--output", outputRoot], {
      cwd: repositoryRoot,
      env: { ...process.env, HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1", NO_PROXY: "" },
    });

    expect(JSON.parse(stdout)).toMatchObject({ status: "derived", outputRoot });
  }, 15_000);
});
