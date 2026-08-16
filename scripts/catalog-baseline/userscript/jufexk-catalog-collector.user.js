// ==UserScript==
// @name         选课志目录基线采集器
// @namespace    https://github.com/K4F7/jufexk
// @version      1.6.1
// @description  人工登录后串行采集 KINGOSOFT 课程目录原始页面
// @match        https://jwxt.jxufe.edu.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // scripts/catalog-baseline/userscript/collector-core.ts
  function buildPageRequest(query, page, clientWidth) {
    const requestParameters = page === 1 ? { ...query.requestParameters, initQry: "0" } : { tableId: "5327042", clientWidth: String(clientWidth), ...query.requestParameters, initQry: "0" };
    const endpoint = page === 1 ? `/taglib/DataTable.jsp?tableId=5327042&clientWidth=${clientWidth}` : `/taglib/DataTable.jsp?currPageCount=${page}`;
    return { endpoint, requestParameters };
  }
  function buildFormBody(parameters) {
    const parts = [];
    for (const [key, value] of Object.entries(parameters)) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      if (key === "xnxq") {
        parts.push("btnFilter=%C0%E0%B1%F0%B9%FD%C2%CB", "btnSubmit=%CC%E1%BD%BB");
      }
    }
    return parts.join("&");
  }
  var SessionExpiredError = class extends Error {
  };
  var DirectoryUnavailableError = class extends Error {
  };
  function parsePageMetadata(bytes) {
    const html = new TextDecoder("gbk").decode(bytes);
    const totalRecords = Number(/showTotalRecord\(\s*['"]5327042['"]\s*,\s*['"](\d+)['"]/.exec(html)?.[1] ?? "NaN");
    const pagination = /reloadPage\(\s*['"][^'"]+['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(html);
    if (!Number.isSafeInteger(totalRecords) || !pagination) throw new Error("page metadata missing");
    const table = /<table\b[^>]*\bid\s*=\s*["']keywords["'][^>]*>[\s\S]*?<\/table>/i.exec(html)?.[0];
    const body = table && /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1];
    const pageRecords = body ? (body.match(/<tr\b/gi) ?? []).length : 0;
    const totalPages = Number(pagination[1]);
    const currentPage = Number(pagination[2]);
    if (totalRecords === 0 && totalPages === 0 && currentPage === 1) {
      return { totalRecords, pageRecords, currentPage: 1, totalPages: 1, html };
    }
    if (!Number.isSafeInteger(currentPage) || currentPage < 1 || !Number.isSafeInteger(totalPages) || totalPages < 1) {
      throw new Error("invalid page metadata");
    }
    return { totalRecords, pageRecords, currentPage, totalPages, html };
  }
  function isSessionExpired(response) {
    if (/\/cas\/login\.action(?:$|[?#])/.test(response.url)) return true;
    const text = new TextDecoder("gbk").decode(response.bytes.slice(0, 8192));
    return /name=["']?(?:login|randnumber1)["']?|用户登录|验证码/.test(text);
  }
  function assertSnapshotSafe(bytes) {
    const text = new TextDecoder("gbk").decode(bytes);
    if (/\b(?:password|passwd|cookie|authorization|access[_-]?token|refresh[_-]?token|session[_-]?token)\b\s*["']?\s*[:=]/i.test(text)) {
      throw new Error("unsafe credential-like content in source page");
    }
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      const url = new URL(match[0]);
      if (url.protocol !== "https:" || url.hostname !== "jwxt.jxufe.edu.cn") {
        throw new Error(`unsafe cross-origin URL in source page: ${url.origin}`);
      }
    }
  }
  function retryDelay(attempt, random) {
    const base = [2e3, 5e3, 15e3][Math.min(attempt - 1, 2)];
    return Math.round(base * (0.85 + random * 0.3));
  }
  function retryAfterMilliseconds(value) {
    if (!value) return 6e4;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(6e4, seconds * 1e3);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(6e4, date - Date.now()) : 6e4;
  }
  var CollectorEngine = class {
    constructor(dependencies) {
      __publicField(this, "dependencies", dependencies);
      __publicField(this, "stopRequested", false);
      __publicField(this, "pauseRequested", false);
    }
    pause() {
      this.pauseRequested = true;
    }
    stop() {
      this.stopRequested = true;
    }
    resume() {
      this.pauseRequested = false;
      this.stopRequested = false;
    }
    log(state2, event, query, page, detail) {
      state2.log.push({ at: this.dependencies.now(), queryId: query?.queryId, page, event, detail });
      if (state2.log.length > 2e4) state2.log.splice(0, state2.log.length - 2e4);
    }
    async run(state2) {
      state2.phase = "running";
      await this.dependencies.saveCheckpoint(state2);
      for (const query of state2.queries) {
        if (query.status === "complete") continue;
        if (this.stopRequested) return this.transition(state2, "stopped", "stopped");
        if (this.pauseRequested) return this.transition(state2, "paused", "paused");
        const result = await this.runQuery(state2, query);
        if (result !== "continue") return state2;
      }
      return this.transition(state2, "complete", "batch_complete");
    }
    async runQuery(state2, query) {
      query.status = "pending";
      if (!Number.isSafeInteger(query.capturedRecordCount)) {
        if (query.nextPage > 1) {
          query.nextPage = 1;
          query.pageCount = 0;
          query.declaredRecordCount = 0;
          try {
            await this.dependencies.resetQuerySnapshots(query.queryId);
          } catch (error) {
            if (error instanceof DirectoryUnavailableError) {
              query.lastError = error.message;
              await this.transition(state2, "directory_unavailable", "directory_unavailable", query, 1);
              return "halt";
            }
            throw error;
          }
        }
        query.capturedRecordCount = 0;
      }
      let validationFailures = 0;
      while (query.pageCount === 0 || query.nextPage <= query.pageCount) {
        if (this.stopRequested) {
          await this.transition(state2, "stopped", "stopped", query, query.nextPage);
          return "halt";
        }
        if (this.pauseRequested) {
          await this.transition(state2, "paused", "paused", query, query.nextPage);
          return "halt";
        }
        let response;
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          try {
            response = await this.dependencies.request(query, query.nextPage);
            if (isSessionExpired(response)) throw new SessionExpiredError("login required");
            if (response.status === 429) {
              state2.consecutiveServerFailures += 1;
              if (state2.consecutiveServerFailures >= 2) return this.circuit(state2, query, "consecutive HTTP 429");
              this.log(state2, "retry", query, query.nextPage, "HTTP 429");
              await this.dependencies.sleep(retryAfterMilliseconds(response.headers["retry-after"]));
              continue;
            }
            if (response.status >= 500) {
              state2.consecutiveServerFailures += 1;
              if (state2.consecutiveServerFailures >= 2) return this.circuit(state2, query, `consecutive HTTP ${response.status}`);
              throw new Error(`HTTP ${response.status}`);
            }
            if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
            state2.consecutiveServerFailures = 0;
            break;
          } catch (error) {
            if (error instanceof SessionExpiredError) {
              query.lastError = error.message;
              await this.transition(state2, "session_expired", "session_expired", query, query.nextPage);
              return "halt";
            }
            if (error instanceof DirectoryUnavailableError) {
              query.lastError = error.message;
              await this.transition(state2, "directory_unavailable", "directory_unavailable", query, query.nextPage);
              return "halt";
            }
            query.attempts += 1;
            query.lastError = error instanceof Error ? error.message : String(error);
            if (attempt === 4) {
              query.status = "exception";
              this.log(state2, "coverage_exception", query, query.nextPage, query.lastError);
              await this.dependencies.saveCheckpoint(state2);
              return "continue";
            }
            this.log(state2, "retry", query, query.nextPage, query.lastError);
            await this.dependencies.sleep(retryDelay(attempt, this.dependencies.random()));
          }
        }
        if (!response) continue;
        try {
          assertSnapshotSafe(response.bytes);
          const metadata = parsePageMetadata(response.bytes);
          if (metadata.currentPage !== query.nextPage) throw new Error(`expected page ${query.nextPage}, received ${metadata.currentPage}`);
          if (query.pageCount === 0) {
            query.pageCount = metadata.totalPages;
            query.declaredRecordCount = metadata.totalRecords;
          } else if (query.pageCount !== metadata.totalPages || query.declaredRecordCount !== metadata.totalRecords) {
            throw new Error("server pagination changed during query");
          }
          const projectedRecords = query.capturedRecordCount + metadata.pageRecords;
          if (projectedRecords > metadata.totalRecords) throw new Error("page rows exceed declared query total");
          if (metadata.currentPage < metadata.totalPages && projectedRecords >= metadata.totalRecords) throw new Error("query total reached before final page");
          if (metadata.currentPage === metadata.totalPages && projectedRecords !== metadata.totalRecords) {
            throw new Error(`query row count mismatch: expected ${metadata.totalRecords}, received ${projectedRecords}`);
          }
        } catch (error) {
          validationFailures += 1;
          query.attempts += 1;
          query.lastError = error instanceof Error ? error.message : String(error);
          if (validationFailures >= 2) {
            query.status = "exception";
            this.log(state2, "coverage_exception", query, query.nextPage, query.lastError);
            await this.dependencies.saveCheckpoint(state2);
            return "continue";
          }
          this.log(state2, "query_validation_retry", query, query.nextPage, query.lastError);
          query.nextPage = 1;
          query.pageCount = 0;
          query.declaredRecordCount = 0;
          query.capturedRecordCount = 0;
          try {
            await this.dependencies.resetQuerySnapshots(query.queryId);
          } catch (resetError) {
            if (resetError instanceof DirectoryUnavailableError) {
              query.lastError = resetError.message;
              await this.transition(state2, "directory_unavailable", "directory_unavailable", query, 1);
              return "halt";
            }
            throw resetError;
          }
          await this.dependencies.saveCheckpoint(state2);
          await this.dependencies.sleep(retryDelay(1, this.dependencies.random()));
          continue;
        }
        try {
          await this.dependencies.writeSnapshot(query.queryId, query.nextPage, response.bytes);
        } catch (error) {
          if (error instanceof DirectoryUnavailableError) {
            query.lastError = error.message;
            await this.transition(state2, "directory_unavailable", "directory_unavailable", query, query.nextPage);
            return "halt";
          }
          throw error;
        }
        this.log(state2, "page_complete", query, query.nextPage);
        query.capturedRecordCount += parsePageMetadata(response.bytes).pageRecords;
        query.nextPage += 1;
        state2.pagesSinceLongPause += 1;
        await this.dependencies.saveCheckpoint(state2);
        if (state2.pagesSinceLongPause >= 100) {
          await this.dependencies.sleep(1e4);
          state2.pagesSinceLongPause = 0;
        } else {
          await this.dependencies.sleep(400 + Math.round(this.dependencies.random() * 400));
        }
      }
      query.status = "complete";
      query.lastError = void 0;
      this.log(state2, "query_complete", query);
      await this.dependencies.saveCheckpoint(state2);
      return "continue";
    }
    async circuit(state2, query, detail) {
      query.lastError = detail;
      await this.transition(state2, "circuit_open", "circuit_open", query, query.nextPage, detail);
      return "halt";
    }
    async transition(state2, phase, event, query, page, detail) {
      state2.phase = phase;
      this.log(state2, event, query, page, detail);
      await this.dependencies.saveCheckpoint(state2);
      return state2;
    }
  };
  function createCollectorState(batchId, queries) {
    return { batchId, phase: "idle", queries, consecutiveServerFailures: 0, pagesSinceLongPause: 0, sourceChangeRounds: 0, unresolvedSourceChanges: 0, log: [] };
  }

  // scripts/catalog-baseline/userscript/index.ts
  var DB_NAME = "jufexk-catalog-collector-v1";
  var STORE = "checkpoint";
  var QUERY_FILTERS = { department: "", major: "", campus: "", category: "", courseName: "", teacherName: "", homeUnit: "" };
  var state;
  var directory;
  var engine;
  var frozenDictionary;
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function dbGet(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE);
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function dbPut(key, value) {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compareText(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
    return JSON.stringify(value);
  }
  async function sha256(bytes) {
    const value = Uint8Array.from(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value.buffer))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function options(id) {
    const select = document.querySelector(`#${id}`);
    if (!select) throw new Error(`missing source dictionary ${id}`);
    return Array.from(select.options).filter((option) => option.value).map((option) => ({ id: option.value, label: option.text.trim() }));
  }
  async function readSourceDictionary() {
    const content = { schemaVersion: "catalog-capture-package/v1", semesters: options("xnxq"), educationLevels: options("sel_pycc"), grades: options("sel_nj"), homeUnits: options("sel_cddwdm"), majors: options("sel_zydm"), capturedAt: (/* @__PURE__ */ new Date()).toISOString() };
    return { ...content, sha256: await sha256(stableJson({ ...content, capturedAt: void 0 })) };
  }
  function queryId(kind, semester, level, grade, index = 0) {
    return `${kind}-${semester.replace(/[^A-Za-z0-9]+/g, "-")}-${level}-${grade}${index ? `-${index}` : ""}`;
  }
  function safeId(value) {
    return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blank";
  }
  function makeQuery(kind, semester, level, grade, extra = {}, index = 0, identity = "") {
    const [xn, xq] = semester.split(",");
    const id = `${queryId(kind, semester, level, grade, index)}${identity ? `-${safeId(identity)}` : ""}`;
    return { schemaVersion: "catalog-capture-package/v1", queryId: id, kind, dimensions: { semester, educationLevel: level, grade }, filters: { ...QUERY_FILTERS, major: extra.sel_zydm ?? "", homeUnit: extra.sel_cddwdm ?? "" }, requestParameters: { initQry: "0", xktype: "2", xn, xq, nj: grade, pycc: level, dwh: "", zydm: "", kclb1: "", kclb2: "", isbyk: "", items: "", xnxq: semester, sel_pycc: level, sel_nj: grade, sel_yxb: "", sel_zydm: "", kcmk: "", sel_schoolarea: "", sel_kclb1: "", sel_kclb2: "", sel_kc: "", sel_rkjs: "", sel_cddwdm: "", menucode_current: "S2020103", ...extra }, status: "pending", declaredRecordCount: 0, capturedRecordCount: 0, pageCount: 0, nextPage: 1, attempts: 0 };
  }
  function buildPlan(dictionary, mode) {
    const current = (id) => document.querySelector(`#${id}`)?.value || "";
    if (mode === "single") return [makeQuery("main", current("xnxq"), current("sel_pycc"), current("sel_nj"))];
    const result = [];
    const select = (values, selected, limit) => [...new Set([selected, ...values.map((value) => value.id)].filter(Boolean))].slice(0, limit);
    const semesters = mode === "pilot" ? select(dictionary.semesters, current("xnxq"), 2) : dictionary.semesters.map((value) => value.id);
    const levels = mode === "pilot" ? select(dictionary.educationLevels, current("sel_pycc"), 2) : dictionary.educationLevels.map((value) => value.id);
    const grades = mode === "pilot" ? select(dictionary.grades, current("sel_nj"), 2) : dictionary.grades.map((value) => value.id);
    for (const semester of semesters) for (const level of levels) for (const grade of grades) result.push(makeQuery("main", semester, level, grade));
    const base = result[Math.floor(Math.random() * result.length)];
    const major = dictionary.majors[Math.floor(Math.random() * dictionary.majors.length)]?.id;
    const homeUnit = dictionary.homeUnits[Math.floor(Math.random() * dictionary.homeUnits.length)]?.id;
    if (base && major) result.push(makeQuery("counterexample", base.dimensions.semester, base.dimensions.educationLevel, base.dimensions.grade, { sel_zydm: major }, 1, "major"));
    if (base && homeUnit) result.push(makeQuery("counterexample", base.dimensions.semester, base.dimensions.educationLevel, base.dimensions.grade, { sel_cddwdm: homeUnit }, 2, "homeUnit"));
    return result;
  }
  function diffDictionary(before, after) {
    const changes = [];
    for (const name of ["semesters", "educationLevels", "grades", "homeUnits", "majors"]) {
      const oldValues = new Map(before[name].map((option) => [option.id, option.label]));
      const newValues = new Map(after[name].map((option) => [option.id, option.label]));
      for (const [id, label] of newValues) {
        if (!oldValues.has(id)) changes.push({ dictionary: name, kind: "added", id, after: label });
        else if (oldValues.get(id) !== label) changes.push({ dictionary: name, kind: "renamed", id, before: oldValues.get(id), after: label });
      }
      for (const [id, label] of oldValues) if (!newValues.has(id)) changes.push({ dictionary: name, kind: "removed", id, before: label });
    }
    return changes;
  }
  function supplementalQueries(dictionary, changes) {
    const queries = [];
    const changed = (name) => new Set(changes.filter((change) => change.dictionary === name && change.kind !== "removed").map((change) => change.id));
    const semesters = changed("semesters"), levels = changed("educationLevels"), grades = changed("grades");
    for (const semester of dictionary.semesters) for (const level of dictionary.educationLevels) for (const grade of dictionary.grades) if (semesters.has(semester.id) || levels.has(level.id) || grades.has(grade.id)) queries.push(makeQuery("supplemental", semester.id, level.id, grade.id, {}, 0, "dimensions"));
    for (const homeUnit of changed("homeUnits")) for (const semester of dictionary.semesters) for (const level of dictionary.educationLevels) for (const grade of dictionary.grades) queries.push(makeQuery("supplemental", semester.id, level.id, grade.id, { sel_cddwdm: homeUnit }, 0, `homeUnit-${homeUnit}`));
    for (const major of changed("majors")) for (const semester of dictionary.semesters) for (const level of dictionary.educationLevels) for (const grade of dictionary.grades) queries.push(makeQuery("supplemental", semester.id, level.id, grade.id, { sel_zydm: major }, 0, `major-${major}`));
    const unique = new Map(queries.map((query) => [query.queryId, query]));
    return [...unique.values()];
  }
  async function ensureDirectoryPermission() {
    if (!directory) throw new DirectoryUnavailableError("capture directory is not selected");
    const permission = await directory.queryPermission?.({ mode: "readwrite" });
    if (permission !== "granted") {
      const requested = await directory.requestPermission?.({ mode: "readwrite" });
      if (requested !== "granted") throw new DirectoryUnavailableError("capture directory permission lost");
    }
  }
  async function directoryFor(path) {
    await ensureDirectoryPermission();
    let current = directory;
    for (const part of path) current = await current.getDirectoryHandle(part, { create: true });
    return current;
  }
  async function writePath(path, bytes) {
    const parts = path.split("/");
    const filename = parts.pop();
    const dir = await directoryFor(parts);
    const file = await dir.getFileHandle(filename, { create: true });
    const writer = await file.createWritable();
    await writer.write(typeof bytes === "string" ? bytes : Uint8Array.from(bytes).buffer);
    await writer.close();
  }
  async function resetQuerySnapshots(queryId2) {
    const snapshots = await directoryFor(["snapshots"]);
    try {
      await snapshots.removeEntry(queryId2, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    }
  }
  async function requestPage(query, page) {
    const { endpoint, requestParameters } = buildPageRequest(query, page, document.body.clientWidth);
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", redirect: "follow", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: buildFormBody(requestParameters) });
    const headers = {};
    response.headers.forEach((value, key) => headers[key.toLowerCase()] = value);
    return { status: response.status, url: response.url, headers, bytes: new Uint8Array(await response.arrayBuffer()) };
  }
  async function hasDirectoryPermission() {
    return !!directory && await directory.queryPermission?.({ mode: "readwrite" }) === "granted";
  }
  async function writeLiveArtifacts(next) {
    if (!await hasDirectoryPermission()) return;
    const checkpoint = `${JSON.stringify({ schemaVersion: "catalog-capture-package/v1", ...next }, null, 2)}
`;
    const partial = next.queries.map((query) => JSON.stringify(query)).join("\n") + "\n";
    await writePath("checkpoint.json", checkpoint);
    await writePath("queries.partial.jsonl", partial);
  }
  async function saveCheckpoint(next) {
    state = next;
    await dbPut("state", next);
    if (directory) await dbPut("directory", directory);
    try {
      await writeLiveArtifacts(next);
    } catch (error) {
      next.phase = "directory_unavailable";
      next.log.push({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "directory_unavailable", detail: error instanceof Error ? error.message : String(error) });
      await dbPut("state", next);
      render();
      throw new DirectoryUnavailableError("capture directory is temporarily unavailable");
    }
    render();
  }
  function createEngine() {
    return new CollectorEngine({ request: requestPage, writeSnapshot: async (id, page, bytes) => writePath(`snapshots/${id}/page-${String(page).padStart(4, "0")}.html`, bytes), resetQuerySnapshots, saveCheckpoint, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now: () => (/* @__PURE__ */ new Date()).toISOString(), random: Math.random });
  }
  async function planSourceSupplements() {
    if (!state || !frozenDictionary) return false;
    const current = await readSourceDictionary();
    if (current.sha256 === frozenDictionary.sha256) return false;
    const changes = diffDictionary(frozenDictionary, current);
    state.sourceChangeRounds = (state.sourceChangeRounds ?? 0) + 1;
    const additions = supplementalQueries(current, changes).filter((query) => !state.queries.some((existing) => existing.queryId === query.queryId));
    state.unresolvedSourceChanges = changes.filter((change) => change.kind === "removed").length;
    state.log.push({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "source_changed", detail: JSON.stringify({ round: state.sourceChangeRounds, changes, addedQueries: additions.length }) });
    if (state.sourceChangeRounds > 3) {
      state.unresolvedSourceChanges = Math.max(1, state.unresolvedSourceChanges);
      state.log.push({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "coverage_exception", detail: "source dictionary changed in more than three consecutive rounds" });
      return false;
    }
    state.queries.push(...additions);
    frozenDictionary = current;
    await dbPut("dictionary", current);
    await writePath("source-dictionary.json", `${JSON.stringify(current, null, 2)}
`);
    if (!additions.length) return false;
    state.phase = "paused";
    await saveCheckpoint(state);
    return true;
  }
  function sameDimensions(left, right) {
    return left.dimensions.semester === right.dimensions.semester && left.dimensions.educationLevel === right.dimensions.educationLevel && left.dimensions.grade === right.dimensions.grade;
  }
  function needsCounterexampleSupplement() {
    if (!state || !frozenDictionary) return false;
    const nonempty = state.queries.filter((query) => query.kind === "main" && query.status === "complete" && query.declaredRecordCount > 0);
    if (!nonempty.length) return false;
    const counterexamples = state.queries.filter((query) => query.kind === "counterexample");
    const hasMajor = counterexamples.some((query) => !!query.filters.major && nonempty.some((base) => sameDimensions(query, base)));
    const hasHomeUnit = counterexamples.some((query) => !!query.filters.homeUnit && nonempty.some((base) => sameDimensions(query, base)));
    return !hasMajor && !!frozenDictionary.majors[0] || !hasHomeUnit && !!frozenDictionary.homeUnits[0];
  }
  async function planCounterexampleSupplements() {
    if (!state || !frozenDictionary || !needsCounterexampleSupplement()) return false;
    const nonempty = state.queries.filter((query) => query.kind === "main" && query.status === "complete" && query.declaredRecordCount > 0);
    const base = nonempty[0];
    const existing = state.queries.filter((query) => query.kind === "counterexample");
    const hasMajor = existing.some((query) => !!query.filters.major && nonempty.some((candidate) => sameDimensions(query, candidate)));
    const hasHomeUnit = existing.some((query) => !!query.filters.homeUnit && nonempty.some((candidate) => sameDimensions(query, candidate)));
    const additions = [];
    if (!hasMajor && frozenDictionary.majors[0]) additions.push(makeQuery("counterexample", base.dimensions.semester, base.dimensions.educationLevel, base.dimensions.grade, { sel_zydm: frozenDictionary.majors[0].id }, 3, "nonempty-major"));
    if (!hasHomeUnit && frozenDictionary.homeUnits[0]) additions.push(makeQuery("counterexample", base.dimensions.semester, base.dimensions.educationLevel, base.dimensions.grade, { sel_cddwdm: frozenDictionary.homeUnits[0].id }, 4, "nonempty-homeUnit"));
    const unique = additions.filter((query) => !state.queries.some((existingQuery) => existingQuery.queryId === query.queryId));
    if (!unique.length) return false;
    state.queries.push(...unique);
    state.phase = "paused";
    state.log.push({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "counterexample_supplemented", detail: `${unique.length} queries based on ${base.queryId}` });
    await saveCheckpoint(state);
    return true;
  }
  async function runToTerminal() {
    if (!state) return;
    while (true) {
      engine = createEngine();
      engine.resume();
      await engine.run(state);
      if (state.phase !== "complete") break;
      if (await planCounterexampleSupplements()) continue;
      if (!await planSourceSupplements()) {
        await exportPackage();
        break;
      }
    }
    render();
  }
  async function start(mode) {
    if (!window.showDirectoryPicker) throw new Error("File System Access API unavailable; use Chrome/Edge");
    if (state && !window.confirm(`现有批次 ${state.batchId} 将保留在原目录。确认开始新的 ${mode} 批次？`)) return;
    directory = await window.showDirectoryPicker({ mode: "readwrite", id: "jufexk-catalog-capture" });
    frozenDictionary = await readSourceDictionary();
    state = createCollectorState(`${mode}-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`, buildPlan(frozenDictionary, mode));
    await dbPut("dictionary", frozenDictionary);
    await writePath("source-dictionary.json", `${JSON.stringify(frozenDictionary, null, 2)}
`);
    await runToTerminal();
  }
  async function resume() {
    state = state ?? await dbGet("state");
    directory = directory ?? await dbGet("directory");
    frozenDictionary = frozenDictionary ?? await dbGet("dictionary");
    if (!state) throw new Error("no checkpoint");
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
      query.lastError = void 0;
    }
    state.phase = "paused";
    state.log.push({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "exception_retry_started", detail: `${exceptions.length} queries` });
    await saveCheckpoint(state);
    await resume();
  }
  function counts() {
    const statuses = {};
    for (const query of state?.queries ?? []) statuses[query.status] = (statuses[query.status] ?? 0) + 1;
    return statuses;
  }
  async function exportPackage() {
    if (!state || !frozenDictionary) throw new Error("no capture state");
    await ensureDirectoryPermission();
    const current = await readSourceDictionary();
    const sourceChanged = current.sha256 !== frozenDictionary.sha256 || (state.unresolvedSourceChanges ?? 0) > 0;
    state.log.push({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "export_complete", detail: sourceChanged ? "source_changed" : "validated" });
    const queries = state.queries.map(({ nextPage, attempts, lastError, ...query }) => query);
    const queryText = queries.map((query) => JSON.stringify(query)).join("\n") + "\n";
    await writePath("queries.jsonl", queryText);
    const files = [];
    const add = async (path, bytes, records) => {
      const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
      files.push({ path, bytes: data.byteLength, records, sha256: await sha256(data) });
    };
    await add("queries.jsonl", queryText, queries.length);
    const dictionaryText = `${JSON.stringify(frozenDictionary, null, 2)}
`;
    await add("source-dictionary.json", dictionaryText, 1);
    const logText = state.log.map((item) => JSON.stringify({ schemaVersion: "catalog-capture-package/v1", ...item })).join("\n") + "\n";
    await writePath("run-log.jsonl", logText);
    await add("run-log.jsonl", logText, state.log.length);
    const coverage = { schemaVersion: "catalog-capture-package/v1", batchId: state.batchId, sourceChanged, sourceChangeRounds: state.sourceChangeRounds ?? 0, unresolvedSourceChanges: state.unresolvedSourceChanges ?? 0, queryCount: state.queries.length, statuses: counts(), exceptions: state.queries.filter((query) => query.status === "exception").map((query) => ({ queryId: query.queryId, page: query.nextPage, attempts: query.attempts, error: query.lastError })) };
    const coverageText = `${JSON.stringify(coverage, null, 2)}
`;
    await writePath("coverage.json", coverageText);
    await add("coverage.json", coverageText, 1);
    const checkpointText = `${JSON.stringify({ schemaVersion: "catalog-capture-package/v1", ...state }, null, 2)}
`;
    const partialText = state.queries.map((query) => JSON.stringify(query)).join("\n") + "\n";
    await writePath("checkpoint.json", checkpointText);
    await writePath("queries.partial.jsonl", partialText);
    await add("checkpoint.json", checkpointText, 1);
    await add("queries.partial.jsonl", partialText, state.queries.length);
    for (const query of state.queries) for (let page = 1; page <= query.pageCount && page < query.nextPage; page++) {
      const path = `snapshots/${query.queryId}/page-${String(page).padStart(4, "0")}.html`;
      const parts = path.split("/");
      const name = parts.pop();
      const dir = await directoryFor(parts);
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      await add(path, bytes, 1);
    }
    files.sort((a, b) => compareText(a.path, b.path));
    const manifestContent = { schemaVersion: "catalog-capture-package/v1", batchId: state.batchId, status: sourceChanged ? "source_changed" : Object.keys(counts()).includes("exception") ? "complete_with_exceptions" : "complete", sourceDictionarySha256: frozenDictionary.sha256, counts: { queries: queries.length, pages: files.filter((file) => file.path.startsWith("snapshots/")).length, records: queries.reduce((sum, query) => sum + (query.capturedRecordCount ?? (query.status === "complete" ? query.declaredRecordCount : 0)), 0), bytes: files.reduce((sum, file) => sum + file.bytes, 0), statuses: counts() }, files };
    const manifest = { ...manifestContent, manifestContentSha256: await sha256(stableJson(manifestContent)) };
    await writePath("manifest.json", `${JSON.stringify(manifest, null, 2)}
`);
    await dbPut("state", state);
    if (directory) await dbPut("directory", directory);
    render();
  }
  var phaseLabels = { idle: "待开始", running: "采集中", paused: "已暂停", session_expired: "等待重新登录", directory_unavailable: "等待目录授权", circuit_open: "已安全熔断", stopped: "已停止", complete: "采集完成" };
  function render() {
    const root = document.querySelector("#jufexk-catalog-panel");
    if (!root) return;
    const queries = state?.queries ?? [];
    const completed = queries.filter((query) => query.status === "complete").length;
    const exceptions = queries.filter((query) => query.status === "exception").length;
    const current = queries.find((query) => query.status !== "complete" && query.status !== "exception");
    const percent = queries.length ? Math.round((completed + exceptions) / queries.length * 100) : 0;
    root.querySelector("[data-phase]").textContent = state ? phaseLabels[state.phase] : "待开始";
    root.querySelector("[data-progress]").textContent = state ? `${completed + exceptions} / ${queries.length} 查询 · ${percent}%` : "尚未创建计划";
    root.querySelector("[data-current]").textContent = current ? `${current.dimensions.semester} · ${current.dimensions.educationLevel} · ${current.dimensions.grade} · 第 ${current.nextPage}${current.pageCount ? `/${current.pageCount}` : ""} 页` : state?.phase === "complete" ? "全部查询已到终态" : "-";
    root.querySelector("[data-bar]").style.width = `${percent}%`;
    root.querySelector("[data-exceptions]").textContent = exceptions ? `${exceptions} 个例外待定向补跑` : "无例外";
    const events = (state?.log ?? []).slice(-6).reverse();
    root.querySelector("[data-log]").innerHTML = events.map((item) => `<li><time>${item.at.slice(11, 19)}</time><span>${item.event}${item.queryId ? ` · ${item.queryId}` : ""}${item.page ? ` · p${item.page}` : ""}</span></li>`).join("") || "<li>暂无事件</li>";
    const running = state?.phase === "running";
    root.querySelector('[data-action="start"]').disabled = !!state && running;
    root.querySelector('[data-action="pause"]').disabled = !running;
    root.querySelector('[data-action="resume"]').disabled = !state || running || state.phase === "complete";
    root.querySelector('[data-action="retry"]').disabled = !exceptions;
  }
  function showError(error) {
    const root = document.querySelector("#jufexk-catalog-panel");
    if (root) root.querySelector("[data-error]").textContent = error instanceof Error ? error.message : String(error);
  }
  function mount() {
    if (location.pathname !== "/student/wsxk.kcbcx10319.html" || document.querySelector("#jufexk-catalog-panel") || !document.querySelector("#ActionForm")) return;
    const panel = document.createElement("section");
    panel.id = "jufexk-catalog-panel";
    panel.innerHTML = `<style>#jufexk-catalog-panel{position:fixed;right:12px;top:12px;z-index:2147483647;width:min(390px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;background:#fff;border:1px solid #b42318;border-top:4px solid #b42318;border-radius:6px;padding:14px;font:14px/1.45 system-ui;color:#252525;box-shadow:0 8px 28px #0003}#jufexk-catalog-panel *{box-sizing:border-box}#jufexk-catalog-panel header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}#jufexk-catalog-panel h2{font-size:17px;margin:0;letter-spacing:0}#jufexk-catalog-panel [data-phase]{font-weight:700;color:#b42318}#jufexk-catalog-panel .meta{display:grid;gap:4px;background:#f6f6f6;padding:10px;border-radius:4px}#jufexk-catalog-panel .track{height:8px;background:#ddd;margin:10px 0;border-radius:4px;overflow:hidden}#jufexk-catalog-panel [data-bar]{height:100%;background:#16794b;width:0;transition:width .2s}#jufexk-catalog-panel select{width:100%;padding:8px;border:1px solid #aaa;border-radius:4px;background:white}#jufexk-catalog-panel .commands{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}#jufexk-catalog-panel button{min-height:36px;border:1px solid #aaa;border-radius:4px;background:#fff;font-weight:600;cursor:pointer}#jufexk-catalog-panel button[data-action="start"],#jufexk-catalog-panel button[data-action="resume"]{background:#b42318;color:#fff;border-color:#b42318}#jufexk-catalog-panel button:disabled{opacity:.45;cursor:default}#jufexk-catalog-panel details{border-top:1px solid #ddd;padding-top:8px}#jufexk-catalog-panel ul{list-style:none;margin:6px 0 0;padding:0;font-size:12px}#jufexk-catalog-panel li{display:flex;gap:8px;padding:3px 0}#jufexk-catalog-panel time{color:#666;flex:none}#jufexk-catalog-panel [data-error]{color:#b42318;font-weight:600;word-break:break-word;min-height:20px}</style><header><h2>选课志目录采集</h2><span data-phase>载入中</span></header><div class="meta"><strong data-progress>读取检查点...</strong><span data-current>-</span><span data-exceptions>无例外</span></div><div class="track"><div data-bar></div></div><label>运行范围<select data-mode><option value="single">单查询验收</option><option value="pilot" selected>真实 Pilot · 小矩阵</option><option value="full">全量 · 冻结矩阵</option></select></label><div class="commands"><button data-action="start">开始新批次</button><button data-action="pause">暂停</button><button data-action="resume">授权并继续</button><button data-action="retry">重跑例外</button><button data-action="stop">安全停止</button><button data-action="export">立即整理包</button></div><div data-error></div><details><summary>最近事件</summary><ul data-log></ul></details>`;
    document.body.appendChild(panel);
    panel.querySelectorAll("button[data-action]").forEach((button) => button.type = "button");
    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      event.preventDefault();
      const action = button.dataset.action;
      const run = async () => {
        showError("");
        if (action === "start") await start(panel.querySelector("[data-mode]").value);
        else if (action === "pause") {
          engine?.pause();
        } else if (action === "resume") await resume();
        else if (action === "retry") await retryExceptions();
        else if (action === "stop") engine?.stop();
        else if (action === "export") await exportPackage();
      };
      void run().catch(showError);
    });
    void Promise.all([dbGet("state"), dbGet("directory"), dbGet("dictionary")]).then(async ([savedState, savedDirectory, savedDictionary]) => {
      state = savedState;
      directory = savedDirectory;
      frozenDictionary = savedDictionary;
      render();
      if ((state?.phase === "running" || state?.phase === "complete" && needsCounterexampleSupplement()) && await hasDirectoryPermission()) void runToTerminal().catch(showError);
    }).catch(showError);
  }
  mount();
})();
