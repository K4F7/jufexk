let csrf = "";

export function setCsrfToken(token: string) {
  csrf = token || "";
}

export function getCsrfToken() {
  return csrf;
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
  if (csrf && options.method && options.method !== "GET") {
    headers.set("X-CSRF-Token", csrf);
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
