// ==UserScript==
// @name         选课志培养方案采集器
// @namespace    https://github.com/K4F7/jufexk
// @version      1.0.0
// @description  人工登录后串行采集 KINGOSOFT 培养方案理论课程原始页面
// @match        https://jwxt.jxufe.edu.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // scripts/program-plan/parse-table.ts
  function decodeEntities(value) {
    return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
  }
  function textOf(html) {
    return decodeEntities(html.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  }
  function findResultTable(html) {
    const keywords = /<table\b[^>]*\bid\s*=\s*["']keywords["'][^>]*>[\s\S]*?<\/table>/i.exec(html)?.[0];
    if (keywords) return keywords;
    for (const match of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
      if (/学年学期|建议修读|课程类别/.test(match[0])) return match[0];
    }
  }
  function discoverTableId(html) {
    return /name\s*=\s*["']tableId["'][^>]*value\s*=\s*["'](\d+)["']/i.exec(html)?.[1] ?? /[?&]tableId=(\d+)/i.exec(html)?.[1] ?? /showTotalRecord\(\s*['"](\d+)['"]/.exec(html)?.[1];
  }
  function discoverFormAction(html) {
    return /<form\b[^>]*\bid\s*=\s*["']ActionForm["'][^>]*\baction\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ?? /<form\b[^>]*\baction\s*=\s*["']([^"']+)["'][^>]*\bid\s*=\s*["']ActionForm["']/i.exec(html)?.[1];
  }
  function selectByLabel(html, label) {
    const labeled = new RegExp(`(?:${label.source})[^<]{0,120}<select\\b([^>]*)>`, "i").exec(html) ?? new RegExp(`<td[^>]*>\\s*(?:${label.source})\\s*</td>\\s*<td[^>]*>\\s*<select\\b([^>]*)>`, "i").exec(html);
    if (!labeled) return void 0;
    const attributes = labeled[1];
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? "";
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? "";
    if (!id && !name) return void 0;
    return { id, name };
  }
  function parseSelectOptions(html, idOrName) {
    const block = new RegExp(`<select\\b[^>]*(?:\\bid\\s*=\\s*["']${idOrName}["']|\\bname\\s*=\\s*["']${idOrName}["'])[^>]*>([\\s\\S]*?)</select>`, "i").exec(html)?.[1];
    if (!block) return [];
    return [...block.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((match) => ({
      id: /\bvalue\s*=\s*["']?([^"'>\s]*)/i.exec(match[1])?.[1] ?? "",
      label: textOf(match[2])
    })).filter((option) => option.id && option.label && !/请选择|全部/.test(option.label));
  }
  function discoverFilterFields(html) {
    const grade = selectByLabel(html, /年级/);
    const direction = selectByLabel(html, /专业方向/);
    const department = selectByLabel(html, /院\s*\(?系\)?\)?\s*\/?\s*部|院系|院\(系\)\/部/);
    const major = selectByLabel(html, /专业(?!方向)/);
    const studyKind = selectByLabel(html, /主修\s*\/\s*辅修|主修|辅修/);
    if (!grade || !department || !major) return void 0;
    return { grade, department, major, direction, studyKind };
  }
  function findStudyKindValue(html, field) {
    const options = parseSelectOptions(html, field.id || field.name);
    return options.find((option) => option.label === "主修" || option.id === "主修")?.id;
  }

  // scripts/program-plan/userscript/collector-core.ts
  function buildFormBody(parameters) {
    const parts = [];
    for (const [key, value] of Object.entries(parameters)) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    if (!("btnSubmit" in parameters)) parts.push("btnSubmit=%CC%E1%BD%BB");
    return parts.join("&");
  }
  function buildPageRequest(query, page, context) {
    const tableId = context.tableId || query.requestParameters.tableId;
    const requestParameters = { ...query.requestParameters, initQry: "0" };
    if (!tableId) {
      return { endpoint: context.formAction || query.requestParameters.formAction || "/", requestParameters };
    }
    if (page === 1) {
      return { endpoint: `/taglib/DataTable.jsp?tableId=${tableId}&clientWidth=${context.clientWidth}`, requestParameters };
    }
    return {
      endpoint: `/taglib/DataTable.jsp?currPageCount=${page}`,
      requestParameters: { tableId, clientWidth: String(context.clientWidth), ...requestParameters }
    };
  }
  var SessionExpiredError = class extends Error {
  };
  var DirectoryUnavailableError = class extends Error {
  };
  function parsePageMetadata(bytes, tableId) {
    const html = new TextDecoder("gbk").decode(bytes);
    const declaredTableId = tableId || discoverTableId(html);
    const totalRecords = Number(
      (declaredTableId ? new RegExp(`showTotalRecord\\(\\s*['"]${declaredTableId}['"]\\s*,\\s*['"](\\d+)['"]`).exec(html)?.[1] : void 0) ?? /showTotalRecord\(\s*['"][^'"]+['"]\s*,\s*['"](\d+)['"]/.exec(html)?.[1] ?? "NaN"
    );
    const pagination = /reloadPage\(\s*['"][^'"]+['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(html);
    const table = findResultTable(html);
    const body = table && /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1];
    const pageRecords = body ? (body.match(/<tr\b/gi) ?? []).length : 0;
    if (pagination && Number.isSafeInteger(totalRecords)) {
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
    return { totalRecords: Number.isSafeInteger(totalRecords) ? totalRecords : pageRecords, pageRecords, currentPage: 1, totalPages: 1, html };
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
    if (/\bticket\s*[:=]\s*\S/i.test(text) || /学号\s*[：:=]\s*\S/.test(text) || /姓名\s*[：:=]\s*\S/.test(text)) {
      throw new Error("unsafe personal or ticket content in source page");
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
          const metadata = parsePageMetadata(response.bytes, query.requestParameters.tableId);
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
        query.capturedRecordCount += parsePageMetadata(response.bytes, query.requestParameters.tableId).pageRecords;
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
    return { batchId, phase: "idle", queries, consecutiveServerFailures: 0, pagesSinceLongPause: 0, log: [] };
  }

  // scripts/program-plan/userscript/index.ts
  var DB_NAME = "jufexk-program-plan-collector-v1";
  var STORE = "checkpoint";
  var SCHEMA = "program-plan-capture-package/v1";
  var state;
  var directory;
  var engine;
  var frozenDictionary;
  var coverageSeeds = [];
  var pageContext = {};
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
      const request = db.transaction(STORE).objectStore(STORE).get(key);
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
  function safeId(value) {
    return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blank";
  }
  function optionYear(option) {
    const token = /^\d{4}$/.test(option.id) ? option.id : option.label.match(/\d{4}/)?.[0];
    return token ? Number(token) : Number.NaN;
  }
  function currentGrades(options, now = /* @__PURE__ */ new Date()) {
    const years = options.filter((option) => Number.isSafeInteger(optionYear(option)));
    const incoming = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    const window2 = new Set([incoming, incoming - 1, incoming - 2, incoming - 3].map(String));
    const inWindow = years.filter((option) => window2.has(String(optionYear(option))));
    return [...inWindow.length ? inWindow : years.slice(0, 4)].sort((left, right) => optionYear(left) - optionYear(right));
  }
  function readSelect(idOrName) {
    const select = document.querySelector(`#${idOrName}, select[name="${idOrName}"]`);
    if (!select) throw new Error(`missing select ${idOrName}`);
    return select;
  }
  function optionsOf(select) {
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
  async function setSelect(select, value, dependent) {
    const before = dependent ? dependent.innerHTML : "";
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("input", { bubbles: true }));
    if (!dependent) return;
    const started = Date.now();
    while (Date.now() - started < 8e3) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (dependent.innerHTML !== before || optionsOf(dependent).length) return;
    }
  }
  function makeQuery(grade, department, major, fieldNames, studyKindValue) {
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
        majorDirection: ""
      },
      filters: { grade: grade.id, department: department.id, major: major.id, majorDirection: "", studyKind: "主修" },
      requestParameters: {
        initQry: "0",
        [fieldNames.grade]: grade.id,
        [fieldNames.department]: department.id,
        [fieldNames.major]: major.id,
        ...fieldNames.direction ? { [fieldNames.direction]: "" } : {},
        ...fieldNames.studyKind ? { [fieldNames.studyKind]: studyKindValue } : {},
        ...pageContext.tableId ? { tableId: pageContext.tableId } : {},
        ...pageContext.formAction ? { formAction: pageContext.formAction } : {}
      },
      status: "pending",
      declaredRecordCount: 0,
      capturedRecordCount: 0,
      pageCount: 0,
      nextPage: 1,
      attempts: 0
    };
  }
  async function discoverCascade(mode) {
    const fields = refreshPageContext();
    const gradeSelect = readSelect(fields.grade.id || fields.grade.name);
    const departmentSelect = readSelect(fields.department.id || fields.department.name);
    const majorSelect = readSelect(fields.major.id || fields.major.name);
    const directionSelect = fields.direction ? readSelect(fields.direction.id || fields.direction.name) : void 0;
    const studySelect = fields.studyKind ? readSelect(fields.studyKind.id || fields.studyKind.name) : void 0;
    const studyKindValue = fields.studyKind ? findStudyKindValue(document.documentElement.outerHTML, fields.studyKind) : "主修";
    if (!studyKindValue) throw new Error("未找到主修选项");
    if (studySelect) await setSelect(studySelect, studyKindValue);
    if (directionSelect) await setSelect(directionSelect, "");
    const grades = mode === "single" ? optionsOf(gradeSelect).filter((option) => option.id === gradeSelect.value) : currentGrades(optionsOf(gradeSelect));
    if (!grades.length) throw new Error("年级下拉没有当前在校年级");
    const cascade = [];
    coverageSeeds = [];
    const fieldNames = {
      grade: fields.grade.name || fields.grade.id,
      department: fields.department.name || fields.department.id,
      major: fields.major.name || fields.major.id,
      direction: fields.direction?.name || fields.direction?.id || "",
      studyKind: fields.studyKind?.name || fields.studyKind?.id || ""
    };
    const queries = [];
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
            queryId: query.queryId
          });
        }
      }
    }
    const content = {
      schemaVersion: SCHEMA,
      grades: [...new Map(cascade.map((node) => [node.grade.id, node.grade])).values()],
      departments: [...new Map(cascade.map((node) => [node.department.id, node.department])).values()],
      majors: [...new Map(cascade.flatMap((node) => node.majors.map((major) => [major.id, major]))).values()],
      studyKinds: [{ id: "主修", label: "主修" }],
      cascade,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    frozenDictionary = { ...content, sha256: await sha256(stableJson({ ...content, capturedAt: void 0 })) };
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
    await writer.write(typeof bytes === "string" ? bytes : bytes.buffer);
    await writer.close();
  }
  async function resetQuerySnapshots(queryId) {
    const snapshots = await directoryFor(["snapshots"]);
    try {
      await snapshots.removeEntry(queryId, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    }
  }
  async function requestPage(query, page) {
    const { endpoint, requestParameters } = buildPageRequest(query, page, {
      tableId: pageContext.tableId,
      clientWidth: document.body.clientWidth,
      formAction: pageContext.formAction
    });
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      redirect: "follow",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: buildFormBody(requestParameters)
    });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: response.status, url: response.url, headers, bytes: new Uint8Array(await response.arrayBuffer()) };
  }
  async function hasDirectoryPermission() {
    return !!directory && await directory.queryPermission?.({ mode: "readwrite" }) === "granted";
  }
  async function writeLiveArtifacts(next) {
    if (!await hasDirectoryPermission()) return;
    await writePath("checkpoint.json", `${JSON.stringify({ schemaVersion: SCHEMA, ...next }, null, 2)}
`);
    await writePath("queries.partial.jsonl", `${next.queries.map((query) => JSON.stringify(query)).join("\n")}
`);
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
    return new CollectorEngine({
      request: requestPage,
      writeSnapshot: async (id, page, bytes) => writePath(`snapshots/${id}/page-${String(page).padStart(4, "0")}.html`, bytes),
      resetQuerySnapshots,
      saveCheckpoint,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => (/* @__PURE__ */ new Date()).toISOString(),
      random: Math.random
    });
  }
  function counts() {
    const statuses = {};
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
        if (!query) return { ...entry, status: "exception", reason: "query_missing" };
        if (query.status === "exception" || query.status === "failed") return { ...entry, status: "exception", declaredRecordCount: query.declaredRecordCount, reason: "query_failed" };
        if (query.status === "complete" && query.declaredRecordCount === 0) return { ...entry, status: "empty", declaredRecordCount: 0, reason: "empty_result" };
        return { ...entry, status: "complete", declaredRecordCount: query.declaredRecordCount };
      })
    };
  }
  async function exportPackage() {
    if (!state || !frozenDictionary) throw new Error("no capture state");
    await ensureDirectoryPermission();
    const queries = state.queries.map(({ nextPage, attempts, lastError, ...query }) => query);
    const queryText = `${queries.map((query) => JSON.stringify(query)).join("\n")}
`;
    await writePath("queries.jsonl", queryText);
    const files = [];
    const add = async (path, bytes, records) => {
      const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
      files.push({ path, bytes: data.byteLength, records, sha256: await sha256(data) });
    };
    await add("queries.jsonl", queryText, queries.length);
    const dictionaryText = `${JSON.stringify(frozenDictionary, null, 2)}
`;
    await writePath("source-dictionary.json", dictionaryText);
    await add("source-dictionary.json", dictionaryText, 1);
    const coverage = finalizeCoverage();
    const coverageText = `${JSON.stringify(coverage, null, 2)}
`;
    await writePath("coverage.json", coverageText);
    await add("coverage.json", coverageText, coverage.entries.length);
    const logText = `${state.log.map((item) => JSON.stringify({ schemaVersion: SCHEMA, ...item })).join("\n")}
`;
    await writePath("run-log.jsonl", logText);
    await add("run-log.jsonl", logText, state.log.length);
    await writePath("checkpoint.json", `${JSON.stringify({ schemaVersion: SCHEMA, ...state }, null, 2)}
`);
    for (const query of state.queries) {
      for (let page = 1; page <= query.pageCount && page < query.nextPage; page += 1) {
        const path = `snapshots/${query.queryId}/page-${String(page).padStart(4, "0")}.html`;
        const parts = path.split("/");
        const name = parts.pop();
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
        statuses: counts()
      },
      files
    };
    const manifest = { ...manifestContent, manifestContentSha256: await sha256(stableJson(manifestContent)) };
    await writePath("manifest.json", `${JSON.stringify(manifest, null, 2)}
`);
  }
  async function runToTerminal() {
    if (!state) return;
    engine = createEngine();
    engine.resume();
    await engine.run(state);
    if (state.phase === "complete") await exportPackage();
    render();
  }
  async function start(mode) {
    if (!window.showDirectoryPicker) throw new Error("File System Access API unavailable; use Chrome/Edge");
    if (state && !window.confirm(`现有批次 ${state.batchId} 将保留在原目录。确认开始新的 ${mode} 批次？`)) return;
    directory = await window.showDirectoryPicker({ mode: "readwrite", id: "jufexk-program-plan-capture" });
    const queries = await discoverCascade(mode);
    state = createCollectorState(`${mode}-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`, queries);
    await dbPut("dictionary", frozenDictionary);
    await dbPut("coverage", coverageSeeds);
    if (frozenDictionary) await writePath("source-dictionary.json", `${JSON.stringify(frozenDictionary, null, 2)}
`);
    await runToTerminal();
  }
  async function resume() {
    state = state ?? await dbGet("state");
    directory = directory ?? await dbGet("directory");
    frozenDictionary = frozenDictionary ?? await dbGet("dictionary");
    coverageSeeds = coverageSeeds.length ? coverageSeeds : await dbGet("coverage") ?? [];
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
      query.lastError = void 0;
    }
    state.phase = "paused";
    await saveCheckpoint(state);
    await resume();
  }
  var phaseLabels = {
    idle: "待开始",
    running: "采集中",
    paused: "已暂停",
    session_expired: "等待重新登录",
    directory_unavailable: "等待目录授权",
    circuit_open: "已安全熔断",
    stopped: "已停止",
    complete: "采集完成"
  };
  function render() {
    const root = document.querySelector("#jufexk-program-plan-panel");
    if (!root) return;
    const queries = state?.queries ?? [];
    const completed = queries.filter((query) => query.status === "complete").length;
    const exceptions = queries.filter((query) => query.status === "exception").length;
    const current = queries.find((query) => query.status !== "complete" && query.status !== "exception");
    const percent = queries.length ? Math.round((completed + exceptions) / queries.length * 100) : 0;
    root.querySelector("[data-phase]").textContent = state ? phaseLabels[state.phase] : "待开始";
    root.querySelector("[data-progress]").textContent = state ? `${completed + exceptions} / ${queries.length} 查询 · ${percent}%` : "尚未创建计划";
    root.querySelector("[data-current]").textContent = current ? `${current.dimensions.grade} · ${current.dimensions.departmentName} · ${current.dimensions.majorName} · 第 ${current.nextPage}${current.pageCount ? `/${current.pageCount}` : ""} 页` : state?.phase === "complete" ? "全部查询已到终态" : "-";
    root.querySelector("[data-bar]").style.width = `${percent}%`;
    root.querySelector("[data-exceptions]").textContent = exceptions ? `${exceptions} 个例外待定向补跑` : "无例外";
    const events = (state?.log ?? []).slice(-6).reverse();
    root.querySelector("[data-log]").innerHTML = events.map((item) => `<li><time>${item.at.slice(11, 19)}</time><span>${item.event}${item.queryId ? ` · ${item.queryId}` : ""}</span></li>`).join("") || "<li>暂无事件</li>";
    const running = state?.phase === "running";
    root.querySelector('[data-action="start"]').disabled = !!state && running;
    root.querySelector('[data-action="pause"]').disabled = !running;
    root.querySelector('[data-action="resume"]').disabled = !state || running || state.phase === "complete";
    root.querySelector('[data-action="retry"]').disabled = !exceptions;
  }
  function showError(error) {
    const root = document.querySelector("#jufexk-program-plan-panel");
    if (root) root.querySelector("[data-error]").textContent = error instanceof Error ? error.message : String(error);
  }
  function mount() {
    if (!isProgramPlanPage() || document.querySelector("#jufexk-program-plan-panel")) return;
    const panel = document.createElement("section");
    panel.id = "jufexk-program-plan-panel";
    panel.innerHTML = `<style>#jufexk-program-plan-panel{position:fixed;right:12px;top:12px;z-index:2147483647;width:min(390px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;background:#fff;border:1px solid #b42318;border-top:4px solid #b42318;border-radius:6px;padding:14px;font:14px/1.45 system-ui;color:#252525;box-shadow:0 8px 28px #0003}#jufexk-program-plan-panel h2{font-size:17px;margin:0}#jufexk-program-plan-panel [data-phase]{font-weight:700;color:#b42318}#jufexk-program-plan-panel .meta{display:grid;gap:4px;background:#f6f6f6;padding:10px;border-radius:4px}#jufexk-program-plan-panel .track{height:8px;background:#ddd;margin:10px 0;border-radius:4px;overflow:hidden}#jufexk-program-plan-panel [data-bar]{height:100%;background:#16794b;width:0}#jufexk-program-plan-panel select{width:100%;padding:8px;border:1px solid #aaa;border-radius:4px}#jufexk-program-plan-panel .commands{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}#jufexk-program-plan-panel button{min-height:36px;border:1px solid #aaa;border-radius:4px;background:#fff;font-weight:600}#jufexk-program-plan-panel button[data-action="start"],#jufexk-program-plan-panel button[data-action="resume"]{background:#b42318;color:#fff;border-color:#b42318}#jufexk-program-plan-panel button:disabled{opacity:.45}#jufexk-program-plan-panel ul{list-style:none;margin:6px 0 0;padding:0;font-size:12px}#jufexk-program-plan-panel [data-error]{color:#b42318;font-weight:600;min-height:20px}</style><header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2>选课志培养方案采集</h2><span data-phase>载入中</span></header><div class="meta"><strong data-progress>读取检查点...</strong><span data-current>-</span><span data-exceptions>无例外</span></div><div class="track"><div data-bar></div></div><label>运行范围<select data-mode><option value="single">当前年级×专业</option><option value="full" selected>四个年级 × 全部主修专业</option></select></label><div class="commands"><button data-action="start">开始新批次</button><button data-action="pause">暂停</button><button data-action="resume">授权并继续</button><button data-action="retry">重跑例外</button><button data-action="stop">安全停止</button><button data-action="export">立即整理包</button></div><div data-error></div><details><summary>最近事件</summary><ul data-log></ul></details>`;
    document.body.appendChild(panel);
    panel.querySelectorAll("button[data-action]").forEach((button) => {
      button.type = "button";
    });
    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      event.preventDefault();
      const action = button.dataset.action;
      const run = async () => {
        showError("");
        if (action === "start") await start(panel.querySelector("[data-mode]").value);
        else if (action === "pause") engine?.pause();
        else if (action === "resume") await resume();
        else if (action === "retry") await retryExceptions();
        else if (action === "stop") engine?.stop();
        else if (action === "export") await exportPackage();
      };
      void run().catch(showError);
    });
    void Promise.all([dbGet("state"), dbGet("directory"), dbGet("dictionary"), dbGet("coverage")]).then(([savedState, savedDirectory, savedDictionary, savedCoverage]) => {
      state = savedState;
      directory = savedDirectory;
      frozenDictionary = savedDictionary;
      coverageSeeds = savedCoverage ?? [];
      render();
    }).catch(showError);
  }
  mount();
})();
