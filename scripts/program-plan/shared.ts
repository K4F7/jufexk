import { createHash } from "node:crypto";

export const CAPTURE_PACKAGE_SCHEMA_VERSION = "program-plan-capture-package/v1" as const;
export const COVERAGE_SCHEMA_VERSION = "program-plan-coverage/v1" as const;
export const DERIVATION_SCHEMA_VERSION = "program-plan-derivation/v1" as const;
export const COURSE_SCHEMA_VERSION = "program-plan-course/v1" as const;
export const EXCEPTION_SCHEMA_VERSION = "program-plan-exception/v1" as const;
export const CATALOG_MATCH_SCHEMA_VERSION = "program-plan-catalog-match/v1" as const;

export function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertSafePathPart(value: string, name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`invalid ${name}`);
}

const secretPatterns = [
  /\bpassword["']?\s*[:=]/i,
  /\bpasswd["']?\s*[:=]/i,
  /\bcookie["']?\s*:/i,
  /\b(?:access[_-]?token|refresh[_-]?token|session[_-]?token)["']?\s*[:=]/i,
  /\bauthorization["']?\s*:/i,
  /\bticket\s*[:=]/i,
  /学号\s*[：:=]\s*\S/,
  /姓名\s*[：:=]\s*\S/,
];

const sensitiveKey = /^(?:password|passwd|cookie|authorization|.*token.*|session|ticket)$/i;

function decodeViews(bytes: Uint8Array) {
  const views = [Buffer.from(bytes).toString("latin1"), Buffer.from(bytes).toString("utf8")];
  try {
    views.push(new TextDecoder("gbk").decode(bytes));
  } catch {
    /* GBK is unavailable in some runtimes */
  }
  return views;
}

export function assertSafeContent(bytes: Uint8Array, source: string) {
  const views = decodeViews(bytes);
  if (secretPatterns.some((pattern) => views.some((text) => pattern.test(text)))) {
    throw new Error(`unsafe credential content in ${source}`);
  }
  for (const text of views) {
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      let url: URL;
      try {
        url = new URL(match[0]);
      } catch {
        throw new Error(`unsafe URL in ${source}`);
      }
      if (url.protocol !== "https:" || url.hostname !== "jwxt.jxufe.edu.cn") {
        throw new Error(`unsafe cross-origin URL in ${source}`);
      }
    }
  }
}

export function assertSafeParameters(parameters: Record<string, string>, source: string) {
  for (const [key, value] of Object.entries(parameters)) {
    if (sensitiveKey.test(key)) throw new Error(`unsafe credential parameter ${key} in ${source}`);
    assertSafeContent(Buffer.from(value), `${source}.${key}`);
  }
}
