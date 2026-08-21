import { readFile, writeFile } from "node:fs/promises";

const qualityPath =
  "scripts/catalog-baseline/captures/full-quality-v12-final/courses.jsonl";
const apply = process.argv.includes("--apply");
const baseUrl = (process.env.JUFEXK_BASE_URL || "https://xk.sein.moe").replace(
  /\/$/,
  "",
);

const UMBRELLA_PE = new Set([
  "体育1",
  "体育2",
  "体育3",
  "体育4",
  "体育Ⅰ（留）",
  "体育Ⅱ（留）",
  "体育I（留）",
  "体育II（留）",
]);
const PE_SKILL_KEYS = [
  "健美操",
  "健身教练",
  "击剑",
  "篮球",
  "网球",
  "羽毛球",
  "排球",
  "乒乓球",
  "足球",
  "瑜伽",
  "武术",
  "体育舞蹈",
  "轮滑",
  "散打",
];
const SKILL_NAME_REST = /^(专项理论与实践)?\d*$/;

function publicPeSkill(name) {
  const trimmed = name.trim();
  if (!trimmed || UMBRELLA_PE.has(trimmed)) return null;
  const keys = [...PE_SKILL_KEYS].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (trimmed === key) return key;
    if (trimmed.startsWith(key) && SKILL_NAME_REST.test(trimmed.slice(key.length)))
      return key;
  }
  return null;
}

function isPeName(name) {
  return (
    UMBRELLA_PE.has(name.trim()) ||
    publicPeSkill(name) !== null ||
    /大学体育/.test(name) ||
    /^体育[1-4ⅠⅡ一二三四]/.test(name)
  );
}

function isMoocName(name) {
  return /MOOC|慕课|尔雅网络课程|智慧树网络课程|在线开放/.test(name);
}

function hasText(texts, re) {
  return texts.some((text) => re.test(text));
}

function isCanonicalIdeology(name) {
  return /^(形势与政策|思想道德与法治|思想道德修养|马克思主义基本原理|毛泽东思想和中国特色社会主义理论体系概论|习近平|中国近现代史纲要|中国特色社会主义法治|民族理论与民族政策|江西红色文化|中华民族共同体)/.test(
    name,
  );
}

function isCommonMathName(name) {
  if (/计算机|Python|程序|思维与商业/.test(name)) return false;
  return /^(高等数学|线性代数|概率论|微积分|数学分析|高等代数|经济数学|数学基础|数学文化|数学[12])/.test(
    name,
  );
}

function isPublicEnglishName(name) {
  return (
    /^(大学英语|基础英语|英语视听说|英语听说|英语写作|全球胜任力英语|外教)/.test(
      name,
    ) || /外教/.test(name)
  );
}

function isArtPublic(name) {
  return /鉴赏|赏析|美育|民歌|声乐|演唱|歌剧|女高音|艺术歌曲|书法|剪纸|音乐|影视|合唱/.test(
    name,
  );
}

function isPrimarilyMajor(texts) {
  return hasText(
    texts,
    /专业必修课|专业教育课\/专业必修|专业课\/专业必修|学科基础课|专业大类课|学科大类课/,
  );
}

function isPublicBasicPath(texts) {
  return hasText(
    texts,
    /任选课\/公共课|通识课程|通识教育|劳育|劳动教育|心理健康|军事理论|国防教育|国家安全教育|职业生涯|就业指导|入学|公共数字素养|公共数智素养|公共计算机|美育|艺术与体育|哲学、思维与语言|创新、创意与创业|历史、政治与社会|科学、技术与方法|大学生安全教育|感知中国/,
  );
}

export function classifyCourse({ name, category, sourceCategoryTexts = [] }) {
  const texts = sourceCategoryTexts;
  const mooc = isMoocName(name);
  let scheme;

  if (category === "sports" || isPeName(name) || hasText(texts, /(^|\/)体育(\/|$)/)) {
    scheme = "pe";
  } else if (hasText(texts, /思想政治理论课/) || isCanonicalIdeology(name)) {
    scheme = "ideology";
  } else if (hasText(texts, /公共数学课/) || isCommonMathName(name)) {
    if (/计算机|Python|程序/.test(name)) {
      scheme = isPrimarilyMajor(texts) ? "major" : "public_basic";
    } else {
      scheme = "math";
    }
  } else if (
    (hasText(texts, /公共外语课|综合英语|英语听说|英语视听说|外教基础口语|外教高阶|高阶英语/) ||
      isPublicEnglishName(name)) &&
    !isPrimarilyMajor(texts)
  ) {
    scheme = "english";
  } else if (mooc) {
    if (isArtPublic(name) || /尔雅网络课程|智慧树网络课程|体育保健/.test(name)) {
      scheme = "public_basic";
    } else if (/大学体育/.test(name) || publicPeSkill(name)) {
      scheme = "pe";
    } else if (/英语|视听说/.test(name)) {
      scheme = "english";
    } else {
      scheme = "major";
    }
  } else if (isPublicBasicPath(texts) && !isPrimarilyMajor(texts)) {
    scheme = "public_basic";
  } else {
    scheme = "major";
  }

  return { schemeKey: scheme, tags: mooc ? ["mooc"] : [] };
}

function parseDotenv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

const quality = new Map();
for (const line of (await readFile(qualityPath, "utf8")).split(/\r?\n/).filter(Boolean)) {
  const row = JSON.parse(line);
  quality.set(row.courseCode, row);
}

const previewBuckets = {
  major: [],
  ideology: [],
  math: [],
  public_basic: [],
  english: [],
  pe: [],
};
const moocByScheme = {
  major: [],
  ideology: [],
  math: [],
  public_basic: [],
  english: [],
  pe: [],
};
for (const row of quality.values()) {
  const classified = classifyCourse({
    name: row.currentName,
    category: row.category,
    sourceCategoryTexts: row.sourceCategoryTexts,
  });
  previewBuckets[classified.schemeKey].push(row);
  if (classified.tags.includes("mooc")) {
    moocByScheme[classified.schemeKey].push(row.currentName);
  }
}

const preview = {
  qualityCourses: quality.size,
  counts: Object.fromEntries(
    Object.entries(previewBuckets).map(([key, rows]) => [key, rows.length]),
  ),
  moocCounts: Object.fromEntries(
    Object.entries(moocByScheme).map(([key, rows]) => [key, rows.length]),
  ),
  samples: Object.fromEntries(
    Object.entries(previewBuckets).map(([key, rows]) => [
      key,
      rows.slice(0, 20).map((row) => row.currentName),
    ]),
  ),
  moocSamples: moocByScheme,
};
preview.full = Object.fromEntries(
  ["pe", "ideology", "math", "english"].map((key) => [
    key,
    previewBuckets[key].map((row) => ({
      code: row.courseCode,
      name: row.currentName,
      texts: row.sourceCategoryTexts,
    })),
  ]),
);
preview.publicBasicWatch = previewBuckets.public_basic
  .filter((row) =>
    /英语|数学|马克思|习近平|体育|安全|民族|红色|法治|基础英语|语文|心理健康/.test(
      row.currentName,
    ),
  )
  .map((row) => ({
    code: row.courseCode,
    name: row.currentName,
    texts: row.sourceCategoryTexts,
  }));
await writeFile(
  ".scratch/236-classify-preview.json",
  JSON.stringify(preview, null, 2),
  "utf8",
);
console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "preview",
      counts: preview.counts,
      moocCounts: preview.moocCounts,
      previewFile: ".scratch/236-classify-preview.json",
    },
    null,
    2,
  ),
);

if (!apply) process.exit(0);

const env = parseDotenv(await readFile(".dev.vars", "utf8"));
const password = process.env.JUFEXK_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD;
if (!password) throw new Error("missing admin password");

const cookies = new Map();
let csrf = "";
function remember(headers) {
  const list = headers.getSetCookie?.() ?? [headers.get("set-cookie") || ""];
  for (const value of list) {
    const match = /^([^=;,]+)=([^;]*)/.exec(value);
    if (match) cookies.set(match[1], match[2]);
  }
}
async function api(path, init = {}, attempt = 1) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Origin", baseUrl);
  if (cookies.size) {
    headers.set(
      "Cookie",
      [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    );
  }
  if (csrf && init.method && init.method !== "GET") {
    headers.set("X-CSRF-Token", csrf);
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  remember(response.headers);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      return api(path, init, attempt + 1);
    }
    throw new Error(`${init.method || "GET"} ${path}: ${body.error || response.status}`);
  }
  return body;
}

const login = await api("/api/admin/login", {
  method: "POST",
  body: JSON.stringify({ password }),
});
csrf = login.csrfToken;

const reviewBefore = await api("/api/admin/reviews?status=all&page=1&size=50");
const reviewSnapshots = (reviewBefore.items || []).map((row) => ({
  id: row.id,
  scheme_key: row.scheme_key ?? row.schemeKey ?? null,
  scheme_version: row.scheme_version ?? row.schemeVersion ?? null,
  scores: row.scores ?? null,
}));

const courses = await api("/api/admin/courses");
if (!Array.isArray(courses)) throw new Error("admin courses response is not an array");

const planned = [];
const unknownCodes = [];
for (const course of courses) {
  const evidence = quality.get(course.code);
  if (!evidence) unknownCodes.push({ id: course.id, code: course.code, name: course.name });
  const classified = classifyCourse({
    name: course.name,
    category: course.category,
    sourceCategoryTexts: evidence?.sourceCategoryTexts || [],
  });
  const currentScheme = course.scheme_key ?? null;
  const currentTags = String(course.tag_csv || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .sort();
  const nextTags = [...classified.tags].sort();
  const changed =
    currentScheme !== classified.schemeKey ||
    currentTags.join(",") !== nextTags.join(",");
  planned.push({
    id: course.id,
    code: course.code,
    name: course.name,
    category: course.category,
    department: course.department || "",
    description: course.description || "",
    credits: course.credits,
    from: { scheme_key: currentScheme, tags: currentTags },
    to: classified,
    changed,
  });
}

const changes = planned.filter((row) => row.changed);
const applyLog = {
  startedAt: new Date().toISOString(),
  total: planned.length,
  alreadyCorrect: planned.length - changes.length,
  toWrite: changes.length,
  unknownCodes: unknownCodes.length,
  reviewSnapshots,
  counts: planned.reduce((acc, row) => {
    acc[row.to.schemeKey] = (acc[row.to.schemeKey] || 0) + 1;
    return acc;
  }, {}),
  mooc: planned.filter((row) => row.to.tags.includes("mooc")).length,
  errors: [],
  written: 0,
};

const concurrency = 6;
for (let index = 0; index < changes.length; index += concurrency) {
  const batch = changes.slice(index, index + concurrency);
  const results = await Promise.allSettled(
    batch.map((row) =>
      api("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({
          id: row.id,
          code: row.code,
          name: row.name,
          category: row.category,
          department: row.department,
          description: row.description,
          schemeKey: row.to.schemeKey,
          tags: row.to.tags,
        }),
      }),
    ),
  );
  for (const [offset, result] of results.entries()) {
    if (result.status === "fulfilled") applyLog.written += 1;
    else {
      applyLog.errors.push({
        code: batch[offset].code,
        name: batch[offset].name,
        error: String(result.reason?.message || result.reason),
      });
    }
  }
  if ((index / concurrency) % 20 === 0) {
    console.log(
      JSON.stringify({
        progress: index + batch.length,
        written: applyLog.written,
        errors: applyLog.errors.length,
      }),
    );
  }
}

const coursesAfter = await api("/api/admin/courses");
const mismatches = [];
const afterCounts = {
  major: 0,
  ideology: 0,
  math: 0,
  public_basic: 0,
  english: 0,
  pe: 0,
  unset: 0,
  mooc: 0,
};
for (const course of coursesAfter) {
  const expected = classifyCourse({
    name: course.name,
    category: course.category,
    sourceCategoryTexts: quality.get(course.code)?.sourceCategoryTexts || [],
  });
  const actualScheme = course.scheme_key ?? null;
  const actualTags = String(course.tag_csv || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .sort();
  if (!actualScheme) afterCounts.unset += 1;
  else afterCounts[actualScheme] = (afterCounts[actualScheme] || 0) + 1;
  if (actualTags.includes("mooc")) afterCounts.mooc += 1;
  if (
    actualScheme !== expected.schemeKey ||
    actualTags.join(",") !== expected.tags.join(",")
  ) {
    mismatches.push({
      code: course.code,
      name: course.name,
      actualScheme,
      expected: expected.schemeKey,
      actualTags,
      expectedTags: expected.tags,
    });
  }
}

const reviewAfter = await api("/api/admin/reviews?status=all&page=1&size=50");
const reviewChanged = [];
for (const before of reviewSnapshots) {
  const after = (reviewAfter.items || []).find((row) => row.id === before.id);
  if (!after) continue;
  const afterKey = after.scheme_key ?? after.schemeKey ?? null;
  const afterVersion = after.scheme_version ?? after.schemeVersion ?? null;
  const afterScores = after.scores ?? null;
  if (
    afterKey !== before.scheme_key ||
    afterVersion !== before.scheme_version ||
    JSON.stringify(afterScores) !== JSON.stringify(before.scores)
  ) {
    reviewChanged.push({ id: before.id, before, after: { afterKey, afterVersion, afterScores } });
  }
}

applyLog.finishedAt = new Date().toISOString();
applyLog.afterCounts = afterCounts;
applyLog.mismatches = mismatches.slice(0, 50);
applyLog.mismatchCount = mismatches.length;
applyLog.reviewChanged = reviewChanged;
await writeFile(
  ".scratch/236-classify-apply-log.json",
  JSON.stringify(applyLog, null, 2),
  "utf8",
);
console.log(
  JSON.stringify(
    {
      written: applyLog.written,
      errors: applyLog.errors.length,
      unset: afterCounts.unset,
      afterCounts,
      mismatchCount: mismatches.length,
      reviewChanged: reviewChanged.length,
      unknownCodes: unknownCodes.length,
    },
    null,
    2,
  ),
);
if (applyLog.errors.length || mismatches.length || reviewChanged.length || afterCounts.unset) {
  process.exit(1);
}
