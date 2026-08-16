import type { QueryStatus } from "../capture-package";

export const COLLECTOR_SCHEMA_VERSION = "catalog-capture-package/v1" as const;

export interface CollectorQuery {
  schemaVersion: typeof COLLECTOR_SCHEMA_VERSION;
  queryId: string;
  kind: "main" | "supplemental" | "counterexample";
  dimensions: { semester: string; educationLevel: string; grade: string };
  filters: Record<string, string>;
  requestParameters: Record<string, string>;
  status: QueryStatus;
  declaredRecordCount: number;
  capturedRecordCount: number;
  pageCount: number;
  nextPage: number;
  attempts: number;
  lastError?: string;
}

export interface PageResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  bytes: Uint8Array;
}

export interface CollectorState {
  batchId: string;
  phase: "idle" | "running" | "paused" | "session_expired" | "directory_unavailable" | "circuit_open" | "stopped" | "complete";
  queries: CollectorQuery[];
  consecutiveServerFailures: number;
  pagesSinceLongPause: number;
  sourceChangeRounds: number;
  unresolvedSourceChanges: number;
  log: Array<{ at: string; queryId?: string; page?: number; event: string; detail?: string }>;
}

export interface CollectorDependencies {
  request(query: CollectorQuery, page: number): Promise<PageResponse>;
  writeSnapshot(queryId: string, page: number, bytes: Uint8Array): Promise<void>;
  resetQuerySnapshots(queryId: string): Promise<void>;
  saveCheckpoint(state: CollectorState): Promise<void>;
  sleep(milliseconds: number): Promise<void>;
  now(): string;
  random(): number;
}

export function buildPageRequest(query: CollectorQuery, page: number, clientWidth: number) {
  const requestParameters = page === 1
    ? { ...query.requestParameters, initQry: "0" }
    : { tableId: "5327042", clientWidth: String(clientWidth), ...query.requestParameters, initQry: "0" };
  const endpoint = page === 1
    ? `/taglib/DataTable.jsp?tableId=5327042&clientWidth=${clientWidth}`
    : `/taglib/DataTable.jsp?currPageCount=${page}`;
  return { endpoint, requestParameters };
}

export function buildFormBody(parameters: Record<string, string>) {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(parameters)) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    if (key === "xnxq") {
      parts.push("btnFilter=%C0%E0%B1%F0%B9%FD%C2%CB", "btnSubmit=%CC%E1%BD%BB");
    }
  }
  return parts.join("&");
}

export class SessionExpiredError extends Error {}
export class DirectoryUnavailableError extends Error {}

export function parsePageMetadata(bytes: Uint8Array) {
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

export function isSessionExpired(response: PageResponse) {
  if (/\/cas\/login\.action(?:$|[?#])/.test(response.url)) return true;
  const text = new TextDecoder("gbk").decode(response.bytes.slice(0, 8192));
  return /name=["']?(?:login|randnumber1)["']?|用户登录|验证码/.test(text);
}

export function assertSnapshotSafe(bytes: Uint8Array) {
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

function retryDelay(attempt: number, random: number) {
  const base = [2_000, 5_000, 15_000][Math.min(attempt - 1, 2)];
  return Math.round(base * (0.85 + random * 0.3));
}

function retryAfterMilliseconds(value: string | undefined) {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(60_000, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(60_000, date - Date.now()) : 60_000;
}

export class CollectorEngine {
  private stopRequested = false;
  private pauseRequested = false;

  constructor(private readonly dependencies: CollectorDependencies) {}

  pause() { this.pauseRequested = true; }
  stop() { this.stopRequested = true; }
  resume() { this.pauseRequested = false; this.stopRequested = false; }

  private log(state: CollectorState, event: string, query?: CollectorQuery, page?: number, detail?: string) {
    state.log.push({ at: this.dependencies.now(), queryId: query?.queryId, page, event, detail });
    if (state.log.length > 20_000) state.log.splice(0, state.log.length - 20_000);
  }

  async run(state: CollectorState) {
    state.phase = "running";
    await this.dependencies.saveCheckpoint(state);
    for (const query of state.queries) {
      if (query.status === "complete") continue;
      if (this.stopRequested) return this.transition(state, "stopped", "stopped");
      if (this.pauseRequested) return this.transition(state, "paused", "paused");
      const result = await this.runQuery(state, query);
      if (result !== "continue") return state;
    }
    return this.transition(state, "complete", "batch_complete");
  }

  private async runQuery(state: CollectorState, query: CollectorQuery): Promise<"continue" | "halt"> {
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
            await this.transition(state, "directory_unavailable", "directory_unavailable", query, 1);
            return "halt";
          }
          throw error;
        }
      }
      query.capturedRecordCount = 0;
    }
    let validationFailures = 0;
    while (query.pageCount === 0 || query.nextPage <= query.pageCount) {
      if (this.stopRequested) { await this.transition(state, "stopped", "stopped", query, query.nextPage); return "halt"; }
      if (this.pauseRequested) { await this.transition(state, "paused", "paused", query, query.nextPage); return "halt"; }
      let response: PageResponse | undefined;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          response = await this.dependencies.request(query, query.nextPage);
          if (isSessionExpired(response)) throw new SessionExpiredError("login required");
          if (response.status === 429) {
            state.consecutiveServerFailures += 1;
            if (state.consecutiveServerFailures >= 2) return this.circuit(state, query, "consecutive HTTP 429");
            this.log(state, "retry", query, query.nextPage, "HTTP 429");
            await this.dependencies.sleep(retryAfterMilliseconds(response.headers["retry-after"]));
            continue;
          }
          if (response.status >= 500) {
            state.consecutiveServerFailures += 1;
            if (state.consecutiveServerFailures >= 2) return this.circuit(state, query, `consecutive HTTP ${response.status}`);
            throw new Error(`HTTP ${response.status}`);
          }
          if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
          state.consecutiveServerFailures = 0;
          break;
        } catch (error) {
          if (error instanceof SessionExpiredError) {
            query.lastError = error.message;
            await this.transition(state, "session_expired", "session_expired", query, query.nextPage);
            return "halt";
          }
          if (error instanceof DirectoryUnavailableError) {
            query.lastError = error.message;
            await this.transition(state, "directory_unavailable", "directory_unavailable", query, query.nextPage);
            return "halt";
          }
          query.attempts += 1;
          query.lastError = error instanceof Error ? error.message : String(error);
          if (attempt === 4) {
            query.status = "exception";
            this.log(state, "coverage_exception", query, query.nextPage, query.lastError);
            await this.dependencies.saveCheckpoint(state);
            return "continue";
          }
          this.log(state, "retry", query, query.nextPage, query.lastError);
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
          this.log(state, "coverage_exception", query, query.nextPage, query.lastError);
          await this.dependencies.saveCheckpoint(state);
          return "continue";
        }
        this.log(state, "query_validation_retry", query, query.nextPage, query.lastError);
        query.nextPage = 1;
        query.pageCount = 0;
        query.declaredRecordCount = 0;
        query.capturedRecordCount = 0;
        try {
          await this.dependencies.resetQuerySnapshots(query.queryId);
        } catch (resetError) {
          if (resetError instanceof DirectoryUnavailableError) {
            query.lastError = resetError.message;
            await this.transition(state, "directory_unavailable", "directory_unavailable", query, 1);
            return "halt";
          }
          throw resetError;
        }
        await this.dependencies.saveCheckpoint(state);
        await this.dependencies.sleep(retryDelay(1, this.dependencies.random()));
        continue;
      }
      try {
        await this.dependencies.writeSnapshot(query.queryId, query.nextPage, response.bytes);
      } catch (error) {
        if (error instanceof DirectoryUnavailableError) {
          query.lastError = error.message;
          await this.transition(state, "directory_unavailable", "directory_unavailable", query, query.nextPage);
          return "halt";
        }
        throw error;
      }
      this.log(state, "page_complete", query, query.nextPage);
      query.capturedRecordCount += parsePageMetadata(response.bytes).pageRecords;
      query.nextPage += 1;
      state.pagesSinceLongPause += 1;
      await this.dependencies.saveCheckpoint(state);
      if (state.pagesSinceLongPause >= 100) {
        await this.dependencies.sleep(10_000);
        state.pagesSinceLongPause = 0;
      } else {
        await this.dependencies.sleep(400 + Math.round(this.dependencies.random() * 400));
      }
    }
    query.status = "complete";
    query.lastError = undefined;
    this.log(state, "query_complete", query);
    await this.dependencies.saveCheckpoint(state);
    return "continue";
  }

  private async circuit(state: CollectorState, query: CollectorQuery, detail: string): Promise<"halt"> {
    query.lastError = detail;
    await this.transition(state, "circuit_open", "circuit_open", query, query.nextPage, detail);
    return "halt";
  }

  private async transition(state: CollectorState, phase: CollectorState["phase"], event: string, query?: CollectorQuery, page?: number, detail?: string) {
    state.phase = phase;
    this.log(state, event, query, page, detail);
    await this.dependencies.saveCheckpoint(state);
    return state;
  }
}

export function createCollectorState(batchId: string, queries: CollectorQuery[]): CollectorState {
  return { batchId, phase: "idle", queries, consecutiveServerFailures: 0, pagesSinceLongPause: 0, sourceChangeRounds: 0, unresolvedSourceChanges: 0, log: [] };
}
