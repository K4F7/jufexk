import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateCapturePackage, writeCapturePackage } from "./capture-package";
import { softwareEngineeringPackage, softwareEngineeringQuery } from "./test-package";

const roots: string[] = [];

async function tempRoot(name: string) {
  const root = join(tmpdir(), `jufexk-program-plan-${name}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("program plan capture package", () => {
  it("round-trips manifest, queries, coverage, and GBK snapshots with SHA-256", async () => {
    const root = await tempRoot("round-trip");
    const input = await softwareEngineeringPackage();
    const written = await writeCapturePackage(root, input);
    const validated = await validateCapturePackage(root);

    expect(validated).toEqual(written);
    expect(validated.schemaVersion).toBe("program-plan-capture-package/v1");
    expect(validated.files.map((file) => file.path)).toEqual([
      "queries.jsonl",
      "source-dictionary.json",
      "coverage.json",
      "snapshots/main-2025-14-080902/page-0001.html",
    ]);
    expect(JSON.parse(await readFile(join(root, "coverage.json"), "utf8")).entries[0]).toMatchObject({
      grade: "2025",
      majorCode: "080902",
      status: "complete",
    });
  });

  it.each([
    ["password", "password=hunter2"],
    ["cookie", "Cookie: JSESSIONID=secret"],
    ["ticket", "ticket=ST-12345"],
    ["学号", "学号：2021001234"],
    ["姓名", "姓名：张三"],
    ["external URL", "https://evil.example/collect"],
  ])("refuses %s in exported snapshots", async (_name, unsafe) => {
    const root = await tempRoot("unsafe");
    const input = await softwareEngineeringPackage({
      snapshots: [{ queryId: "main-2025-14-080902", page: 1, bytes: Buffer.from(`<html>${unsafe}</html>`) }],
    });
    await expect(writeCapturePackage(root, input)).rejects.toThrow(/unsafe/i);
  });

  it("keeps empty coverage distinct from a failed query in the same package", async () => {
    const root = await tempRoot("empty-vs-fail");
    const empty = softwareEngineeringQuery({
      queryId: "main-2025-14-080902",
      declaredRecordCount: 0,
      capturedRecordCount: 0,
      pageCount: 1,
    });
    const input = await softwareEngineeringPackage({
      queries: [empty],
      snapshots: [{ queryId: empty.queryId, page: 1, bytes: Buffer.from("<html><table id='keywords'><thead><tr><th>学年学期</th><th>课程</th></tr></thead><tbody></tbody></table></html>") }],
    });
    input.coverage.entries[0] = { ...input.coverage.entries[0], status: "empty", declaredRecordCount: 0, reason: "empty_result" };
    const written = await writeCapturePackage(root, input);
    expect(written.status).toBe("complete");
    expect(JSON.parse(await readFile(join(root, "coverage.json"), "utf8")).entries[0].status).toBe("empty");
  });
});
