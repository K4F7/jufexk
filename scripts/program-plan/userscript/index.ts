import { discoverFilterFields, discoverFormAction, discoverTableId, findStudyKindValue, parseSelectOptions } from "../parse-table";
import { CollectorEngine, DirectoryUnavailableError, buildFormBody, buildPageRequest, createCollectorState, type CollectorQuery, type CollectorState, type PageResponse } from "./collector-core";

declare global {
  interface Window { showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>; }
  interface FileSystemHandle { queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>; requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>; }
}

const DB_NAME = "jufexk-program-plan-collector-v1";
const STORE = "checkpoint";
const SCHEMA = "program-plan-capture-package/v1" as const;
let state: CollectorState | undefined;
let directory: FileSystemDirectoryHandle | undefined;
let engine: CollectorEngine | undefined;
let frozenDictionary: SourceDictionary | undefined;
let coverageSeeds: CoverageSeed[] = [];
let pageContext: { tableId?: string; formAction?: string; fields?: NonNullable<ReturnType<typeof discoverFilterFields>> } = {};

interface SourceOption { id: string; label: string }
interface CascadeNode { grade: SourceOption; department: SourceOption; majors: SourceOption[] }
interface SourceDictionary {
  schemaVersion: typeof SCHEMA;
  grades: SourceOption[];
  departments: SourceOption[];
  majors: SourceOption[];
  studyKinds: SourceOption[];
  cascade: CascadeNode[];
  capturedAt: string;
  sha256: string;
}
interface CoverageSeed {
  grade: string;
  departmentCode: string;
  departmentName: string;
  majorCode: string;
  majorName: string;
  studyKind: "主修";
  status: "complete" | "empty" | "exception";
  queryId?: string;
  declaredRecordCount?: number;
  reason?: string;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(key: string, value: unknown) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareText(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function sha256(bytes: Uint8Array | string) {
  const value = Uint8Array.from(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value.buffer as ArrayBuffer))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blank";
}

function optionYear(option: SourceOption) {
  const token = /^\d{4}$/.test(option.id) ? option.id : option.label.match(/\d{4}/)?.[0];
  return token ? Number(token) : Number.NaN;
}

function currentGrades(options: SourceOption[], now = new Date()) {
  const years = options.filter((option) => Number.isSafeInteger(optionYear(option)));
  const incoming = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const window = new Set([incoming, incoming - 1, incoming - 2, incoming - 3].map(String));
  const inWindow = years.filter((option) => window.has(String(optionYear(option))));
  return [...(inWindow.length ? inWindow : years.slice(0, 4))].sort((left, right) => optionYear(left) - optionYear(right));
}

function readSelect(idOrName: string): HTMLSelectElement {
  const select = document.querySelector(`#${idOrName}, select[name="${idOrName}"]`) as HTMLSelectElement | null;
  if (!select) throw new Error(`missing select ${idOrName}`);
  return select;
}

function optionsOf(select: HTMLSelectElement): SourceOption[] {
  return Array.from(select.options).filter((option) => option.value && !/请选择|全部/.test(option.text.trim())).map((option) => ({ id: option.value, label: option.text.trim() }));
}

function isProgramPlanPage() {
  if (location.pathname === "/student/wsxk.kcbcx10319.html") return false;
  const html = document.documentElement.outerHTML;
  return /理论课程/.test(document.title + html) && !!discoverFilterFields(html);
}

function refreshPageContext() {
  const html = document.documentElement.outerHTML;
  const fields = discoverFilterFields(html);
  if (!fields) throw new Error("培养方案理论课程筛选未找到：需要年级、院(系)/部、专业");
  pageContext = { tableId: discoverTableId(html), formAction: discoverFormAction(html) || location.pathname, fields };
  return fields;
}

async function setSelect(select: HTMLSelectElement, value: string, dependent?: HTMLSelectElement) {
  const before = dependent ? dependent.innerHTML : "";
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  select.dispatchEvent(new Event("input", { bubbles: true }));
  if (!dependent) return;
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (dependent.innerHTML !== before || optionsOf(dependent).length) return;
  }
}

function makeQuery(grade: SourceOption, department: SourceOption, major: SourceOption, fieldNames: Record<string, string>, studyKindValue: string): CollectorQuery {
  return {
    schemaVersion: SCHEMA,
    queryId: `main-${safeId(grade.id)}-${safeId(department.id)}-${safeId(major.id)}`,
    kind: "main",
    dimensions: {
      grade: grade.id,
      departmentCode: department.id,
      departmentName: department.label,
      majorCode: major.id,
      majorName: major.label,
      studyKind: "主修",
      majorDirection: "",
    },
    filters: { grade: grade.id, department: department.id, major: major.id, majorDirection: "", studyKind: "主修" },
    requestParameters: {
      initQry: "0",
      [fieldNames.grade]: grade.id,
      [fieldNames.department]: department.id,
      [fieldNames.major]: major.id,
      ...(fieldNames.direction ? { [fieldNames.direction]: "" } : {}),
      ...(fieldNames.studyKind ? { [fieldNames.studyKind]: studyKindValue } : {}),
      ...(pageContext.tableId ? { tableId: pageContext.tableId } : {}),
      ...(pageContext.formAction ? { formAction: pageContext.formAction } : {}),
    },
    status: "pending",
    declaredRecordCount: 0,
    capturedRecordCount: 0,
    pageCount: 0,
    nextPage: 1,
    attempts: 0,
  };
}

async function discoverCascade(mode: "single" | "full") {
  const fields = refreshPageContext();
  const gradeSelect = readSelect(fields.grade.id || fields.grade.name);
  const departmentSelect = readSelect(fields.department.id || fields.department.name);
  const majorSelect = readSelect(fields.major.id || fields.major.name);
  const directionSelect = fields.direction ? readSelect(fields.direction.id || fields.direction.name) : undefined;
  const studySelect = fields.studyKind ? readSelect(fields.studyKind.id || fields.studyKind.name) : undefined;
  const studyKindValue = fields.studyKind ? findStudyKindValue(document.documentElement.outerHTML, fields.studyKind) : "主修";
  if (!studyKindValue) throw new Error("未找到主修选项");
  if (studySelect) await setSelect(studySelect, studyKindValue);
  if (directionSelect) await setSelect(directionSelect, "");
  const grades = mode === "single" ? optionsOf(gradeSelect).filter((option) => option.id === gradeSelect.value) : currentGrades(optionsOf(gradeSelect));
  if (!grades.length) throw new Error("年级下拉没有当前在校年级");
  const cascade: CascadeNode[] = [];
  coverageSeeds = [];
  const fieldNames = {
    grade: fields.grade.name || fields.grade.id,
    department: fields.department.name || fields.department.id,
    major: fields.major.name || fields.major.id,
    direction: fields.direction?.name || fields.direction?.id || "",
    studyKind: fields.studyKind?.name || fields.studyKind?.id || "",
  };
  const queries: CollectorQuery[] = [];
  for (const grade of grades) {
    await setSelect(gradeSelect, grade.id, departmentSelect);
    const departments = mode === "single" ? optionsOf(departmentSelect).filter((option) => option.id === departmentSelect.value) : optionsOf(departmentSelect);
    if (!departments.length) {
      coverageSeeds.push({ grade: grade.id, departmentCode: "", departmentName: "", majorCode: "", majorName: "", studyKind: "主修", status: "exception", reason: "department_has_no_majors" });
      continue;
    }
    for (const department of departments) {
      await setSelect(departmentSelect, department.id, majorSelect);
      const majors = mode === "single" ? optionsOf(majorSelect).filter((option) => option.id === majorSelect.value) : optionsOf(majorSelect);
      cascade.push({ grade, department, majors });
      if (!majors.length) {
        coverageSeeds.push({ grade: grade.id, departmentCode: department.id, departmentName: department.label, majorCode: "", majorName: "", studyKind: "主修", status: "exception", reason: "department_has_no_majors" });
        continue;
      }
      for (const major of majors) {
        const query = makeQuery(grade, department, major, fieldNames, studyKindValue);
        queries.push(query);
        coverageSeeds.push({
          grade: grade.id,
          departmentCode: department.id,
          departmentName: department.label,
          majorCode: major.id,
          majorName: major.label,
          studyKind: "主修",
          status: "complete",
          queryId: query.queryId,
        });
      }
    }
  }
  const content = {
    schemaVersion: SCHEMA,
    grades: [...new Map(cascade.map((node) => [node.grade.id, node.grade])).values()],
    departments: [...new Map(cascade.map((node) => [node.department.id, node.department])).values()],
    majors: [...new Map(cascade.flatMap((node) => node.majors.map((major) => [major.id, major] as const))).values()],
    studyKinds: [{ id: "主修", label: "主修" }],
    cascade,
    capturedAt: new Date().toISOString(),
  };
  frozenDictionary = { ...content, sha256: await sha256(stableJson({ ...content, capturedAt: undefined })) };
  return queries;
}

async function ensureDirectoryPermission() {
  if (!directory) throw new DirectoryUnavailableError("capture directory is not selected");
  const permission = await directory.queryPermission?.({ mode: "readwrite" });
  if (permission !== "granted") {
    const requested = await directory.requestPermission?.({ mode: "readwrite" });
    if (requested !== "granted") throw new DirectoryUnavailableError("capture directory permission lost");
  }
}

async function directoryFor(path: string[]) {
  await ensureDirectoryPermission();
  let current = directory!;
  for (const part of path) current = await current.getDirectoryHandle(part, { create: true });
  return current;
}

async function writePath(path: string, bytes: Uint8Array | string) {
  const parts = path.split("/");
  const filename = parts.pop()!;
  const dir = await directoryFor(parts);
  const file = await dir.getFileHandle(filename, { create: true });
  const writer = await file.createWritable();
  await writer.write(typeof bytes === "string" ? bytes : bytes.buffer as ArrayBuffer);
  await writer.close();
}

async function resetQuerySnapshots(queryId: string) {
  const snapshots = await directoryFor(["snapshots"]);
  try {
    await snapshots.removeEntry(queryId, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
}

async function requestPage(query: CollectorQuery, page: number): Promise<PageResponse> {
  const { endpoint, requestParameters } = buildPageRequest(query, page, {
    tableId: pageContext.tableId,
    clientWidth: document.body.clientWidth,
    formAction: pageContext.formAction,
  });
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    redirect: "follow",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildFormBody(requestParameters),
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  return { status: response.status, url: response.url, headers, bytes: new Uint8Array(await response.arrayBuffer()) };
}

async function hasDirectoryPermission() {
  return !!directory && (await directory.queryPermission?.({ mode: "readwrite" })) === "granted";
}

async function writeLiveArtifacts(next: CollectorState) {
  if (!await hasDirectoryPermission()) return;
  await writePath("checkpoint.json", `${JSON.stringify({ schemaVersion: SCHEMA, ...next }, null, 2)}\n`);
  await writePath("queries.partial.jsonl", `${next.queries.map((query) => JSON.stringify(query)).join("\n")}\n`);
}

async function saveCheckpoint(next: CollectorState) {
  state = next;
  await dbPut("state", next);
  if (directory) await dbPut("directory", directory);
  try {
    await writeLiveArtifacts(next);
  } catch (error) {
    next.phase = "directory_unavailable";
    next.log.push({ at: new Date().toISOString(), event: "directory_unavailable", detail: error instanceof Error ? error.message : String(error) });
    await dbPut("state", next);
    render();
    throw new DirectoryUnavailableError("capture directory is temporarily unavailable");
  }
  render();
}

function createEngine() {
  return new CollectorEngine({
    request: requestPage,
    writeSnapshot: async (id, page, bytes) => writePath(`snapshots/${id}/page-${String(page).padStart(4, "0")}.html`, bytes),
    resetQuerySnapshots,
    saveCheckpoint,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date().toISOString(),
    random: Math.random,
  });
}

function counts() {
  const statuses: Record<string, number> = {};
  for (const query of state?.queries ?? []) statuses[query.status] = (statuses[query.status] ?? 0) + 1;
  return statuses;
}

function finalizeCoverage() {
  const byId = new Map((state?.queries ?? []).map((query) => [query.queryId, query]));
  return {
    schemaVersion: "program-plan-coverage/v1",
    batchId: state?.batchId ?? "",
    grades: frozenDictionary?.grades.map((grade) => grade.id) ?? [],
    entries: coverageSeeds.map((entry) => {
      if (!entry.queryId) return entry;
      const query = byId.get(entry.queryId);
      if (!query) return { ...entry, status: "exception" as const, reason: "query_missing" };
      if (query.status === "exception" || query.status === "failed") return { ...entry, status: "exception" as const, declaredRecordCount: query.declaredRecordCount, reason: "query_failed" };
      if (query.status === "complete" && query.declaredRecordCount === 0) return { ...entry, status: "empty" as const, declaredRecordCount: 0, reason: "empty_result" };
      return { ...entry, status: "complete" as const, declaredRecordCount: query.declaredRecordCount };
    }),
  };
}

async function exportPackage() {
  if (!state || !frozenDictionary) throw new Error("no capture state");
  await ensureDirectoryPermission();
  const queries = state.queries.map(({ nextPage, attempts, lastError, ...query }) => query);
  const queryText = `${queries.map((query) => JSON.stringify(query)).join("\n")}\n`;
  await writePath("queries.jsonl", queryText);
  const files: Array<{ path: string; bytes: number; records: number; sha256: string }> = [];
  const add = async (path: string, bytes: Uint8Array | string, records: number) => {
    const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    files.push({ path, bytes: data.byteLength, records, sha256: await sha256(data) });
  };
  await add("queries.jsonl", queryText, queries.length);
  const dictionaryText = `${JSON.stringify(frozenDictionary, null, 2)}\n`;
  await writePath("source-dictionary.json", dictionaryText);
  await add("source-dictionary.json", dictionaryText, 1);
  const coverage = finalizeCoverage();
  const coverageText = `${JSON.stringify(coverage, null, 2)}\n`;
  await writePath("coverage.json", coverageText);
  await add("coverage.json", coverageText, coverage.entries.length);
  const logText = `${state.log.map((item) => JSON.stringify({ schemaVersion: SCHEMA, ...item })).join("\n")}\n`;
  await writePath("run-log.jsonl", logText);
  await add("run-log.jsonl", logText, state.log.length);
  await writePath("checkpoint.json", `${JSON.stringify({ schemaVersion: SCHEMA, ...state }, null, 2)}\n`);
  for (const query of state.queries) {
    for (let page = 1; page <= query.pageCount && page < query.nextPage; page += 1) {
      const path = `snapshots/${query.queryId}/page-${String(page).padStart(4, "0")}.html`;
      const parts = path.split("/");
      const name = parts.pop()!;
      const handle = await (await directoryFor(parts)).getFileHandle(name);
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      await add(path, bytes, 1);
    }
  }
  files.sort((left, right) => compareText(left.path, right.path));
  const exceptionCount = coverage.entries.filter((entry) => entry.status === "exception").length + (counts().exception ?? 0);
  const manifestContent = {
    schemaVersion: SCHEMA,
    batchId: state.batchId,
    status: exceptionCount ? "complete_with_exceptions" : "complete",
    sourceDictionarySha256: frozenDictionary.sha256,
    counts: {
      queries: queries.length,
      pages: files.filter((file) => file.path.startsWith("snapshots/")).length,
      records: queries.reduce((sum, query) => sum + (query.capturedRecordCount ?? (query.status === "complete" ? query.declaredRecordCount : 0)), 0),
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      statuses: counts(),
    },
    files,
  };
  const manifest = { ...manifestContent, manifestContentSha256: await sha256(stableJson(manifestContent)) };
  await writePath("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
}

async function runToTerminal() {
  if (!state) return;
  engine = createEngine();
  engine.resume();
  await engine.run(state);
  if (state.phase === "complete") await exportPackage();
  render();
}

async function start(mode: "single" | "full") {
  if (!window.showDirectoryPicker) throw new Error("File System Access API unavailable; use Chrome/Edge");
  if (state && !window.confirm(`现有批次 ${state.batchId} 将保留在原目录。确认开始新的 ${mode} 批次？`)) return;
  directory = await window.showDirectoryPicker({ mode: "readwrite", id: "jufexk-program-plan-capture" });
  const queries = await discoverCascade(mode);
  state = createCollectorState(`${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`, queries);
  await dbPut("dictionary", frozenDictionary);
  await dbPut("coverage", coverageSeeds);
  if (frozenDictionary) await writePath("source-dictionary.json", `${JSON.stringify(frozenDictionary, null, 2)}\n`);
  await runToTerminal();
}

async function resume() {
  state = state ?? await dbGet<CollectorState>("state");
  directory = directory ?? await dbGet<FileSystemDirectoryHandle>("directory");
  frozenDictionary = frozenDictionary ?? await dbGet<SourceDictionary>("dictionary");
  coverageSeeds = coverageSeeds.length ? coverageSeeds : (await dbGet<CoverageSeed[]>("coverage") ?? []);
  if (!state) throw new Error("no checkpoint");
  refreshPageContext();
  await ensureDirectoryPermission();
  await runToTerminal();
}

async function retryExceptions() {
  if (!state) throw new Error("no checkpoint");
  const exceptions = state.queries.filter((query) => query.status === "exception");
  if (!exceptions.length) throw new Error("no exception queries");
  for (const query of exceptions) {
    await resetQuerySnapshots(query.queryId);
    query.status = "pending";
    query.nextPage = 1;
    query.pageCount = 0;
    query.declaredRecordCount = 0;
    query.capturedRecordCount = 0;
    query.lastError = undefined;
  }
  state.phase = "paused";
  await saveCheckpoint(state);
  await resume();
}

const phaseLabels: Record<CollectorState["phase"], string> = {
  idle: "待开始",
  running: "采集中",
  paused: "已暂停",
  session_expired: "等待重新登录",
  directory_unavailable: "等待目录授权",
  circuit_open: "已安全熔断",
  stopped: "已停止",
  complete: "采集完成",
};

function render() {
  const root = document.querySelector("#jufexk-program-plan-panel") as HTMLElement | null;
  if (!root) return;
  const queries = state?.queries ?? [];
  const completed = queries.filter((query) => query.status === "complete").length;
  const exceptions = queries.filter((query) => query.status === "exception").length;
  const current = queries.find((query) => query.status !== "complete" && query.status !== "exception");
  const percent = queries.length ? Math.round((completed + exceptions) / queries.length * 100) : 0;
  (root.querySelector("[data-phase]") as HTMLElement).textContent = state ? phaseLabels[state.phase] : "待开始";
  (root.querySelector("[data-progress]") as HTMLElement).textContent = state ? `${completed + exceptions} / ${queries.length} 查询 · ${percent}%` : "尚未创建计划";
  (root.querySelector("[data-current]") as HTMLElement).textContent = current
    ? `${current.dimensions.grade} · ${current.dimensions.departmentName} · ${current.dimensions.majorName} · 第 ${current.nextPage}${current.pageCount ? `/${current.pageCount}` : ""} 页`
    : state?.phase === "complete" ? "全部查询已到终态" : "-";
  (root.querySelector("[data-bar]") as HTMLElement).style.width = `${percent}%`;
  (root.querySelector("[data-exceptions]") as HTMLElement).textContent = exceptions ? `${exceptions} 个例外待定向补跑` : "无例外";
  const events = (state?.log ?? []).slice(-6).reverse();
  (root.querySelector("[data-log]") as HTMLElement).innerHTML = events.map((item) => `<li><time>${item.at.slice(11, 19)}</time><span>${item.event}${item.queryId ? ` · ${item.queryId}` : ""}</span></li>`).join("") || "<li>暂无事件</li>";
  const running = state?.phase === "running";
  (root.querySelector('[data-action="start"]') as HTMLButtonElement).disabled = !!state && running;
  (root.querySelector('[data-action="pause"]') as HTMLButtonElement).disabled = !running;
  (root.querySelector('[data-action="resume"]') as HTMLButtonElement).disabled = !state || running || state.phase === "complete";
  (root.querySelector('[data-action="retry"]') as HTMLButtonElement).disabled = !exceptions;
}

function showError(error: unknown) {
  const root = document.querySelector("#jufexk-program-plan-panel") as HTMLElement | null;
  if (root) (root.querySelector("[data-error]") as HTMLElement).textContent = error instanceof Error ? error.message : String(error);
}

function mount() {
  if (!isProgramPlanPage() || document.querySelector("#jufexk-program-plan-panel")) return;
  const panel = document.createElement("section");
  panel.id = "jufexk-program-plan-panel";
  panel.innerHTML = `<style>#jufexk-program-plan-panel{position:fixed;right:12px;top:12px;z-index:2147483647;width:min(390px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;background:#fff;border:1px solid #b42318;border-top:4px solid #b42318;border-radius:6px;padding:14px;font:14px/1.45 system-ui;color:#252525;box-shadow:0 8px 28px #0003}#jufexk-program-plan-panel h2{font-size:17px;margin:0}#jufexk-program-plan-panel [data-phase]{font-weight:700;color:#b42318}#jufexk-program-plan-panel .meta{display:grid;gap:4px;background:#f6f6f6;padding:10px;border-radius:4px}#jufexk-program-plan-panel .track{height:8px;background:#ddd;margin:10px 0;border-radius:4px;overflow:hidden}#jufexk-program-plan-panel [data-bar]{height:100%;background:#16794b;width:0}#jufexk-program-plan-panel select{width:100%;padding:8px;border:1px solid #aaa;border-radius:4px}#jufexk-program-plan-panel .commands{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}#jufexk-program-plan-panel button{min-height:36px;border:1px solid #aaa;border-radius:4px;background:#fff;font-weight:600}#jufexk-program-plan-panel button[data-action="start"],#jufexk-program-plan-panel button[data-action="resume"]{background:#b42318;color:#fff;border-color:#b42318}#jufexk-program-plan-panel button:disabled{opacity:.45}#jufexk-program-plan-panel ul{list-style:none;margin:6px 0 0;padding:0;font-size:12px}#jufexk-program-plan-panel [data-error]{color:#b42318;font-weight:600;min-height:20px}</style><header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2>选课志培养方案采集</h2><span data-phase>载入中</span></header><div class="meta"><strong data-progress>读取检查点...</strong><span data-current>-</span><span data-exceptions>无例外</span></div><div class="track"><div data-bar></div></div><label>运行范围<select data-mode><option value="single">当前年级×专业</option><option value="full" selected>四个年级 × 全部主修专业</option></select></label><div class="commands"><button data-action="start">开始新批次</button><button data-action="pause">暂停</button><button data-action="resume">授权并继续</button><button data-action="retry">重跑例外</button><button data-action="stop">安全停止</button><button data-action="export">立即整理包</button></div><div data-error></div><details><summary>最近事件</summary><ul data-log></ul></details>`;
  document.body.appendChild(panel);
  panel.querySelectorAll("button[data-action]").forEach((button) => { (button as HTMLButtonElement).type = "button"; });
  panel.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button[data-action]") as HTMLButtonElement | null;
    if (!button) return;
    event.preventDefault();
    const action = button.dataset.action;
    const run = async () => {
      showError("");
      if (action === "start") await start((((panel.querySelector("[data-mode]") as unknown) as HTMLSelectElement).value as "single" | "full"));
      else if (action === "pause") engine?.pause();
      else if (action === "resume") await resume();
      else if (action === "retry") await retryExceptions();
      else if (action === "stop") engine?.stop();
      else if (action === "export") await exportPackage();
    };
    void run().catch(showError);
  });
  void Promise.all([dbGet<CollectorState>("state"), dbGet<FileSystemDirectoryHandle>("directory"), dbGet<SourceDictionary>("dictionary"), dbGet<CoverageSeed[]>("coverage")]).then(([savedState, savedDirectory, savedDictionary, savedCoverage]) => {
    state = savedState;
    directory = savedDirectory;
    frozenDictionary = savedDictionary;
    coverageSeeds = savedCoverage ?? [];
    render();
  }).catch(showError);
}

mount();
