/**
 * 江财 CTA 教师主页匹配与默认头像识别（#664）。
 * 默认占位图 /_jxcj/images/defaulticon.png 不当真人头像存或展示。
 */

export const CTA_HOST = "cta.jxufe.edu.cn";
export const CTA_ORIGIN = `http://${CTA_HOST}`;
export const CTA_FID = 109051;

/** CTA 站点默认剪影头像（defaulticon.png）的 SHA-256。 */
export const CTA_DEFAULT_AVATAR_SHA256 =
  "bdea5d1472e0de2520e6991778178f71c9c7df099b5d339715aac09bc3ccce0f";

export const CTA_INTERNAL_TEACHER_KEYS = [
  "cta_fid",
  "cta_uid",
  "homepage_url",
  "homepage_locked",
  "homepage_match",
  "image_locked",
  "cta_synced_at",
  "avatar_sha256",
] as const;

export type CtaHomepageMatch = "none" | "unique" | "ambiguous" | "manual";

export type CtaTeacherCandidate = {
  uid: number;
  realname: string;
  photo: string | null;
  deptName: string | null;
};

export type CtaMatchDecision =
  | { kind: "unique"; candidate: CtaTeacherCandidate }
  | { kind: "ambiguous" }
  | { kind: "none" };

const DEFAULT_ICON_PATH = "/_jxcj/images/defaulticon.png";

export function ctaHomepageUrl(uid: number, fid = CTA_FID): string {
  return `${CTA_ORIGIN}/home/teacherInfo/detail?fid=${fid}&uid=${uid}`;
}

export function parseCtaHomepageUrl(
  url: string,
): { fid: number; uid: number } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname !== CTA_HOST) return null;
    if (parsed.pathname !== "/home/teacherInfo/detail") return null;
    const fid = Number(parsed.searchParams.get("fid"));
    const uid = Number(parsed.searchParams.get("uid"));
    if (!Number.isSafeInteger(fid) || fid <= 0) return null;
    if (!Number.isSafeInteger(uid) || uid <= 0) return null;
    return { fid, uid };
  } catch {
    return null;
  }
}

export function isAllowedCtaHomepageUrl(url: string): boolean {
  return parseCtaHomepageUrl(url) != null;
}

export function catalogSearchNames(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const names = [trimmed];
  const stripped = trimmed.replace(/\d+$/u, "");
  if (stripped && stripped !== trimmed) names.push(stripped);
  return names;
}

export function normalizeDepartmentHint(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/（[^）]*）/gu, "")
    .replace(/\([^)]*\)/gu, "")
    .split(/[、，,／/]/u)[0]
    .replace(/\s+/gu, "")
    .trim();
}

export function departmentsCompatible(
  catalogDepartment: string | null | undefined,
  ctaDepartment: string | null | undefined,
): boolean {
  const catalog = normalizeDepartmentHint(catalogDepartment);
  const cta = normalizeDepartmentHint(ctaDepartment);
  if (!catalog || !cta) return false;
  return catalog.includes(cta) || cta.includes(catalog);
}

function nameMatchesCatalog(catalogName: string, ctaName: string): boolean {
  const wanted = catalogSearchNames(catalogName);
  const actual = ctaName.trim();
  return wanted.includes(actual);
}

export function chooseCtaMatch(
  teacher: { name: string; department?: string | null },
  candidates: readonly CtaTeacherCandidate[],
): CtaMatchDecision {
  const nameHits = candidates.filter((candidate) =>
    nameMatchesCatalog(teacher.name, candidate.realname),
  );
  if (nameHits.length === 0) return { kind: "none" };
  const catalogDepartment = normalizeDepartmentHint(teacher.department);
  const departmentHits = nameHits.filter((candidate) =>
    departmentsCompatible(teacher.department, candidate.deptName),
  );
  if (nameHits.length === 1) {
    if (catalogDepartment && departmentHits.length === 0) return { kind: "none" };
    return { kind: "unique", candidate: nameHits[0] };
  }
  if (departmentHits.length === 1) {
    return { kind: "unique", candidate: departmentHits[0] };
  }
  return { kind: "ambiguous" };
}

export function isUsableCtaPhotoId(photo: string | null | undefined): boolean {
  if (!photo) return false;
  const id = photo.trim();
  if (!id) return false;
  if (/defaulticon/i.test(id)) return false;
  return /^[a-zA-Z0-9_-]{8,128}$/.test(id);
}

export function ctaPhotoUrl(photo: string | null | undefined): string | null {
  if (!isUsableCtaPhotoId(photo)) return null;
  return `https://p.ananas.chaoxing.com/star3/origin/${encodeURIComponent(photo!.trim())}.png`;
}

export function isDefaultCtaAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url, CTA_ORIGIN);
    if (parsed.pathname.toLowerCase() === DEFAULT_ICON_PATH) return true;
    return /(?:^|\/)defaulticon\.png$/i.test(parsed.pathname);
  } catch {
    return /defaulticon\.png/i.test(url);
  }
}

export function isDefaultCtaAvatarSha256(sha256: string): boolean {
  return sha256.trim().toLowerCase() === CTA_DEFAULT_AVATAR_SHA256;
}

export async function sha256Hex(
  data: BufferSource | Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function publicTeacherAvatarPath(teacherId: number): string {
  return `/api/teachers/${teacherId}/avatar`;
}

export function toPublicTeacher<T extends Record<string, unknown>>(
  row: T,
): T & {
  official_homepage_url: string | null;
  avatar_url: string | null;
} {
  const publicRow = { ...row } as T & {
    official_homepage_url: string | null;
    avatar_url: string | null;
  };
  for (const key of CTA_INTERNAL_TEACHER_KEYS) {
    delete (publicRow as Record<string, unknown>)[key];
  }
  const id = Number(row.id);
  const imageLocked = Number(row.image_locked) === 1;
  const homepage =
    typeof row.homepage_url === "string" ? row.homepage_url.trim() : "";
  const sha =
    typeof row.avatar_sha256 === "string" ? row.avatar_sha256.trim() : "";
  publicRow.official_homepage_url =
    homepage && isAllowedCtaHomepageUrl(homepage) ? homepage : null;
  publicRow.avatar_url =
    Number.isSafeInteger(id) &&
    id > 0 &&
    !imageLocked &&
    sha &&
    !isDefaultCtaAvatarSha256(sha)
      ? publicTeacherAvatarPath(id)
      : null;
  return publicRow;
}
