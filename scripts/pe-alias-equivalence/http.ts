import { courseDetailApiPath } from "../../src/lib/public-course-identity";

export const DEFAULT_PRODUCTION_ORIGIN = "https://courses.sein.moe";

export type HttpCapture = {
  method: "GET";
  path: string;
  url: string;
  status: number;
  ok: boolean;
  json: unknown;
  headerNames: string[];
  setCookiePresent: boolean;
  error: string | null;
};

export type PublicGetOptions = {
  origin: string;
  path: string;
  fetch?: typeof fetch;
};

export function assertHttpGetOnly(method: string): asserts method is "GET" {
  if (method.toUpperCase() !== "GET") {
    throw new Error("pe-alias-equivalence 只允许 GET");
  }
}

export function aliasCoursePath(aliasId: string): string {
  if (!/^[1-9]\d*$/.test(aliasId)) {
    throw new Error(`invalid alias id: ${aliasId}`);
  }
  return `/api/courses/${aliasId}`;
}

export function canonicalCoursePath(publicId: string): string {
  return courseDetailApiPath(publicId);
}

/** Colon-only encoding: `/api/courses/pe%3A瑜伽`. */
export function colonEncodedPePath(label: string): string {
  const trimmed = label.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("?")) {
    throw new Error(`invalid PE label: ${label}`);
  }
  return `/api/courses/pe%3A${trimmed}`;
}

export function reviewsPath(coursePath: string, teacherId?: number): string {
  if (!coursePath.startsWith("/api/courses/")) {
    throw new Error(`invalid course path: ${coursePath}`);
  }
  if (teacherId != null && (!Number.isSafeInteger(teacherId) || teacherId <= 0)) {
    throw new Error(`invalid teacherId: ${String(teacherId)}`);
  }
  const suffix =
    teacherId != null
      ? `/reviews?teacherId=${teacherId}&pageSize=50`
      : "/reviews?pageSize=50";
  return `${coursePath}${suffix}`;
}

export function reviewsPathWithCursor(path: string, cursor: string): string {
  const url = new URL(path, "https://pe-alias-equivalence.invalid");
  url.searchParams.set("cursor", cursor);
  return `${url.pathname}${url.search}`;
}

function headerNames(headers: Headers): string[] {
  return [...headers.keys()].sort();
}

function setCookiePresent(headers: Headers): boolean {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie().length > 0;
  }
  return Boolean(headers.get("set-cookie"));
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export async function publicGetJson(options: PublicGetOptions): Promise<HttpCapture> {
  const origin = options.origin.replace(/\/+$/, "");
  const path = options.path.startsWith("/") ? options.path : `/${options.path}`;
  const url = new URL(path, `${origin}/`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported origin protocol: ${url.protocol}`);
  }
  const fetchImpl = options.fetch ?? fetch;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    assertHttpGetOnly("GET");
    const text = await response.text();
    return {
      method: "GET",
      path,
      url: url.toString(),
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json: parseJson(text),
      headerNames: headerNames(response.headers),
      setCookiePresent: setCookiePresent(response.headers),
      error: null,
    };
  } catch (error) {
    return {
      method: "GET",
      path,
      url: url.toString(),
      status: 0,
      ok: false,
      json: null,
      headerNames: [],
      setCookiePresent: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function reviewCursor(json: unknown): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const cursor = (json as { nextCursor?: unknown }).nextCursor;
  return typeof cursor === "string" && cursor ? cursor : null;
}

function reviewItems(json: unknown): unknown[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  const items = (json as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

export async function publicGetReviewPages(options: {
  origin: string;
  coursePath: string;
  teacherId?: number;
  fetch?: typeof fetch;
  maxPages?: number;
}): Promise<HttpCapture> {
  const maxPages = options.maxPages ?? 20;
  const firstPath = reviewsPath(options.coursePath, options.teacherId);
  const pages: HttpCapture[] = [];
  let path = firstPath;
  for (let page = 0; page < maxPages; page += 1) {
    const capture = await publicGetJson({
      origin: options.origin,
      path,
      fetch: options.fetch,
    });
    pages.push(capture);
    if (!capture.ok) return capture;
    const cursor = reviewCursor(capture.json);
    if (!cursor) break;
    path = reviewsPathWithCursor(firstPath, cursor);
  }
  if (pages.length <= 1) return pages[0] ?? {
    method: "GET",
    path: firstPath,
    url: new URL(firstPath, `${options.origin.replace(/\/+$/, "")}/`).toString(),
    status: 0,
    ok: false,
    json: null,
    headerNames: [],
    setCookiePresent: false,
    error: "missing review response",
  };
  const first = pages[0];
  const items = pages.flatMap((page) => reviewItems(page.json));
  const last = pages.at(-1);
  return {
    method: "GET",
    path: firstPath,
    url: first.url,
    status: first.status,
    ok: first.ok,
    json: {
      items,
      nextCursor: reviewCursor(last?.json),
      total:
        last?.json && typeof last.json === "object" && !Array.isArray(last.json)
          ? (last.json as { total?: unknown }).total
          : undefined,
      pageCount: pages.length,
    },
    headerNames: first.headerNames,
    setCookiePresent: pages.some((page) => page.setCookiePresent),
    error: null,
  };
}
