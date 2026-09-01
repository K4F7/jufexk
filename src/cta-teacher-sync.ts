import {
  chooseCtaMatch,
  CTA_FID,
  CTA_ORIGIN,
  ctaHomepageUrl,
  ctaPhotoUrl,
  catalogSearchNames,
  departmentsCompatible,
  isDefaultCtaAvatarSha256,
  isDefaultCtaAvatarUrl,
  parseCtaHomepageUrl,
  sha256Hex,
  type CtaHomepageMatch,
  type CtaTeacherCandidate,
} from "./cta-teacher-homepage";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const CTA_PHOTO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ALLOWED_AVATAR_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export type CtaSearchQuery = {
  teaName: string;
  page?: number;
  pageSize?: number;
};

export type CtaPhotoResponse = {
  bytes: Uint8Array;
  contentType: string;
  url: string;
};

export type CtaSearchResult = {
  candidates: CtaTeacherCandidate[];
  total: number;
  truncated: boolean;
};

export type CtaTeacherClient = {
  searchTeachers(query: CtaSearchQuery): Promise<CtaSearchResult>;
  fetchTeacherPhotoId(uid: number): Promise<string | null>;
  fetchPhoto(url: string): Promise<CtaPhotoResponse | null>;
};

export type TeacherCtaRow = {
  id: number;
  name: string;
  department: string | null;
  cta_fid: number | null;
  cta_uid: number | null;
  homepage_url: string | null;
  homepage_locked: number;
  homepage_match: CtaHomepageMatch;
  image_locked: number;
  avatar_sha256: string | null;
};

export type TeacherCtaSyncResult = {
  teacherId: number;
  match: CtaHomepageMatch;
  homepageUrl: string | null;
  avatarStored: boolean;
  skippedDefaultAvatar: boolean;
};

type SearchTeachersJson = {
  result?: number;
  totalResult?: number;
  teachersInfos?: Array<{
    uid?: unknown;
    realname?: unknown;
    photo?: unknown;
    deptName?: unknown;
  }>;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseCandidate(row: {
  uid?: unknown;
  realname?: unknown;
  photo?: unknown;
  deptName?: unknown;
}): CtaTeacherCandidate | null {
  const uid = Number(row.uid);
  const realname = asTrimmedString(row.realname);
  if (!Number.isSafeInteger(uid) || uid <= 0 || !realname) return null;
  const photo = asTrimmedString(row.photo);
  const deptName = asTrimmedString(row.deptName);
  return {
    uid,
    realname,
    photo: photo || null,
    deptName: deptName || null,
  };
}

function normalizeContentType(value: string | null, url: string): string {
  const raw = (value || "").split(";")[0].trim().toLowerCase();
  if (raw === "image/jpg") return "image/jpeg";
  if (ALLOWED_AVATAR_TYPES.has(raw)) {
    return raw === "image/jpg" ? "image/jpeg" : raw;
  }
  if (/\.jpe?g(?:$|[?#])/i.test(url)) return "image/jpeg";
  if (/\.webp(?:$|[?#])/i.test(url)) return "image/webp";
  return "image/png";
}

export function createHttpCtaClient(
  fetchImpl: typeof fetch = fetch,
): CtaTeacherClient {
  return {
    async searchTeachers(query) {
      const body = new URLSearchParams({
        fid: String(CTA_FID),
        academicTitle: "",
        teaName: query.teaName,
        researchFields: "",
        groupname: "",
        page: String(query.page ?? 1),
        pageSize: String(query.pageSize ?? 40),
      });
      const response = await fetchImpl(`${CTA_ORIGIN}/searchTeachers`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!response.ok) return { candidates: [], total: 0, truncated: false };
      const json = (await response.json()) as SearchTeachersJson;
      if (json.result !== 1 || !Array.isArray(json.teachersInfos)) {
        return { candidates: [], total: 0, truncated: false };
      }
      const candidates = json.teachersInfos
        .map(parseCandidate)
        .filter((row): row is CtaTeacherCandidate => row != null);
      const total = Number(json.totalResult) || candidates.length;
      return {
        candidates,
        total,
        truncated: total > candidates.length,
      };
    },
    async fetchTeacherPhotoId(uid) {
      const body = new URLSearchParams({
        fid: String(CTA_FID),
        uid: String(uid),
        isPreview: "1",
      });
      const response = await fetchImpl(`${CTA_ORIGIN}/home/teachInfo`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!response.ok) return null;
      const json = (await response.json()) as { result?: number; data?: unknown };
      if (json.result !== 1) return null;
      let payload = json.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload) as unknown;
        } catch {
          return null;
        }
      }
      const photo = (payload as { teacherInfo?: { photo?: unknown } } | null)
        ?.teacherInfo?.photo;
      return asTrimmedString(photo) || null;
    },
    async fetchPhoto(url) {
      if (isDefaultCtaAvatarUrl(url)) return null;
      const response = await fetchImpl(url, {
        headers: {
          Accept: "image/*",
          Referer: `${CTA_ORIGIN}/`,
          "User-Agent": CTA_PHOTO_USER_AGENT,
        },
      });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > MAX_AVATAR_BYTES) return null;
      return {
        bytes,
        contentType: normalizeContentType(
          response.headers.get("content-type"),
          url,
        ),
        url,
      };
    },
  };
}

export async function fetchCtaTeacherDirectory(
  client: CtaTeacherClient,
  pageSize = 40,
): Promise<CtaTeacherCandidate[]> {
  const seen = new Set<number>();
  const all: CtaTeacherCandidate[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (all.length < total) {
    const result = await client.searchTeachers({
      teaName: "",
      page,
      pageSize,
    });
    if (page === 1) total = result.total || result.candidates.length;
    for (const candidate of result.candidates) {
      if (seen.has(candidate.uid)) continue;
      seen.add(candidate.uid);
      all.push(candidate);
    }
    if (!result.candidates.length) break;
    page += 1;
    if (page > 200) break;
  }
  return all;
}

async function searchCandidates(
  client: CtaTeacherClient,
  name: string,
): Promise<CtaSearchResult> {
  const seen = new Set<number>();
  const merged: CtaTeacherCandidate[] = [];
  let truncated = false;
  for (const teaName of catalogSearchNames(name)) {
    const page = await client.searchTeachers({ teaName });
    truncated = truncated || page.truncated || page.total > page.candidates.length;
    for (const candidate of page.candidates) {
      if (seen.has(candidate.uid)) continue;
      seen.add(candidate.uid);
      merged.push(candidate);
    }
  }
  return { candidates: merged, total: merged.length, truncated };
}

async function clearStoredAvatar(db: D1Database, teacherId: number) {
  const existing = await db
    .prepare("SELECT 1 FROM teacher_avatars WHERE teacher_id=? LIMIT 1")
    .bind(teacherId)
    .first();
  if (!existing) {
    await db
      .prepare("UPDATE teachers SET avatar_sha256=NULL WHERE id=? AND avatar_sha256 IS NOT NULL")
      .bind(teacherId)
      .run();
    return;
  }
  await db.batch([
    db.prepare("DELETE FROM teacher_avatars WHERE teacher_id=?").bind(teacherId),
    db.prepare("UPDATE teachers SET avatar_sha256=NULL WHERE id=? AND avatar_sha256 IS NOT NULL").bind(teacherId),
  ]);
}

async function storeAvatar(
  db: D1Database,
  teacherId: number,
  photo: CtaPhotoResponse,
): Promise<{ stored: boolean; skippedDefaultAvatar: boolean }> {
  if (isDefaultCtaAvatarUrl(photo.url)) {
    await clearStoredAvatar(db, teacherId);
    return { stored: false, skippedDefaultAvatar: true };
  }
  if (!ALLOWED_AVATAR_TYPES.has(photo.contentType)) {
    return { stored: false, skippedDefaultAvatar: false };
  }
  const sha = await sha256Hex(photo.bytes);
  if (isDefaultCtaAvatarSha256(sha)) {
    await clearStoredAvatar(db, teacherId);
    return { stored: false, skippedDefaultAvatar: true };
  }
  const existing = await db
    .prepare("SELECT content_type,sha256,source_url FROM teacher_avatars WHERE teacher_id=?")
    .bind(teacherId)
    .first<{ content_type: string; sha256: string; source_url: string }>();
  if (
    existing?.sha256 === sha &&
    existing.content_type === photo.contentType &&
    existing.source_url === photo.url
  ) {
    return { stored: true, skippedDefaultAvatar: false };
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO teacher_avatars(teacher_id,content_type,sha256,bytes,source_url,fetched_at)
         VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(teacher_id) DO UPDATE SET
           content_type=excluded.content_type,
           sha256=excluded.sha256,
           bytes=excluded.bytes,
           source_url=excluded.source_url,
           fetched_at=excluded.fetched_at`,
      )
      .bind(
        teacherId,
        photo.contentType,
        sha,
        photo.bytes,
        photo.url,
      ),
    db
      .prepare("UPDATE teachers SET avatar_sha256=? WHERE id=?")
      .bind(sha, teacherId),
  ]);
  return { stored: true, skippedDefaultAvatar: false };
}

export async function syncTeacherCtaHomepage(
  db: D1Database,
  teacherId: number,
  client: CtaTeacherClient = createHttpCtaClient(),
): Promise<TeacherCtaSyncResult> {
  const teacher = await db
    .prepare(
      `SELECT id,name,department,cta_fid,cta_uid,homepage_url,homepage_locked,
              homepage_match,image_locked,avatar_sha256
         FROM teachers WHERE id=?`,
    )
    .bind(teacherId)
    .first<TeacherCtaRow>();
  if (!teacher) {
    throw new Error("教师不存在");
  }

  let match: CtaHomepageMatch = teacher.homepage_match;
  let homepageUrl = teacher.homepage_url;
  let fid = teacher.cta_fid;
  let uid = teacher.cta_uid;
  let photoId: string | null = null;

  if (teacher.homepage_locked === 1) {
    const parsed = homepageUrl ? parseCtaHomepageUrl(homepageUrl) : null;
    if (parsed) {
      fid = parsed.fid;
      uid = parsed.uid;
    }
  } else {
    const searched = await searchCandidates(client, teacher.name);
    let decision = chooseCtaMatch(teacher, searched.candidates);
    if (
      searched.truncated &&
      decision.kind === "unique" &&
      !departmentsCompatible(teacher.department, decision.candidate.deptName)
    ) {
      decision = searched.candidates.length
        ? { kind: "ambiguous" }
        : { kind: "none" };
    }
    if (decision.kind === "unique") {
      match = "unique";
      fid = CTA_FID;
      uid = decision.candidate.uid;
      homepageUrl = ctaHomepageUrl(uid, fid);
      photoId = decision.candidate.photo;
    } else if (decision.kind === "ambiguous") {
      match = "ambiguous";
      if (teacher.homepage_match !== "unique" && teacher.homepage_match !== "manual") {
        fid = null;
        uid = null;
        homepageUrl = null;
      }
    } else if (teacher.homepage_match !== "manual") {
      match = "none";
      fid = null;
      uid = null;
      homepageUrl = null;
    }
  }

  await db
    .prepare(
      `UPDATE teachers
          SET cta_fid=?,cta_uid=?,homepage_url=?,homepage_match=?,cta_synced_at=CURRENT_TIMESTAMP
        WHERE id=? AND (cta_fid IS NOT ? OR cta_uid IS NOT ? OR homepage_url IS NOT ? OR homepage_match IS NOT ?)`,
    )
    .bind(fid, uid, homepageUrl, match, teacherId, fid, uid, homepageUrl, match)
    .run();

  if (teacher.image_locked === 1) {
    await clearStoredAvatar(db, teacherId);
    return {
      teacherId,
      match,
      homepageUrl,
      avatarStored: false,
      skippedDefaultAvatar: false,
    };
  }

  if (uid != null) {
    const detailPhoto = await client.fetchTeacherPhotoId(uid);
    if (detailPhoto) photoId = detailPhoto;
  }

  const photoUrl = photoId ? ctaPhotoUrl(photoId) : null;
  if (!photoUrl) {
    const skippedDefaultAvatar = Boolean(photoId) && !photoUrl;
    if (skippedDefaultAvatar) await clearStoredAvatar(db, teacherId);
    return {
      teacherId,
      match,
      homepageUrl,
      avatarStored: false,
      skippedDefaultAvatar,
    };
  }

  const photo = await client.fetchPhoto(photoUrl);
  if (!photo) {
    if (isDefaultCtaAvatarUrl(photoUrl)) {
      await clearStoredAvatar(db, teacherId);
      return {
        teacherId,
        match,
        homepageUrl,
        avatarStored: false,
        skippedDefaultAvatar: true,
      };
    }
    return {
      teacherId,
      match,
      homepageUrl,
      avatarStored: Boolean(teacher.avatar_sha256),
      skippedDefaultAvatar: false,
    };
  }

  const stored = await storeAvatar(db, teacherId, photo);
  return {
    teacherId,
    match,
    homepageUrl,
    avatarStored: stored.stored,
    skippedDefaultAvatar: stored.skippedDefaultAvatar,
  };
}

export async function syncTeacherCtaHomepageBatch(
  db: D1Database,
  options: { teacherId?: number; limit?: number } = {},
  client: CtaTeacherClient = createHttpCtaClient(),
): Promise<TeacherCtaSyncResult[]> {
  if (options.teacherId) {
    return [await syncTeacherCtaHomepage(db, options.teacherId, client)];
  }
  const limit = Math.min(Math.max(options.limit ?? 15, 1), 40);
  const { results } = await db
    .prepare(
      `SELECT id FROM teachers
        WHERE homepage_locked=0
        ORDER BY CASE WHEN homepage_url IS NULL OR homepage_url='' THEN 0 ELSE 1 END,
                 cta_synced_at IS NOT NULL, cta_synced_at, id
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: number }>();
  const synced: TeacherCtaSyncResult[] = [];
  for (const row of results) {
    synced.push(await syncTeacherCtaHomepage(db, row.id, client));
  }
  return synced;
}
