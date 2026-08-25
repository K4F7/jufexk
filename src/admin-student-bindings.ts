import {
  AUTH_PROVIDER_CAS,
  CAS_IDENTITY_ISSUER,
} from "./ordinary-user-identity";
import { hmacHex } from "./ordinary-user-authentication";
import { normalizeCasUsername } from "./lib/jxufe-cas";

export const ADMIN_STUDENT_BINDING_MAX = 20;

export type AdminStudentBinding = {
  id: number;
  created_at: string;
};

export function casUsernameSubjectInput(username: string) {
  return `cas-username:${username}`;
}

export async function casSubjectHash(username: string, identitySecret: string) {
  return hmacHex(casUsernameSubjectInput(username), identitySecret);
}

function splitUsernameText(raw: string) {
  return raw
    .split(/[\s,，;；]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Accept `{ usernames: string[] }` and/or `{ text }` (comma / newline /
 * whitespace separated). Normalize with the CAS username rules.
 */
export function parseBindingUsernames(body: unknown):
  | { ok: true; usernames: string[] }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "学号格式不正确" };
  }
  const record = body as Record<string, unknown>;
  const collected: string[] = [];
  if (Array.isArray(record.usernames)) {
    for (const item of record.usernames) {
      if (typeof item !== "string") {
        return { ok: false, error: "学号格式不正确" };
      }
      collected.push(item);
    }
  }
  if (record.text !== undefined && record.text !== null) {
    if (typeof record.text !== "string") {
      return { ok: false, error: "学号格式不正确" };
    }
    collected.push(...splitUsernameText(record.text));
  }
  if (collected.length === 0) return { ok: false, error: "请填写至少一条学号" };

  const usernames: string[] = [];
  const seen = new Set<string>();
  for (const raw of collected) {
    const username = normalizeCasUsername(raw);
    if (!username) return { ok: false, error: "学号格式不正确" };
    if (seen.has(username)) continue;
    seen.add(username);
    usernames.push(username);
  }
  if (usernames.length > ADMIN_STUDENT_BINDING_MAX) {
    return { ok: false, error: `一次最多绑定 ${ADMIN_STUDENT_BINDING_MAX} 个学号` };
  }
  return { ok: true, usernames };
}

export async function listAdminStudentBindings(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT id, created_at FROM admin_student_bindings ORDER BY id DESC`,
    )
    .all<AdminStudentBinding>();
  return result.results || [];
}

export async function addAdminStudentBindings(
  db: D1Database,
  subjectHashes: string[],
) {
  let added = 0;
  let skipped = 0;
  for (const subjectHash of subjectHashes) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO admin_student_bindings(subject_hash) VALUES(?)`,
      )
      .bind(subjectHash)
      .run();
    if ((result.meta.changes || 0) === 1) added += 1;
    else skipped += 1;
  }
  return { added, skipped };
}

export async function deleteAdminStudentBinding(db: D1Database, id: number) {
  const result = await db
    .prepare(`DELETE FROM admin_student_bindings WHERE id=?`)
    .bind(id)
    .run();
  return (result.meta.changes || 0) === 1;
}

export async function loadUserCasSubject(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      `SELECT subject FROM auth_identities
       WHERE user_id=? AND provider=? AND issuer=?`,
    )
    .bind(userId, AUTH_PROVIDER_CAS, CAS_IDENTITY_ISSUER)
    .first<{ subject: string }>();
  return row?.subject || null;
}

export async function casSubjectIsAdminBound(db: D1Database, subject: string) {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM admin_student_bindings WHERE subject_hash=?`)
    .bind(subject)
    .first<{ ok: number }>();
  return !!row;
}

/**
 * When the allowlist is empty, the first authenticated CAS identity claims
 * admin. Later campus users still need an explicit bind.
 * The INSERT is atomic so two empty-list claims cannot both succeed.
 */
export async function claimFirstAdminStudentBinding(
  db: D1Database,
  subject: string,
) {
  const result = await db
    .prepare(
      `INSERT INTO admin_student_bindings(subject_hash)
       SELECT ? WHERE NOT EXISTS (SELECT 1 FROM admin_student_bindings)`,
    )
    .bind(subject)
    .run();
  return (result.meta.changes || 0) === 1;
}
