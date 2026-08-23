/**
 * 江财培养方案路径 → 详情页选课类别 / 教学类型 / 课程层次（#436）。
 * 输入是查询课表「课程类别」原文或选课结果页那一格，不是评价规则键。
 */

export type JxufCoursePlan = {
  enrollmentCategory: string;
  teachingType: string;
  courseLevel: string;
};

export type ParsedCategoryPath = {
  raw: string;
  teachingType: string;
  year: number | null;
  bucket: string;
  mid: string;
  requirement: string;
  noise: boolean;
};

const TEACHING_TYPES = ["理论实验课", "理论课", "实验课", "实践课"] as const;
const REQUIREMENTS = new Set(["必修课", "选修课", "任选课", "限选课"]);
const NOISE_LEAFS = new Set([
  "拔尖型",
  "卓越型",
  "创新创业型",
  "专业方向",
]);

const BUCKET_ALIASES: Record<string, string> = {
  专业课: "专业教育课",
  专业教育: "专业教育课",
  通识课程: "通识教育课",
  通识教育: "通识教育课",
  实践教育: "实践教育课",
  发展指导: "实践教育课",
  发展指导课: "实践教育课",
  学科基础课: "专业教育课",
};

const MID_ALIASES: Record<string, string> = {
  专业方向选修课: "专业方向课",
  学科基础课程: "学科基础课",
  学科开放课程: "学科开放课",
  专业方向限选课: "专业限选课",
};

const MID_HARDNESS: Record<string, number> = {
  专业必修课: 100,
  学科基础课: 90,
  专业大类课: 88,
  学科大类课: 86,
  专业限选课: 80,
  专业方向课: 70,
  学科开放课: 60,
  集中实习: 50,
};

const ENROLL_HARDNESS: Record<string, number> = {
  专业内必修课: 100,
  专业限选: 80,
  专业内选修课: 70,
  实践必修: 55,
  通识必修: 50,
  公共必修: 45,
  通识选修: 30,
  公共选修: 25,
  跨专业: 20,
};

const emptyPlan = (): JxufCoursePlan => ({
  enrollmentCategory: "",
  teachingType: "",
  courseLevel: "",
});

export function normalizeCategoryText(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function teachingPrefix(text: string) {
  for (const label of TEACHING_TYPES) {
    if (text === label || text.startsWith(`${label} `))
      return { teach: label, rest: text.slice(label.length).trim() };
  }
  return { teach: "", rest: text };
}

function yearAndBucket(part: string) {
  const match = /^(\d{4})(.*)$/.exec(part);
  if (!match) return { year: null as number | null, bucket: part };
  return { year: Number(match[1]), bucket: match[2] };
}

function aliasBucket(rawBucket: string, mid: string) {
  if (rawBucket === "素质拓展") {
    if (mid === "体育") return "公共课";
    return "实践教育课";
  }
  return BUCKET_ALIASES[rawBucket] || rawBucket;
}

function aliasMid(rawMid: string) {
  return MID_ALIASES[rawMid] || rawMid;
}

export function parseCategoryPath(text: string): ParsedCategoryPath {
  const raw = normalizeCategoryText(text);
  const { teach, rest } = teachingPrefix(raw);
  const parts = rest.split("/").map((part) => part.trim()).filter(Boolean);
  let requirement = "";
  let yearPart = "";
  let mid = "";
  if (parts[0] && REQUIREMENTS.has(parts[0])) {
    requirement = parts[0];
    yearPart = parts[1] || "";
    mid = parts[2] || "";
  } else if (parts[0] && /^\d{4}/.test(parts[0])) {
    yearPart = parts[0];
    mid = parts[1] || "";
    requirement = parts[2] && REQUIREMENTS.has(parts[2]) ? parts[2] : "";
  } else {
    yearPart = parts[0] || "";
    mid = parts[1] || "";
    requirement = parts[2] && REQUIREMENTS.has(parts[2]) ? parts[2] : "";
  }
  const { year, bucket: rawBucket } = yearAndBucket(yearPart);
  const bucket = aliasBucket(rawBucket, mid);
  const displayMid = aliasMid(mid);
  const noise =
    !raw ||
    NOISE_LEAFS.has(raw.replace(/\/$/, "")) ||
    (requirement === "任选课" && bucket === "公共课" && !displayMid) ||
    (!bucket && !displayMid) ||
    (REQUIREMENTS.has(raw.replace(/\/$/, "")) && !bucket && !displayMid);
  return {
    raw,
    teachingType: teach,
    year,
    bucket,
    mid: displayMid,
    requirement,
    noise,
  };
}

export function enrollmentCategoryOf(path: ParsedCategoryPath) {
  if (path.noise) return "";
  const limited =
    path.requirement === "限选课" || path.mid.includes("限选");
  const required = path.requirement === "必修课";
  const elective =
    path.requirement === "选修课" || path.requirement === "任选课";
  if (path.bucket === "专业教育课") {
    if (limited) return "专业限选";
    if (required) return "专业内必修课";
    if (elective) return "专业内选修课";
  }
  if (path.bucket === "公共课") {
    if (required) return "公共必修";
    if (elective || limited) return "公共选修";
  }
  if (path.bucket === "通识教育课") {
    if (required) return "通识必修";
    if (elective || limited) return "通识选修";
  }
  if (path.bucket === "实践教育课") return "实践必修";
  if (path.bucket === "跨专业") return "跨专业";
  return "";
}

function hardness(path: ParsedCategoryPath, enroll: string) {
  return (
    (MID_HARDNESS[path.mid] ?? 20) * 1000 + (ENROLL_HARDNESS[enroll] ?? 0)
  );
}

export function selectJxufCoursePlan(
  texts: readonly string[] | null | undefined,
): JxufCoursePlan {
  const candidates = (texts ?? [])
    .map((text) => {
      const path = parseCategoryPath(text);
      const enrollmentCategory = enrollmentCategoryOf(path);
      return { path, enrollmentCategory };
    })
    .filter(
      (row) =>
        !row.path.noise && (row.enrollmentCategory || row.path.mid),
    );
  if (!candidates.length) return emptyPlan();
  const preferredYear = candidates.reduce(
    (best, row) => Math.max(best, row.path.year ?? -1),
    -1,
  );
  const ofYear = candidates.filter(
    (row) => (row.path.year ?? -1) === preferredYear,
  );
  const selected = ofYear.reduce((best, row) =>
    hardness(row.path, row.enrollmentCategory) >
    hardness(best.path, best.enrollmentCategory)
      ? row
      : best,
  );
  return {
    enrollmentCategory: selected.enrollmentCategory,
    teachingType: selected.path.teachingType,
    courseLevel: selected.path.mid,
  };
}

export function mostFrequent<T>(values: readonly T[]) {
  const counts = new Map<T, number>();
  for (const value of values)
    counts.set(value, (counts.get(value) || 0) + 1);
  let winner: T | undefined;
  let best = -1;
  for (const [value, count] of counts) {
    if (count > best) {
      winner = value;
      best = count;
    }
  }
  return winner;
}
