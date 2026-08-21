/** Versioned review schemes shared by submit validation and course questionnaire reads. */

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

export const DIMENSION_IDS = [
  "teaching",
  "attendance",
  "grading",
  "workload",
] as const;

export type DimensionId = (typeof DIMENSION_IDS)[number];

export type DimensionDef = {
  id: DimensionId;
  label: string;
  prompt: string;
  scale: string;
  offlineOnly?: boolean;
};

export type ApplicableQuestion = Omit<DimensionDef, "offlineOnly">;

const CORE_DIMENSIONS: DimensionDef[] = [
  {
    id: "teaching",
    label: "上课表现",
    prompt: "上课表现",
    scale: "1 到 5，分数越高表示上课表现越好",
  },
  {
    id: "attendance",
    label: "点名频率",
    prompt: "点名频率",
    scale: "1 到 5，分数越高表示点名越频繁",
    offlineOnly: true,
  },
  {
    id: "grading",
    label: "给分情况",
    prompt: "你感受到的给分",
    scale: "1 到 5，分数越高表示你感受到的给分越宽松",
  },
  {
    id: "workload",
    label: "考核压力",
    prompt: "考核压力",
    scale: "1 到 5，分数越高表示考核压力越大",
  },
];

type SchemeDef = {
  key: SchemeKey;
  version: number;
  label: string;
  dimensions: readonly DimensionDef[];
};

const scheme = (key: SchemeKey, label: string): SchemeDef => ({
  key,
  version: 1,
  label,
  dimensions: CORE_DIMENSIONS,
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
  return REVIEW_SCHEMES[schemeKey].dimensions.filter(
    (dimension) => !(dimension.offlineOnly && mooc),
  );
}

const toApplicableQuestion = ({
  id,
  label,
  prompt,
  scale,
}: DimensionDef): ApplicableQuestion => ({ id, label, prompt, scale });

/**
 * Questions shared by every scheme, rendered by the submit form before a
 * course is chosen so the full questionnaire is visible up front (issue
 * #361). Computed as the intersection across schemes: if scheme-specific
 * dimensions are ever added, this degrades to the true common core.
 */
export const COMMON_CORE_QUESTIONS: ApplicableQuestion[] = (() => {
  const [first, ...rest] = Object.values(REVIEW_SCHEMES);
  return first.dimensions
    .filter((dimension) =>
      rest.every((scheme) =>
        scheme.dimensions.some((other) => other.id === dimension.id),
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
    schemeVersion: REVIEW_SCHEMES[resolved].version,
    tags: knownTags,
    applicableQuestions: applicableDimensions(resolved, knownTags).map(
      toApplicableQuestion,
    ),
  };
}

const scoreValue = (value: unknown): number | null => {
  if (value === "" || value == null) return null;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 1 && value <= 5 ? value : null;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 1 && n <= 5 ? n : null;
  }
  return null;
};

export function validateSubmittedScores(
  raw: unknown,
  dimensions: readonly DimensionDef[],
): { ok: true; scores: Record<string, number> } | { ok: false; error: string } {
  if (raw === undefined || raw === null)
    return { ok: false, error: "请答完本次适用的评分题" };
  if (typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, error: "评分格式无效" };
  const required = new Set(dimensions.map((dimension) => dimension.id));
  const scores: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!required.has(key as DimensionId))
      return { ok: false, error: "提交了不适用的评分维度" };
    const n = scoreValue(value);
    if (n === null) return { ok: false, error: "评分必须在 1 到 5 之间" };
    scores[key] = n;
  }
  for (const id of required) {
    if (!(id in scores)) return { ok: false, error: "请答完本次适用的评分题" };
  }
  return { ok: true, scores };
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
}):
  | {
      ok: true;
      schemeKey: SchemeKey;
      schemeVersion: number;
      scores: Record<string, number>;
      scoresJson: string;
    }
  | { ok: false; error: string } {
  const schemeKey = resolveSchemeKey(input.schemeKey, input.category);
  const validated = validateSubmittedScores(
    input.scores,
    applicableDimensions(schemeKey, input.tags),
  );
  if (!validated.ok) return validated;
  return {
    ok: true,
    schemeKey,
    schemeVersion: REVIEW_SCHEMES[schemeKey].version,
    scores: validated.scores,
    scoresJson: serializeScores(validated.scores),
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
 * Public-feed average: only rows with a stored scheme snapshot.
 * Averages the snapshot scores (the applicable set at submit time).
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
  const scores = parseStoredScores(input.scores);
  if (!scores) return null;
  return dimensionAverage(scores);
}
