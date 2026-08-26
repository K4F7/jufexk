import { buildFormBody, buildPageRequest } from "../catalog-baseline/userscript/collector-core";
import { parseJwxtTableHtml } from "../../src/lib/jwxt-table";
import type { JwxtOffering } from "../../src/lib/jwxt-offering";
import type { JwxtSyncMode } from "../../src/jwxt-sync-publication";

const ENTRY_PATH = "/student/wsxk.kcbcx10319.html?menucode=S2020103";

export type RedactedJwxtCapture = {
  capturedAt: string;
  complete: boolean;
  offerings: Array<{
    courseCode: string;
    courseName: string;
    section: string;
    teacherName: string;
    termId: string;
    campus: string;
    weekText: string;
    timeText: string;
    place: string;
  }>;
};

export interface AuthAdapter {
  request(path: string, init?: RequestInit): Promise<Response>;
}

export type CollectorCheckpoint = {
  schemaVersion: 1;
  mode: "full" | "resume";
  dimensions: Array<{ term: string; level: string; grade: string }>;
  dimensionIndex: number;
  nextPage: number;
  pageCount: number;
  offerings: RedactedJwxtCapture["offerings"];
};

export type CollectorCheckpointOptions = {
  resume?: CollectorCheckpoint;
  save?: (checkpoint: CollectorCheckpoint) => Promise<void>;
};

export type JwxtTextDecoder = (bytes: Uint8Array) => string;

function selectedId(items: { id: string; label: string }[], selected?: { id: string } | null) {
  return selected?.id || items[0]?.id || "";
}

function requestParameters(term: string, level: string, grade: string) {
  const [xn = "", xq = ""] = term.split(",");
  return {
    initQry: "0", xktype: "2", xn, xq, nj: grade, pycc: level, dwh: "", zydm: "",
    kclb1: "", kclb2: "", isbyk: "", items: "", xnxq: term, sel_pycc: level,
    sel_nj: grade, sel_yxb: "", sel_zydm: "", kcmk: "", sel_schoolarea: "",
    sel_kclb1: "", sel_kclb2: "", sel_kc: "", sel_rkjs: "", sel_cddwdm: "",
    menucode_current: "S2020103",
  };
}

async function responseBytes(response: Response) {
  if (!response.ok) throw new Error(`jwxt_http_${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function redact(offering: JwxtOffering, termId: string) {
  return {
    courseCode: offering.courseCode,
    courseName: offering.courseName,
    section: offering.section,
    teacherName: offering.teacherName,
    termId,
    campus: offering.campus,
    weekText: offering.weekText,
    timeText: offering.timeText,
    place: offering.place,
  };
}

export async function collectJwxt(
  adapter: AuthAdapter,
  mode: JwxtSyncMode | "resume",
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  checkpointOptions: CollectorCheckpointOptions = {},
  decode: JwxtTextDecoder = (bytes) => new TextDecoder("gbk").decode(bytes),
): Promise<RedactedJwxtCapture> {
  const entry = await adapter.request(ENTRY_PATH, { headers: { accept: "text/html" } });
  const entryHtml = decode(await responseBytes(entry));
  const discovery = parseJwxtTableHtml(entryHtml);
  if (!discovery.ok) throw new Error(`jwxt_discovery_${discovery.kind}`);
  const selectedTerm = selectedId(discovery.filters.terms, discovery.termSelect.selected);
  const selectedLevel = selectedId(
    discovery.filters.educationLevels,
    discovery.educationLevelSelect.selected,
  );
  const selectedGrade = selectedId(discovery.filters.grades, discovery.gradeSelect.selected);
  if (!selectedTerm) throw new Error("jwxt_default_term_missing");
  const terms = mode === "full" || mode === "resume"
    ? discovery.filters.terms.map((item) => item.id)
    : [selectedTerm];
  const levels = mode === "pilot"
    ? [selectedLevel]
    : discovery.filters.educationLevels.map((item) => item.id);
  const grades = mode === "pilot"
    ? [selectedGrade]
    : discovery.filters.grades.map((item) => item.id);
  const dimensions = terms.flatMap((term) =>
    (levels.length ? levels : [""]).flatMap((level) =>
      (grades.length ? grades : [""]).map((grade) => ({ term, level, grade })),
    ),
  );
  const offerings = new Map<string, RedactedJwxtCapture["offerings"][number]>();
  const resumed = mode === "resume" ? checkpointOptions.resume : undefined;
  if (resumed) {
    if (
      resumed.schemaVersion !== 1 ||
      JSON.stringify(resumed.dimensions) !== JSON.stringify(dimensions) ||
      resumed.dimensionIndex < 0 ||
      resumed.dimensionIndex > dimensions.length ||
      resumed.nextPage < 1
    ) {
      throw new Error("jwxt_resume_checkpoint_invalid");
    }
    for (const row of resumed.offerings) {
      offerings.set(JSON.stringify([
        row.termId, row.courseCode, row.section, row.teacherName,
        row.campus, row.weekText, row.timeText, row.place,
      ]), row);
    }
  }
  for (let dimensionIndex = resumed?.dimensionIndex ?? 0; dimensionIndex < dimensions.length; dimensionIndex += 1) {
    const dimension = dimensions[dimensionIndex];
    const query = {
      requestParameters: requestParameters(
        dimension.term,
        dimension.level,
        dimension.grade,
      ),
    } as unknown as Parameters<typeof buildPageRequest>[0];
    let page = dimensionIndex === resumed?.dimensionIndex ? resumed.nextPage : 1;
    let pages = dimensionIndex === resumed?.dimensionIndex ? resumed.pageCount : 1;
    do {
      const request = buildPageRequest(query, page, 1462);
      let response: Response | null = null;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        response = await adapter.request(request.endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: buildFormBody(request.requestParameters),
        });
        if (response.status !== 429 && response.status < 500) break;
        if (attempt === 4) throw new Error(`jwxt_http_${response.status}`);
        await sleep([2_000, 5_000, 15_000][attempt - 1]);
      }
      const html = decode(await responseBytes(response!));
      const parsed = parseJwxtTableHtml(html);
      if (!parsed.ok) throw new Error(`jwxt_page_${parsed.kind}`);
      if (!parsed.pagination) throw new Error("jwxt_pagination_missing");
      if (parsed.pagination.page !== page) throw new Error("jwxt_pagination_changed");
      pages = parsed.pagination.pages;
      for (const item of parsed.offerings) {
        const row = redact(item, dimension.term);
        const key = JSON.stringify([
          row.termId, row.courseCode, row.section, row.teacherName,
          row.campus, row.weekText, row.timeText, row.place,
        ]);
        offerings.set(key, row);
      }
      page += 1;
      if ((mode === "full" || mode === "resume") && checkpointOptions.save) {
        await checkpointOptions.save({
          schemaVersion: 1,
          mode: "full",
          dimensions,
          dimensionIndex: page <= pages ? dimensionIndex : dimensionIndex + 1,
          nextPage: page <= pages ? page : 1,
          pageCount: page <= pages ? pages : 1,
          offerings: [...offerings.values()],
        });
      }
      await sleep(400 + Math.round(Math.random() * 400));
    } while (page <= pages);
  }

  return {
    capturedAt: new Date().toISOString(),
    complete: mode === "full" || mode === "resume",
    offerings: [...offerings.values()],
  };
}
