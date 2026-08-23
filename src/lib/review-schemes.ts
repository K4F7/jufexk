/** Versioned review schemes shared by submit validation and course questionnaire reads. */

import {
  REVIEW_NOTE_HTML_MAX_LENGTH,
  REVIEW_NOTE_RAW_MAX_LENGTH,
  reviewNotePlainText,
  sanitizeReviewNoteValue,
} from "./review-note-html";

export const SCHEME_KEYS = [
  "major",
  "ideology",
  "math",
  "public_basic",
  "english",
  "pe",
] as const;

export type SchemeKey = (typeof SCHEME_KEYS)[number];

export const COURSE_TAGS = ["mooc"] as const;
export type CourseTag = (typeof COURSE_TAGS)[number];

export type DimensionOption = {
  value: number;
  label: string;
};

export type DimensionDef = {
  id: string;
  label: string;
  prompt: string;
  scale: string;
  options: readonly DimensionOption[];
  offlineOnly?: boolean;
};

export type ApplicableQuestion = Omit<DimensionDef, "offlineOnly">;

export const REVIEW_NOTE_MIN_LENGTH = 10;
export const REVIEW_NOTE_MAX_LENGTH = 1200;

const FIVE_POINT_OPTIONS: readonly DimensionOption[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
];

/** Published v1 core. Immutable; new submits use a later version. */
const V1_CORE_DIMENSIONS: readonly DimensionDef[] = [
  {
    id: "teaching",
    label: "上课表现",
    prompt: "上课表现",
    scale: "1 到 5，分数越高表示上课表现越好",
    options: FIVE_POINT_OPTIONS,
  },
  {
    id: "attendance",
    label: "点名频率",
    prompt: "点名频率",
    scale: "1 到 5，分数越高表示点名越频繁",
    options: FIVE_POINT_OPTIONS,
    offlineOnly: true,
  },
  {
    id: "grading",
    label: "给分情况",
    prompt: "你感受到的给分",
    scale: "1 到 5，分数越高表示你感受到的给分越宽松",
    options: FIVE_POINT_OPTIONS,
  },
  {
    id: "workload",
    label: "考核压力",
    prompt: "考核压力",
    scale: "1 到 5，分数越高表示考核压力越大",
    options: FIVE_POINT_OPTIONS,
  },
];

const TIER3_CORE_DIMENSIONS: readonly DimensionDef[] = [
  {
    id: "difficulty",
    label: "课程难度",
    prompt: "课程难度",
    scale: "简单 / 中等 / 困难",
    options: [
      { value: 1, label: "简单" },
      { value: 2, label: "中等" },
      { value: 3, label: "困难" },
    ],
  },
  {
    id: "homework",
    label: "作业多少",
    prompt: "作业多少",
    scale: "不多 / 中等 / 超多",
    options: [
      { value: 1, label: "不多" },
      { value: 2, label: "中等" },
      { value: 3, label: "超多" },
    ],
  },
  {
    id: "grading",
    label: "给分好坏",
    prompt: "给分好坏",
    scale: "超好 / 一般 / 杀手",
    options: [
      { value: 1, label: "超好" },
      { value: 2, label: "一般" },
      { value: 3, label: "杀手" },
    ],
  },
  {
    id: "gain",
    label: "收获多少",
    prompt: "收获多少",
    scale: "很多 / 一般 / 没有",
    options: [
      { value: 1, label: "很多" },
      { value: 2, label: "一般" },
      { value: 3, label: "没有" },
    ],
  },
];

type SchemeVersionDef = {
  version: number;
  dimensions: readonly DimensionDef[];
  averagesDimensions: boolean;
};

type SchemeDef = {
  key: SchemeKey;
  label: string;
  versions: readonly SchemeVersionDef[];
};

const scheme = (key: SchemeKey, label: string): SchemeDef => ({
  key,
  label,
  versions: [
    {
      version: 1,
      dimensions: V1_CORE_DIMENSIONS,
      averagesDimensions: true,
    },
    {
      version: 2,
      dimensions: TIER3_CORE_DIMENSIONS,
      averagesDimensions: false,
    },
  ],
});

export const REVIEW_SCHEMES: Record<SchemeKey, SchemeDef> = {
  major: scheme("major", "专业类"),
  ideology: scheme("ideology", "思政类"),
  math: scheme("math", "高等数学类"),
  public_basic: scheme("public_basic", "公共基础类"),
  english: scheme("english", "大学英语类"),
  pe: scheme("pe", "体育类"),
};

const SCHEME_KEY_SET = new Set<string>(SCHEME_KEYS);
const COURSE_TAG_SET = new Set<string>(COURSE_TAGS);

export function isSchemeKey(value: string): value is SchemeKey {
  return SCHEME_KEY_SET.has(value);
}

export function isCourseTag(value: string): value is CourseTag {
  return COURSE_TAG_SET.has(value);
}

export function defaultSchemeKey(category: string): SchemeKey {
  return category === "sports" ? "pe" : "major";
}

export function resolveSchemeKey(
  schemeKey: string | null | undefined,
  category: string,
): SchemeKey {
  return schemeKey && isSchemeKey(schemeKey)
    ? schemeKey
    : defaultSchemeKey(category);
}

export function parseCourseTags(values: readonly string[]): CourseTag[] {
  return values.filter(isCourseTag);
}

export function publishedSchemeVersion(
  schemeKey: SchemeKey,
  version: number,
): SchemeVersionDef | null {
  return (
    REVIEW_SCHEMES[schemeKey].versions.find((item) => item.version === version) ??
    null
  );
}

export function latestSchemeVersion(schemeKey: SchemeKey): SchemeVersionDef {
  const versions = REVIEW_SCHEMES[schemeKey].versions;
  const latest = versions[versions.length - 1];
  if (!latest) throw new Error(`评价规则 ${schemeKey} 没有已发布版本`);
  return latest;
}

/**
 * Unique calculation point for the required dimension set of one submission.
 * Input is the course scheme plus course tags; output is this attempt's
 * required scoring questions. Submit, course reads, and later averages
 * must call this instead of filtering dimensions themselves.
 */
export function applicableDimensions(
  schemeKey: SchemeKey,
  tags: readonly string[],
): DimensionDef[] {
  const mooc = tags.includes("mooc");
  return latestSchemeVersion(schemeKey).dimensions.filter(
    (dimension) => !(dimension.offlineOnly && mooc),
  );
}

const toApplicableQuestion = ({
  id,
  label,
  prompt,
  scale,
  options,
}: DimensionDef): ApplicableQuestion => ({
  id,
  label,
  prompt,
  scale,
  options: options.map((option) => ({ ...option })),
});

/**
 * Questions shared by every scheme, rendered by the submit form before a
 * course is chosen so the full questionnaire is visible up front (issue
 * #361). Computed as the intersection across latest versions: if
 * scheme-specific dimensions are ever added, this degrades to the true
 * common core.
 */
export const COMMON_CORE_QUESTIONS: ApplicableQuestion[] = (() => {
  const [first, ...rest] = Object.values(REVIEW_SCHEMES).map((item) =>
    latestSchemeVersion(item.key).dimensions,
  );
  if (!first) return [];
  return first
    .filter((dimension) =>
      rest.every((dimensions) =>
        dimensions.some((other) => other.id === dimension.id),
      ),
    )
    .map(toApplicableQuestion);
})();

export function courseSchemeView(
  schemeKey: string | null | undefined,
  category: string,
  tags: readonly string[],
) {
  const resolved = resolveSchemeKey(schemeKey, category);
  const knownTags = parseCourseTags(tags);
  return {
    schemeKey: resolved,
    schemeVersion: latestSchemeVersion(resolved).version,
    tags: knownTags,
    applicableQuestions: applicableDimensions(resolved, knownTags).map(
      toApplicableQuestion,
    ),
  };
}

const optionValue = (
  value: unknown,
  options: readonly DimensionOption[],
): number | null => {
  let n: number | null = null;
  if (typeof value === "number")
    n = Number.isSafeInteger(value) ? value : null;
  else if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    n = Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (n === null) return null;
  return options.some((option) => option.value === n) ? n : null;
};

export function validateSubmittedScores(
  raw: unknown,
  dimensions: readonly DimensionDef[],
): { ok: true; scores: Record<string, number> } | { ok: false; error: string } {
  if (raw === undefined || raw === null)
    return { ok: false, error: "请答完本次适用的评分题" };
  if (typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, error: "评分格式无效" };
  const required = new Map(
    dimensions.map((dimension) => [dimension.id, dimension]),
  );
  const scores: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const dimension = required.get(key);
    if (!dimension) return { ok: false, error: "提交了不适用的评分维度" };
    const n = optionValue(value, dimension.options);
    if (n === null) return { ok: false, error: "评分必须是题目给出的选项" };
    scores[key] = n;
  }
  for (const id of required.keys()) {
    if (!(id in scores)) return { ok: false, error: "请答完本次适用的评分题" };
  }
  return { ok: true, scores };
}

/**
 * 补充说明校验（issue #400）：先按白名单消毒，再按去标签后的纯文本
 * 计算去空白长度，闭区间 10 到 1200；富文本标记不计入也不能凑字。
 * 通过时返回要落库的消毒结果与格式标记。
 */
export function validateReviewNote(
  raw: unknown,
):
  | { ok: true; comment: string; commentFormat: "html" | null }
  | { ok: false; error: string } {
  if (typeof raw !== "string")
    return { ok: false, error: "请填写至少 10 字补充说明" };
  if (raw.length > REVIEW_NOTE_RAW_MAX_LENGTH)
    return { ok: false, error: "补充说明不能超过 1200 字" };
  const note = sanitizeReviewNoteValue(raw);
  const plainLength = reviewNotePlainText(note.comment).trim().length;
  if (plainLength < REVIEW_NOTE_MIN_LENGTH)
    return { ok: false, error: "请填写至少 10 字补充说明" };
  if (
    plainLength > REVIEW_NOTE_MAX_LENGTH ||
    note.comment.length > REVIEW_NOTE_HTML_MAX_LENGTH
  )
    return { ok: false, error: "补充说明不能超过 1200 字" };
  return { ok: true, ...note };
}

export function serializeScores(scores: Record<string, number>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(scores).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

export function snapshotReviewScores(input: {
  schemeKey?: string | null;
  category: string;
  tags: readonly string[];
  scores: unknown;
  comment: unknown;
}):
  | {
      ok: true;
      schemeKey: SchemeKey;
      schemeVersion: number;
      scores: Record<string, number>;
      scoresJson: string;
      comment: string;
      commentFormat: "html" | null;
    }
  | { ok: false; error: string } {
  const schemeKey = resolveSchemeKey(input.schemeKey, input.category);
  const validated = validateSubmittedScores(
    input.scores,
    applicableDimensions(schemeKey, input.tags),
  );
  if (!validated.ok) return validated;
  const note = validateReviewNote(input.comment);
  if (!note.ok) return note;
  return {
    ok: true,
    schemeKey,
    schemeVersion: latestSchemeVersion(schemeKey).version,
    scores: validated.scores,
    scoresJson: serializeScores(validated.scores),
    comment: note.comment,
    commentFormat: note.commentFormat,
  };
}

export function parseStoredScores(raw: unknown): Record<string, number> | null {
  if (raw == null || raw === "") return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed))
    return null;
  const scores: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    scores[key] = value;
  }
  return Object.keys(scores).length ? scores : null;
}

/** Arithmetic mean of a snapshot score map, one decimal. */
export function dimensionAverage(scores: Record<string, number>): number | null {
  const values = Object.values(scores);
  if (!values.length) return null;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
    ) / 10
  );
}

/**
 * Public-feed average: only rows with a stored scheme snapshot whose
 * published version still averages its dimensions. The current four
 * three-tier questions are not averaged.
 */
export function publicDimensionAverage(input: {
  schemeKey?: unknown;
  schemeVersion?: unknown;
  scores?: unknown;
}): number | null {
  if (typeof input.schemeKey !== "string" || !isSchemeKey(input.schemeKey))
    return null;
  const version = Number(input.schemeVersion);
  if (!Number.isInteger(version) || version < 1) return null;
  const published = publishedSchemeVersion(input.schemeKey, version);
  if (!published?.averagesDimensions) return null;
  const scores = parseStoredScores(input.scores);
  if (!scores) return null;
  return dimensionAverage(scores);
}

export type PublicDimensionLabel = {
  id: string;
  /** Dimension label, e.g. 课程难度. */
  label: string;
  /** Chosen option label, e.g. 简单. */
  option: string;
};

/**
 * Public-feed tier labels: only rows with a stored scheme snapshot whose
 * published version no longer averages its dimensions. Each dimension's
 * stored score is translated to that version's Chinese option label, in
 * dimension-definition order. Old 1–5 snapshots are never translated into
 * the new tier copy, and a snapshot missing any dimension's valid option
 * yields no labels at all.
 */
export function publicDimensionLabels(input: {
  schemeKey?: unknown;
  schemeVersion?: unknown;
  scores?: unknown;
}): PublicDimensionLabel[] | null {
  if (typeof input.schemeKey !== "string" || !isSchemeKey(input.schemeKey))
    return null;
  const version = Number(input.schemeVersion);
  if (!Number.isInteger(version) || version < 1) return null;
  const published = publishedSchemeVersion(input.schemeKey, version);
  if (!published || published.averagesDimensions) return null;
  const scores = parseStoredScores(input.scores);
  if (!scores) return null;
  const labels: PublicDimensionLabel[] = [];
  for (const dimension of published.dimensions) {
    const option = dimension.options.find(
      (item) => item.value === scores[dimension.id],
    );
    if (!option) return null;
    labels.push({ id: dimension.id, label: dimension.label, option: option.label });
  }
  return labels;
}
