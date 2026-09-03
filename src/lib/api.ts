let csrf = "";
/** 管理员会话的 CSRF 独立于普通用户（jufexk_csrf vs jufexk_user_csrf）。 */
let adminCsrf = "";

export function setCsrfToken(token: string) {
  csrf = token || "";
}

export function getCsrfToken() {
  return csrf;
}

export function setAdminCsrfToken(token: string) {
  adminCsrf = token || "";
}

export function getAdminCsrfToken() {
  return adminCsrf;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function apiErrorMessage(data: unknown): string {
  if (
    data !== null &&
    typeof data === "object" &&
    "error" in data &&
    typeof data.error === "string" &&
    data.error
  ) {
    return data.error;
  }
  return "请求失败";
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  // 两套会话共存时按路径选 CSRF：/api/admin/* 用管理员令牌，
  // 其余用普通用户令牌，避免互相覆盖导致 403。
  const scopedCsrf = path.startsWith("/api/admin/") ? adminCsrf : csrf;
  if (scopedCsrf && options.method && options.method !== "GET") {
    headers.set("X-CSRF-Token", scopedCsrf);
  }
  const response = await fetch(path, { ...options, headers });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError(apiErrorMessage(data), response.status, data);
  }
  if ((options.method || "GET").toUpperCase() !== "GET") {
    // Mutations can change any public projection; invalidate in-memory intent
    // prefetched data without coupling the low-level API helper statically.
    void import("./catalog-data-cache").then(({ clearCatalogDataCache }) =>
      clearCatalogDataCache(),
    );
  }
  return data as T;
}
