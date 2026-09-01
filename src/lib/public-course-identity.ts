import { normalizeConfirmedPeSpecialization } from "./pe-specialization-mapping";
import {
  VIRTUAL_PE_SPORTS,
  isVirtualPeSportId,
  virtualPeSportById,
} from "./public-course-presentation";
import {
  PUBLIC_COURSE_IDENTITY_PREFIX,
  PUBLIC_PE_COURSE_IDENTITY_PREFIX,
  PUBLIC_RELATION_IDENTITY_PREFIX,
  publicPeCourseIdentity,
} from "./public-pe-course-projection";

export type ParsedPublicCourseParam =
  | { kind: "numeric"; id: number }
  | { kind: "pe"; specialization: string; teacherId?: number }
  | { kind: "invalid" };

const PE_RELATION_SUFFIX = /^(.*):([1-9]\d*)$/;

function decodeCourseParam(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parsePePublicIdentity(value: string): {
  specialization: string;
  teacherId?: number;
} | null {
  if (!value.startsWith(PUBLIC_PE_COURSE_IDENTITY_PREFIX)) return null;
  const rest = value.slice(PUBLIC_PE_COURSE_IDENTITY_PREFIX.length).trim();
  if (!rest) return null;
  const relation = PE_RELATION_SUFFIX.exec(rest);
  if (relation) {
    const specialization = relation[1].trim();
    const teacherId = Number(relation[2]);
    if (
      !specialization ||
      !Number.isSafeInteger(teacherId) ||
      teacherId <= 0
    ) {
      return null;
    }
    return { specialization, teacherId };
  }
  return { specialization: rest };
}

export function parsePublicCourseParam(
  raw: string | undefined,
): ParsedPublicCourseParam {
  const decoded = decodeCourseParam((raw ?? "").trim()).trim();
  if (!decoded) return { kind: "invalid" };
  if (/^(?:0|[1-9]\d*)$/.test(decoded)) {
    const id = Number(decoded);
    if (!Number.isSafeInteger(id) || id <= 0) return { kind: "invalid" };
    return { kind: "numeric", id };
  }
  const pe = parsePePublicIdentity(decoded);
  if (!pe) return { kind: "invalid" };
  return { kind: "pe", ...pe };
}

export function normalizePublicPeSpecialization(
  raw: string | undefined,
): string | null {
  return normalizeConfirmedPeSpecialization(raw);
}

export function virtualPeAliasSpecialization(id: number): string | null {
  if (!isVirtualPeSportId(id)) return null;
  return virtualPeSportById(id)?.label ?? null;
}

export function virtualPeSportForSpecialization(specialization: string) {
  const normalized = specialization.trim();
  return (
    VIRTUAL_PE_SPORTS.find((sport) => sport.label === normalized) ?? null
  );
}

export function publicPeCourseIdentityFromParam(parsed: {
  specialization: string;
}): string {
  const normalized =
    normalizePublicPeSpecialization(parsed.specialization) ??
    parsed.specialization.trim();
  return publicPeCourseIdentity(normalized);
}

/** Course-page identity: `pe:<spec>` or a numeric Course / alias id. */
export function publicCoursePageIdentity(input: {
  public_id?: string | null;
  course_id?: number | null;
  id?: number | null;
}): string | null {
  const publicId = (input.public_id ?? "").trim();
  if (publicId.startsWith(PUBLIC_PE_COURSE_IDENTITY_PREFIX)) {
    const parsed = parsePePublicIdentity(publicId);
    if (!parsed) return publicId;
    return publicPeCourseIdentity(parsed.specialization);
  }
  if (publicId.startsWith(PUBLIC_COURSE_IDENTITY_PREFIX)) {
    const id = publicId.slice(PUBLIC_COURSE_IDENTITY_PREFIX.length);
    return id || null;
  }
  if (publicId.startsWith(PUBLIC_RELATION_IDENTITY_PREFIX)) {
    const rest = publicId.slice(PUBLIC_RELATION_IDENTITY_PREFIX.length);
    const courseId = rest.split(":")[0];
    if (courseId && courseId !== "none") return courseId;
  }
  if (input.course_id != null) return String(input.course_id);
  if (input.id != null) return String(input.id);
  return null;
}

export function encodeCourseIdentityParam(identity: string): string {
  return encodeURIComponent(identity);
}

export function courseDetailApiPath(identity: string, suffix = ""): string {
  return `/api/courses/${encodeCourseIdentityParam(identity)}${suffix}`;
}

export function courseDetailHref(
  identity: string,
  teacherId?: number | null,
  search = "",
): string {
  const sp = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  if (teacherId != null) sp.set("teacher", String(teacherId));
  else sp.delete("teacher");
  const query = sp.toString();
  return `/courses/${encodeCourseIdentityParam(identity)}${query ? `?${query}` : ""}`;
}

export function publicCourseMatchesParam(
  course: { id?: number | null; public_id?: string | null },
  param: string | undefined,
): boolean {
  if (!param) return false;
  const parsed = parsePublicCourseParam(param);
  const publicId = (course.public_id ?? "").trim();
  if (parsed.kind === "pe") {
    const expected = publicPeCourseIdentityFromParam(parsed);
    return publicId === expected || publicId === publicPeCourseIdentity(parsed.specialization);
  }
  if (parsed.kind === "numeric") {
    if (course.id === parsed.id) return true;
    const alias = virtualPeAliasSpecialization(parsed.id);
    return Boolean(alias && publicId === publicPeCourseIdentity(alias));
  }
  return false;
}
