import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import iconv from "iconv-lite";
import { coverageFromQueries, freezeSourceDictionary, type FrozenSourceDictionary } from "./query-plan";
import type { CapturePackageInput, CaptureQuery } from "./capture-package";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "software-engineering-2025.html");

export async function softwareEngineeringFixtureBytes() {
  return iconv.encode(await readFile(fixturePath, "utf8"), "gbk");
}

export function softwareEngineeringDictionary(): FrozenSourceDictionary {
  return freezeSourceDictionary([{
    grade: { id: "2025", label: "2025" },
    department: { id: "14", label: "软件与物联网工程学院" },
    majors: [{ id: "080902", label: "软件工程" }],
  }], "2026-08-26T00:00:00.000Z");
}

export function softwareEngineeringQuery(overrides: Partial<CaptureQuery> = {}): CaptureQuery {
  const dictionary = softwareEngineeringDictionary();
  return {
    schemaVersion: dictionary.schemaVersion,
    queryId: "main-2025-14-080902",
    kind: "main",
    dimensions: {
      grade: "2025",
      departmentCode: "14",
      departmentName: "软件与物联网工程学院",
      majorCode: "080902",
      majorName: "软件工程",
      studyKind: "主修",
      majorDirection: "",
    },
    filters: { grade: "2025", department: "14", major: "080902", majorDirection: "", studyKind: "主修" },
    status: "complete",
    declaredRecordCount: 5,
    capturedRecordCount: 5,
    pageCount: 1,
    requestParameters: { nj: "2025", dwh: "14", zydm: "080902", zyfx: "", zxfx: "1", tableId: "6099001" },
    ...overrides,
  };
}

export async function softwareEngineeringPackage(overrides: Partial<CapturePackageInput> = {}): Promise<CapturePackageInput> {
  const sourceDictionary = softwareEngineeringDictionary();
  const queries = overrides.queries ?? [softwareEngineeringQuery()];
  return {
    batchId: "se-2025-pilot",
    status: "complete",
    sourceDictionarySha256: sourceDictionary.sha256,
    sourceDictionary,
    queries,
    snapshots: overrides.snapshots ?? [{ queryId: queries[0].queryId, page: 1, bytes: await softwareEngineeringFixtureBytes() }],
    coverage: overrides.coverage ?? coverageFromQueries("se-2025-pilot", sourceDictionary, queries),
    ...overrides,
  };
}
