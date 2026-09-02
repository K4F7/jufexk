import {
  isVirtualPeSportId,
  VIRTUAL_PE_SPORTS,
} from "../../src/lib/public-course-presentation";
import { publicPeCourseIdentity } from "../../src/lib/public-pe-course-projection";
import type { HttpCapture } from "./http";

export const PE_ALIAS_EQUIVALENCE_SCHEMA = "pe-alias-equivalence/v1" as const;

export const PE_ALIAS_EQUIVALENCE_DATA_SCOPE =
  "对生产公开 HTTP（默认 origin https://courses.sein.moe）做 GET-only smoke：800001/800002 旧读取 alias 与 pe:瑜伽 / pe:武术 canonical（含 encodeURIComponent 与 pe%3A专项 形式）的课程详情与评价流。比较公开身份、展示名、教师 id、评价 id（不含正文）。不登录、不发送 Cookie、不 POST/PUT/PATCH/DELETE，不读取评价正文、学号或 CAS 凭据。";

export const PE_ALIAS_EQUIVALENCE_FALLBACK_NOTE =
  "VIRTUAL_PE_SPORTS / 800001/800002 fallback 必须保留：#844 生产映射覆盖 30.12%（100/332），瑜伽 mapped 0、武术 mapped 0。#847 在覆盖完成前不得删除 fallback。";

const PRIVACY_DENIED_KEY_PATTERN =
  /email|cookie|studentid|submitterhash|moderatornote|authoruserid|^userid$|^note$|^html$|^cas$|^password$|^session$/i;

export type PeAliasPairSpec = {
  aliasId: string;
  label: string;
  canonicalPublicId: string;
  expectedTeacherNames: string[];
};

export const PE_ALIAS_PAIRS: PeAliasPairSpec[] = VIRTUAL_PE_SPORTS.map((sport) => ({
  aliasId: String(sport.id),
  label: sport.label,
  canonicalPublicId: publicPeCourseIdentity(sport.label),
  expectedTeacherNames: [...sport.teacherNames],
}));

export type PeReadTargetKind = "mapped" | "virtual" | "ordinary" | "missing" | "mixed";

export type CriterionResult = {
  pass: boolean;
  detail: string;
};

export type IdentitySummary = {
  publicId: string | null;
  name: string | null;
  courseId: number | null;
  category: string | null;
  reviewCount: number | null;
};

export type TeacherSummary = {
  id: number;
  name: string;
};

export type ReviewRef = {
  id: string;
  teacherId: number | null;
  courseId: number | null;
  courseName: string | null;
};

export type EndpointSummary = {
  path: string;
  status: number;
  ok: boolean;
  error: string | null;
  identity: IdentitySummary | null;
  teachers: TeacherSummary[];
  reviewRefs: ReviewRef[];
  jsonKeys: string[];
  setCookiePresent: boolean;
};

export type PeAliasPairResult = {
  label: string;
  aliasId: string;
  canonicalPublicId: string;
  canonicalComparedPath: string;
  readTarget: PeReadTargetKind;
  equivalent: boolean;
  identityMatch: boolean;
  teacherMatch: boolean;
  reviewMatch: boolean;
  privacyClean: boolean;
  alias: {
    detail: EndpointSummary;
    reviews: EndpointSummary;
    teacherReviews: EndpointSummary[];
  };
  canonical: {
    detail: EndpointSummary;
    reviews: EndpointSummary;
    teacherReviews: EndpointSummary[];
  };
  extraCanonical: Array<{ path: string; status: number; ok: boolean }>;
  identity: {
    alias: IdentitySummary | null;
    canonical: IdentitySummary | null;
  };
  teachers: {
    aliasIds: number[];
    canonicalIds: number[];
    aliasNames: string[];
    canonicalNames: string[];
    unexpectedNames: string[];
  };
  reviews: {
    aliasIds: string[];
    canonicalIds: string[];
    unscopedAliasIds: string[];
    unscopedCanonicalIds: string[];
    crossSportReviewIds: string[];
    courseNames: string[];
  };
  privacy: {
    deniedKeys: string[];
    jsonKeys: string[];
  };
};

export type PeAliasEquivalenceReport = {
  schemaVersion: typeof PE_ALIAS_EQUIVALENCE_SCHEMA;
  requestedAt: string;
  origin: string;
  deploySha: string;
  workerVersionId: string | null;
  dataScope: string;
  readOnly: true;
  method: "GET";
  pairs: PeAliasPairResult[];
  criteria: {
    aliasReadable: CriterionResult;
    identityEquivalent: CriterionResult;
    teacherScope: CriterionResult;
    reviewScope: CriterionResult;
    privacy: CriterionResult;
    metadataPresent: CriterionResult;
  };
  equivalent: boolean;
  fallbackVirtual: boolean;
  leftoverFor847: string;
};

export type PeAliasPairCaptures = {
  spec: PeAliasPairSpec;
  aliasDetail: HttpCapture;
  aliasReviews: HttpCapture;
  aliasTeacherReviews: HttpCapture[];
  canonicalDetail: HttpCapture;
  canonicalReviews: HttpCapture;
  canonicalTeacherReviews: HttpCapture[];
  extraCanonical: HttpCapture[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

export function collectJsonKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonKeys(item, keys);
    return keys;
  }
  const record = asRecord(value);
  if (!record) return keys;
  for (const [key, item] of Object.entries(record)) {
    keys.add(key);
    collectJsonKeys(item, keys);
  }
  return keys;
}

export function isDeniedPrivacyKey(key: string): boolean {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PRIVACY_DENIED_KEY_PATTERN.test(compact);
}

export function deniedPrivacyKeys(value: unknown): string[] {
  return [...collectJsonKeys(value)].filter(isDeniedPrivacyKey).sort();
}

function courseRecord(json: unknown): Record<string, unknown> | null {
  const root = asRecord(json);
  if (!root) return null;
  return asRecord(root.course);
}

function identityFromDetail(json: unknown): IdentitySummary | null {
  const course = courseRecord(json);
  if (!course) return null;
  const root = asRecord(json);
  return {
    publicId: asNullableString(course.public_id),
    name: asNullableString(course.name),
    courseId: asNullableNumber(course.id),
    category: asNullableString(course.category),
    reviewCount: asNullableNumber(root?.reviewCount),
  };
}

export function teachersFromDetail(json: unknown): TeacherSummary[] {
  const course = courseRecord(json);
  const raw = course?.teachers;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = asRecord(item);
      const id = asNullableNumber(row?.id);
      const name = asNullableString(row?.name) ?? "";
      if (id == null || id <= 0) return null;
      return { id, name };
    })
    .filter((row): row is TeacherSummary => row != null)
    .sort((left, right) => left.id - right.id || left.name.localeCompare(right.name, "zh"));
}

function reviewRefsFromJson(json: unknown): ReviewRef[] {
  const root = asRecord(json);
  const items = Array.isArray(root?.items) ? root.items : [];
  return items
    .map((item) => {
      const row = asRecord(item);
      const id = asNullableString(row?.id);
      if (!id) return null;
      return {
        id,
        teacherId: asNullableNumber(row?.teacher_id),
        courseId: asNullableNumber(row?.course_id),
        courseName: asNullableString(row?.course_name),
      };
    })
    .filter((row): row is ReviewRef => row != null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function inferReadTarget(json: unknown, status: number): PeReadTargetKind {
  if (status === 404) return "missing";
  const identity = identityFromDetail(json);
  if (!identity) return "missing";
  if (identity.courseId == null && identity.publicId?.startsWith("pe:")) return "mapped";
  if (identity.courseId != null && isVirtualPeSportId(identity.courseId)) return "virtual";
  if (identity.courseId != null) return "ordinary";
  return "missing";
}

function summarizeEndpoint(capture: HttpCapture, kind: "detail" | "reviews"): EndpointSummary {
  return {
    path: capture.path,
    status: capture.status,
    ok: capture.ok,
    error: capture.error,
    identity: kind === "detail" ? identityFromDetail(capture.json) : null,
    teachers: kind === "detail" ? teachersFromDetail(capture.json) : [],
    reviewRefs: kind === "reviews" ? reviewRefsFromJson(capture.json) : [],
    jsonKeys: [...collectJsonKeys(capture.json)].sort(),
    setCookiePresent: capture.setCookiePresent,
  };
}

function uniqueSortedIds(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "zh"));
}

function sameNumberSet(left: number[], right: number[]): boolean {
  const a = uniqueSortedIds(left);
  const b = uniqueSortedIds(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameStringSet(left: string[], right: string[]): boolean {
  const a = uniqueSortedStrings(left);
  const b = uniqueSortedStrings(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function otherSportNames(spec: PeAliasPairSpec): string[] {
  return PE_ALIAS_PAIRS.filter((pair) => pair.label !== spec.label).flatMap(
    (pair) => pair.expectedTeacherNames,
  );
}

function combinedReviewRefs(unscoped: EndpointSummary, perTeacher: EndpointSummary[]): ReviewRef[] {
  const byId = new Map<string, ReviewRef>();
  for (const ref of [...unscoped.reviewRefs, ...perTeacher.flatMap((page) => page.reviewRefs)]) {
    byId.set(ref.id, ref);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function buildPeAliasPairResult(input: {
  spec: PeAliasPairSpec;
  aliasDetail: HttpCapture;
  aliasReviews: HttpCapture;
  aliasTeacherReviews: HttpCapture[];
  canonicalDetail: HttpCapture;
  canonicalReviews: HttpCapture;
  canonicalTeacherReviews: HttpCapture[];
  extraCanonical: HttpCapture[];
}): PeAliasPairResult {
  const aliasDetail = summarizeEndpoint(input.aliasDetail, "detail");
  const aliasReviews = summarizeEndpoint(input.aliasReviews, "reviews");
  const aliasTeacherReviews = input.aliasTeacherReviews.map((capture) =>
    summarizeEndpoint(capture, "reviews"),
  );
  const canonicalDetail = summarizeEndpoint(input.canonicalDetail, "detail");
  const canonicalReviews = summarizeEndpoint(input.canonicalReviews, "reviews");
  const canonicalTeacherReviews = input.canonicalTeacherReviews.map((capture) =>
    summarizeEndpoint(capture, "reviews"),
  );

  const aliasTarget = inferReadTarget(input.aliasDetail.json, input.aliasDetail.status);
  const canonicalTarget = inferReadTarget(
    input.canonicalDetail.json,
    input.canonicalDetail.status,
  );
  const readTarget = aliasTarget === canonicalTarget ? aliasTarget : "mixed";

  const identityMatch =
    Boolean(aliasDetail.ok && canonicalDetail.ok) &&
    aliasDetail.identity?.publicId === canonicalDetail.identity?.publicId &&
    aliasDetail.identity?.name === canonicalDetail.identity?.name &&
    Boolean(aliasDetail.identity?.publicId) &&
    Boolean(aliasDetail.identity?.name);

  const aliasTeacherIds = aliasDetail.teachers.map((teacher) => teacher.id);
  const canonicalTeacherIds = canonicalDetail.teachers.map((teacher) => teacher.id);
  const aliasNames = aliasDetail.teachers.map((teacher) => teacher.name);
  const canonicalNames = canonicalDetail.teachers.map((teacher) => teacher.name);
  const unexpectedNames = uniqueSortedStrings(
    [...aliasNames, ...canonicalNames].filter((name) =>
      otherSportNames(input.spec).includes(name),
    ),
  );
  const virtualTeacherMismatch =
    readTarget === "virtual" &&
    uniqueSortedStrings(aliasNames).join("\0") !==
      uniqueSortedStrings(input.spec.expectedTeacherNames).join("\0");
  const teacherMatch =
    Boolean(aliasDetail.ok && canonicalDetail.ok) &&
    sameNumberSet(aliasTeacherIds, canonicalTeacherIds) &&
    unexpectedNames.length === 0 &&
    !virtualTeacherMismatch;

  const aliasReviewRefs = combinedReviewRefs(aliasReviews, aliasTeacherReviews);
  const canonicalReviewRefs = combinedReviewRefs(
    canonicalReviews,
    canonicalTeacherReviews,
  );
  const aliasReviewIds = aliasReviewRefs.map((item) => item.id);
  const canonicalReviewIds = canonicalReviewRefs.map((item) => item.id);
  const allowedTeacherIds = new Set(aliasTeacherIds);
  const crossSportReviewIds = uniqueSortedStrings(
    [...aliasReviewRefs, ...canonicalReviewRefs]
      .filter(
        (item) => item.teacherId != null && !allowedTeacherIds.has(item.teacherId),
      )
      .map((item) => item.id),
  );
  const reviewMatch =
    Boolean(aliasDetail.ok && canonicalDetail.ok) &&
    aliasReviews.status === canonicalReviews.status &&
    sameStringSet(aliasReviewIds, canonicalReviewIds) &&
    sameStringSet(
      aliasReviews.reviewRefs.map((item) => item.id),
      canonicalReviews.reviewRefs.map((item) => item.id),
    ) &&
    crossSportReviewIds.length === 0;

  const privacyDenied = uniqueSortedStrings([
    ...deniedPrivacyKeys(input.aliasDetail.json),
    ...deniedPrivacyKeys(input.aliasReviews.json),
    ...input.aliasTeacherReviews.flatMap((capture) => deniedPrivacyKeys(capture.json)),
    ...deniedPrivacyKeys(input.canonicalDetail.json),
    ...deniedPrivacyKeys(input.canonicalReviews.json),
    ...input.canonicalTeacherReviews.flatMap((capture) => deniedPrivacyKeys(capture.json)),
    ...input.extraCanonical.flatMap((capture) => deniedPrivacyKeys(capture.json)),
  ]);
  const jsonKeys = uniqueSortedStrings([
    ...aliasDetail.jsonKeys,
    ...aliasReviews.jsonKeys,
    ...aliasTeacherReviews.flatMap((page) => page.jsonKeys),
    ...canonicalDetail.jsonKeys,
    ...canonicalReviews.jsonKeys,
    ...canonicalTeacherReviews.flatMap((page) => page.jsonKeys),
    ...input.extraCanonical.flatMap((capture) => [...collectJsonKeys(capture.json)]),
  ]);
  const privacyClean = privacyDenied.length === 0;
  const equivalent =
    Boolean(aliasDetail.ok && canonicalDetail.ok) &&
    identityMatch &&
    teacherMatch &&
    reviewMatch;

  return {
    label: input.spec.label,
    aliasId: input.spec.aliasId,
    canonicalPublicId: input.spec.canonicalPublicId,
    canonicalComparedPath: canonicalDetail.path,
    readTarget,
    equivalent,
    identityMatch,
    teacherMatch,
    reviewMatch,
    privacyClean,
    alias: {
      detail: aliasDetail,
      reviews: aliasReviews,
      teacherReviews: aliasTeacherReviews,
    },
    canonical: {
      detail: canonicalDetail,
      reviews: canonicalReviews,
      teacherReviews: canonicalTeacherReviews,
    },
    extraCanonical: input.extraCanonical.map((capture) => ({
      path: capture.path,
      status: capture.status,
      ok: capture.ok,
    })),
    identity: {
      alias: aliasDetail.identity,
      canonical: canonicalDetail.identity,
    },
    teachers: {
      aliasIds: uniqueSortedIds(aliasTeacherIds),
      canonicalIds: uniqueSortedIds(canonicalTeacherIds),
      aliasNames: uniqueSortedStrings(aliasNames),
      canonicalNames: uniqueSortedStrings(canonicalNames),
      unexpectedNames,
    },
    reviews: {
      aliasIds: uniqueSortedStrings(aliasReviewIds),
      canonicalIds: uniqueSortedStrings(canonicalReviewIds),
      unscopedAliasIds: uniqueSortedStrings(aliasReviews.reviewRefs.map((item) => item.id)),
      unscopedCanonicalIds: uniqueSortedStrings(
        canonicalReviews.reviewRefs.map((item) => item.id),
      ),
      crossSportReviewIds,
      courseNames: uniqueSortedStrings(
        [...aliasReviewRefs, ...canonicalReviewRefs]
          .map((item) => item.courseName)
          .filter((name): name is string => Boolean(name)),
      ),
    },
    privacy: {
      deniedKeys: privacyDenied,
      jsonKeys,
    },
  };
}

function criterion(pass: boolean, detail: string): CriterionResult {
  return { pass, detail };
}

export function buildPeAliasEquivalenceReport(input: {
  requestedAt: string;
  origin: string;
  deploySha: string;
  workerVersionId?: string | null;
  pairs: PeAliasPairCaptures[];
}): PeAliasEquivalenceReport {
  const pairs = input.pairs.map((pair) => buildPeAliasPairResult(pair));
  const aliasReadable = pairs.every((pair) => pair.alias.detail.ok);
  const identityEquivalent = pairs.every((pair) => pair.identityMatch);
  const teacherScope = pairs.every((pair) => pair.teacherMatch);
  const reviewScope = pairs.every((pair) => pair.reviewMatch);
  const privacy = pairs.every((pair) => pair.privacyClean);
  const metadataPresent = Boolean(input.requestedAt && input.deploySha && pairs.length);
  const equivalent = pairs.length > 0 && pairs.every((pair) => pair.equivalent);
  const fallbackVirtual = pairs.some((pair) => pair.readTarget === "virtual");
  return {
    schemaVersion: PE_ALIAS_EQUIVALENCE_SCHEMA,
    requestedAt: input.requestedAt,
    origin: input.origin,
    deploySha: input.deploySha,
    workerVersionId: input.workerVersionId ?? null,
    dataScope: PE_ALIAS_EQUIVALENCE_DATA_SCOPE,
    readOnly: true,
    method: "GET",
    pairs,
    criteria: {
      aliasReadable: criterion(
        aliasReadable,
        pairs
          .map((pair) => `${pair.aliasId}:${pair.alias.detail.status}`)
          .join("；") || "无配对",
      ),
      identityEquivalent: criterion(
        identityEquivalent,
        pairs
          .map(
            (pair) =>
              `${pair.label}: alias public_id=${pair.identity.alias?.publicId ?? "∅"} name=${pair.identity.alias?.name ?? "∅"} / canonical public_id=${pair.identity.canonical?.publicId ?? "∅"} name=${pair.identity.canonical?.name ?? "∅"} (${pair.identityMatch ? "一致" : "不一致"})`,
          )
          .join("；") || "无配对",
      ),
      teacherScope: criterion(
        teacherScope,
        pairs
          .map(
            (pair) =>
              `${pair.label}: alias teachers=${pair.teachers.aliasIds.join(",") || "∅"} / canonical=${pair.teachers.canonicalIds.join(",") || "∅"}${pair.teachers.unexpectedNames.length ? ` unexpected=${pair.teachers.unexpectedNames.join(",")}` : ""}`,
          )
          .join("；") || "无配对",
      ),
      reviewScope: criterion(
        reviewScope,
        pairs
          .map(
            (pair) =>
              `${pair.label}: alias reviews=${pair.reviews.aliasIds.length} canonical=${pair.reviews.canonicalIds.length}${pair.reviews.crossSportReviewIds.length ? ` cross=${pair.reviews.crossSportReviewIds.length}` : ""}`,
          )
          .join("；") || "无配对",
      ),
      privacy: criterion(
        privacy,
        privacy
          ? "无 email/student_id/cookie/note/html/submitter_hash 等敏感键"
          : `敏感键: ${uniqueSortedStrings(pairs.flatMap((pair) => pair.privacy.deniedKeys)).join(",")}`,
      ),
      metadataPresent: criterion(
        metadataPresent,
        `requestedAt=${input.requestedAt || "∅"} deploySha=${input.deploySha || "∅"} pairs=${pairs.length}`,
      ),
    },
    equivalent,
    fallbackVirtual,
    leftoverFor847: PE_ALIAS_EQUIVALENCE_FALLBACK_NOTE,
  };
}

function formatYesNo(value: boolean): string {
  return value ? "是" : "否";
}

function formatPass(value: boolean): string {
  return value ? "通过" : "未通过";
}

function formatIdentity(identity: IdentitySummary | null): string {
  if (!identity) return "（无课程载荷）";
  return `public_id=${identity.publicId ?? "∅"} name=${identity.name ?? "∅"} id=${identity.courseId ?? "null"} category=${identity.category ?? "∅"} review_count=${identity.reviewCount ?? "∅"}`;
}

function formatHttpRow(path: string, status: number): string {
  return `| \`${path}\` | ${status} |`;
}

function formatReviewIds(ids: string[]): string {
  if (!ids.length) return "（无）";
  return ids.map((id) => `\`${id}\``).join("、");
}

function formatPairMarkdown(pair: PeAliasPairResult): string {
  const extraRows = pair.extraCanonical
    .map((item) => formatHttpRow(item.path, item.status))
    .join("\n");
  return [
    `## ${pair.label}`,
    "",
    `- 读取目标: ${pair.readTarget}`,
    `- alias ≡ canonical: ${formatYesNo(pair.equivalent)}`,
    `- 比较用 canonical 路径: \`${pair.canonicalComparedPath}\``,
    "",
    "### HTTP",
    "",
    "| 路径 | 状态 |",
    "| --- | ---: |",
    formatHttpRow(pair.alias.detail.path, pair.alias.detail.status),
    formatHttpRow(pair.alias.reviews.path, pair.alias.reviews.status),
    ...pair.alias.teacherReviews.map((page) => formatHttpRow(page.path, page.status)),
    formatHttpRow(pair.canonical.detail.path, pair.canonical.detail.status),
    formatHttpRow(pair.canonical.reviews.path, pair.canonical.reviews.status),
    ...pair.canonical.teacherReviews.map((page) => formatHttpRow(page.path, page.status)),
    extraRows,
    "",
    "### 身份",
    "",
    `- alias: ${formatIdentity(pair.identity.alias)}`,
    `- canonical: ${formatIdentity(pair.identity.canonical)}`,
    `- 一致: ${formatYesNo(pair.identityMatch)}`,
    "",
    "### 教师",
    "",
    `- alias ids: ${pair.teachers.aliasIds.join(", ") || "（无）"}`,
    `- canonical ids: ${pair.teachers.canonicalIds.join(", ") || "（无）"}`,
    `- alias names: ${pair.teachers.aliasNames.join("、") || "（无）"}`,
    `- canonical names: ${pair.teachers.canonicalNames.join("、") || "（无）"}`,
    `- 跨专项教师: ${pair.teachers.unexpectedNames.join("、") || "（无）"}`,
    `- 一致: ${formatYesNo(pair.teacherMatch)}`,
    "",
    "### 评价 id（不含正文）",
    "",
    `- alias 未选教师: ${formatReviewIds(pair.reviews.unscopedAliasIds)}`,
    `- canonical 未选教师: ${formatReviewIds(pair.reviews.unscopedCanonicalIds)}`,
    `- alias 合计: ${formatReviewIds(pair.reviews.aliasIds)}`,
    `- canonical 合计: ${formatReviewIds(pair.reviews.canonicalIds)}`,
    `- 跨专项评价: ${formatReviewIds(pair.reviews.crossSportReviewIds)}`,
    `- 评价课名: ${pair.reviews.courseNames.join("、") || "（无）"}`,
    `- 一致: ${formatYesNo(pair.reviewMatch)}`,
    "",
    "### 隐私键",
    "",
    `- JSON keys: ${pair.privacy.jsonKeys.join(", ") || "（无）"}`,
    `- 敏感键: ${pair.privacy.deniedKeys.join(", ") || "（无）"}`,
    `- 通过: ${formatYesNo(pair.privacyClean)}`,
    "",
  ].join("\n");
}

export function formatPeAliasEquivalenceMarkdown(report: PeAliasEquivalenceReport): string {
  const criteria = report.criteria;
  return [
    "# 生产体育专项旧 alias 与 canonical 等价性",
    "",
    `- 请求时间: ${report.requestedAt}`,
    `- 部署 SHA: ${report.deploySha}`,
    `- Worker version: ${report.workerVersionId ?? "（未取得）"}`,
    `- origin: ${report.origin}`,
    `- 只读 GET: ${report.readOnly && report.method === "GET" ? "是" : "否"}`,
    `- schema: ${report.schemaVersion}`,
    `- 总体等价: ${formatYesNo(report.equivalent)}`,
    `- 虚拟 fallback: ${formatYesNo(report.fallbackVirtual)}`,
    "",
    "## 数据范围",
    "",
    report.dataScope,
    "",
    "## 判定",
    "",
    `- 800001/800002 可读取: ${formatPass(criteria.aliasReadable.pass)} — ${criteria.aliasReadable.detail}`,
    `- 公开身份与展示名一致: ${formatPass(criteria.identityEquivalent.pass)} — ${criteria.identityEquivalent.detail}`,
    `- 教师范围只含对应专项: ${formatPass(criteria.teacherScope.pass)} — ${criteria.teacherScope.detail}`,
    `- 评价流不读取跨课程错误集合: ${formatPass(criteria.reviewScope.pass)} — ${criteria.reviewScope.detail}`,
    `- 详情和评价不泄露敏感字段: ${formatPass(criteria.privacy.pass)} — ${criteria.privacy.detail}`,
    `- 含请求时间、部署 SHA 与响应摘要: ${formatPass(criteria.metadataPresent.pass)} — ${criteria.metadataPresent.detail}`,
    "",
    ...report.pairs.flatMap((pair) => [formatPairMarkdown(pair)]),
    "## #847",
    "",
    report.leftoverFor847,
    "",
  ].join("\n");
}
