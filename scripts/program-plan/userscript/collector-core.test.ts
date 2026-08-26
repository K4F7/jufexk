import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { CollectorEngine, assertSnapshotSafe, buildFormBody, buildPageRequest, createCollectorState, parsePageMetadata, type CollectorDependencies, type CollectorQuery, type PageResponse } from "./collector-core";

function query(): CollectorQuery {
  return {
    schemaVersion: "program-plan-capture-package/v1",
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
    requestParameters: { nj: "2025", dwh: "14", zydm: "080902", tableId: "6099001" },
    status: "pending",
    declaredRecordCount: 0,
    capturedRecordCount: 0,
    pageCount: 0,
    nextPage: 1,
    attempts: 0,
  };
}

function page(current: number, total: number, records = total * 2, status = 200, url = "https://jwxt.jxufe.edu.cn/taglib/DataTable.jsp", rowCount = records === 0 ? 0 : current < total ? 2 : Math.max(0, records - 2 * (total - 1))): PageResponse {
  const rows = Array.from({ length: rowCount }, (_, index) => `<tr><td>2025-2026学年第一学期</td><td>[1010000${index}]课程</td></tr>`).join("");
  return {
    status,
    url,
    headers: {},
    bytes: iconv.encode(`<table id="keywords"><tbody>${rows}</tbody></table><script>parent.showTotalRecord('6099001','${records}');reloadPage('/taglib/DataTable.jsp',${total},${current});</script>`, "gbk"),
  };
}

function harness(responses: Array<PageResponse | Error>) {
  const writes: string[] = [];
  const sleeps: number[] = [];
  let index = 0;
  const dependencies: CollectorDependencies = {
    request: async () => {
      const value = responses[index++];
      if (value instanceof Error) throw value;
      return value;
    },
    writeSnapshot: async (id, pageNumber) => { writes.push(`${id}:${pageNumber}`); },
    resetQuerySnapshots: async () => undefined,
    saveCheckpoint: async () => undefined,
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => "2026-08-26T00:00:00.000Z",
    random: () => 0,
  };
  return { engine: new CollectorEngine(dependencies), writes, sleeps };
}

describe("program plan collector engine", () => {
  it("posts the discovered tableId instead of the catalog timetable id", () => {
    const first = buildPageRequest(query(), 1, { tableId: "6099001", clientWidth: 1462 });
    const later = buildPageRequest(query(), 2, { tableId: "6099001", clientWidth: 1462 });
    expect(first.endpoint).toBe("/taglib/DataTable.jsp?tableId=6099001&clientWidth=1462");
    expect(first.requestParameters).toMatchObject({ nj: "2025", zydm: "080902", initQry: "0" });
    expect(later.endpoint).toBe("/taglib/DataTable.jsp?currPageCount=2");
    expect(buildFormBody({ nj: "2025", zydm: "080902" })).toContain("btnSubmit=%CC%E1%BD%BB");
  });

  it("captures a single empty theoretical-course page as an auditable complete query", async () => {
    const h = harness([page(1, 0, 0)]);
    const state = createCollectorState("empty", [query()]);
    await h.engine.run(state);
    expect(h.writes).toEqual(["main-2025-14-080902:1"]);
    expect(state.queries[0]).toMatchObject({ status: "complete", declaredRecordCount: 0, pageCount: 1 });
  });

  it("resumes after session expiry without repeating a completed page", async () => {
    const expired = page(1, 1, 0, 200, "https://jwxt.jxufe.edu.cn/cas/login.action");
    const first = harness([expired]);
    const state = createCollectorState("resume", [query()]);
    await first.engine.run(state);
    expect(state.phase).toBe("session_expired");
    const second = harness([page(1, 1, 2)]);
    await second.engine.run(state);
    expect(second.writes).toEqual(["main-2025-14-080902:1"]);
    expect(state.phase).toBe("complete");
  });

  it("reads page metadata from a page that has no DataTable pagination script", () => {
    const bytes = iconv.encode("<table id='keywords'><thead><tr><th>学年学期</th><th>课程</th></tr></thead><tbody><tr><td>2025-2026学年第一学期</td><td>[10100001]高等数学A</td></tr></tbody></table>", "gbk");
    expect(parsePageMetadata(bytes)).toMatchObject({ totalRecords: 1, pageRecords: 1, currentPage: 1, totalPages: 1 });
  });

  it("rejects leftover ticket or student-id text before a snapshot is kept", () => {
    expect(() => assertSnapshotSafe(iconv.encode("<html>ticket=ST-1</html>", "gbk"))).toThrow(/ticket|personal/i);
    expect(() => assertSnapshotSafe(iconv.encode("<html>学号：2021001234</html>", "gbk"))).toThrow(/personal/i);
  });
});
