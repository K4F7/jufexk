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

export async function api<T = any>(
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
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError(data?.error || "请求失败", response.status, data);
  }
  return data as T;
}
