import { isUmbrellaPeCourseName } from "./public-course-presentation";

/** Among skill-tagged umbrella rows, map when one venue skill is at least this share. */
export const VENUE_SKILL_MAJORITY_THRESHOLD = 0.8;

export const DEFAULT_CATALOG_INVENTORY_PATH =
  "scripts/catalog-baseline/captures/full-derived-v4/inventory.jsonl";

/** Classroom / hall names that are not PE skill venues. */
export const PE_NON_SKILL_LOCATION_MARKERS = [
  "麦二教",
  "麦一教",
  "枫青云楼",
  "麦萃庐",
  "麦大活",
] as const;

/** Venue keywords → 专项. 散打室 is 散打, not 武术; 击剑馆 is 击剑. */
const VENUE_SKILL_MARKERS: ReadonlyArray<{ skill: string; needles: readonly string[] }> = [
  { skill: "散打", needles: ["散打室", "散打"] },
  { skill: "跆拳道", needles: ["跆拳道场", "跆拳道"] },
  { skill: "乒乓球", needles: ["乒乓"] },
  { skill: "羽毛球", needles: ["羽毛球"] },
  { skill: "网球", needles: ["网球场", "网球"] },
  { skill: "足球", needles: ["足球场", "足球"] },
  { skill: "排球", needles: ["排球场", "排球"] },
  { skill: "篮球", needles: ["篮球场", "篮球"] },
  { skill: "瑜伽", needles: ["瑜伽教室", "瑜伽"] },
  { skill: "健美操", needles: ["健美操室", "健美操"] },
  { skill: "体育舞蹈", needles: ["舞蹈房"] },
  { skill: "轮滑", needles: ["轮滑场", "轮滑"] },
  { skill: "击剑", needles: ["击剑馆", "击剑"] },
  { skill: "武术", needles: ["武术"] },
];

export type InventoryVenueRecord = {
  courseName: string;
  teacherLabels: string[];
  sourceLocation: string;
};

export type UmbrellaVenueSkillStats = {
  teacherLabel: string;
  courseName: string;
  counts: Record<string, number>;
  skillTaggedCount: number;
};

export type VenueMajoritySkill = {
  skill: string;
  count: number;
  total: number;
  share: number;
};

export function venueStatsKey(teacherLabel: string, courseName: string): string {
  return `${teacherLabel.trim()}\t${courseName.trim()}`;
}

export function venueSkillFromLocation(location?: string | null): string | null {
  const text = location?.trim() ?? "";
  if (!text) return null;
  if (PE_NON_SKILL_LOCATION_MARKERS.some((marker) => text.includes(marker))) {
    return null;
  }
  for (const { skill, needles } of VENUE_SKILL_MARKERS) {
    if (needles.some((needle) => text.includes(needle))) return skill;
  }
  return null;
}

function teacherLabelsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function courseNameOf(record: Record<string, unknown>): string {
  const normalized =
    typeof record.normalizedCourseName === "string" ? record.normalizedCourseName.trim() : "";
  if (normalized) return normalized;
  return typeof record.rawCourseName === "string" ? record.rawCourseName.trim() : "";
}

export function parseInventoryVenueRecord(value: unknown): InventoryVenueRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const courseName = courseNameOf(record);
  const normalizedLabels = teacherLabelsOf(record.normalizedTeacherLabels);
  const teacherLabels = normalizedLabels.length
    ? normalizedLabels
    : teacherLabelsOf(record.rawTeacherLabels);
  if (!courseName || !teacherLabels.length) return null;
  const sourceLocation =
    typeof record.sourceLocation === "string" ? record.sourceLocation : "";
  return { courseName, teacherLabels, sourceLocation };
}

export function parseInventoryJsonl(text: string): InventoryVenueRecord[] {
  const rows: InventoryVenueRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`inventory.jsonl 第 ${index + 1} 行不是 JSON`);
    }
    const record = parseInventoryVenueRecord(parsed);
    if (record) rows.push(record);
  }
  return rows;
}

export function aggregateUmbrellaVenueSkills(
  records: InventoryVenueRecord[],
): Map<string, UmbrellaVenueSkillStats> {
  const stats = new Map<string, UmbrellaVenueSkillStats>();
  for (const record of records) {
    if (!isUmbrellaPeCourseName(record.courseName)) continue;
    const skill = venueSkillFromLocation(record.sourceLocation);
    if (!skill) continue;
    for (const teacherLabel of record.teacherLabels) {
      const key = venueStatsKey(teacherLabel, record.courseName);
      const current = stats.get(key) ?? {
        teacherLabel,
        courseName: record.courseName,
        counts: {},
        skillTaggedCount: 0,
      };
      current.counts[skill] = (current.counts[skill] ?? 0) + 1;
      current.skillTaggedCount += 1;
      stats.set(key, current);
    }
  }
  return stats;
}

export function majorityVenueSkill(
  counts: Record<string, number>,
  threshold = VENUE_SKILL_MAJORITY_THRESHOLD,
): VenueMajoritySkill | null {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total <= 0) return null;
  entries.sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh"),
  );
  const [skill, count] = entries[0];
  const share = count / total;
  if (share < threshold) return null;
  return { skill, count, total, share };
}

export function formatVenueSkillCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh"))
    .map(([skill, count]) => `${skill} ${count}`)
    .join("、");
}

export function venueCountsFor(
  stats: Map<string, UmbrellaVenueSkillStats> | undefined,
  teacherLabel: string,
  courseName: string,
): Record<string, number> {
  if (!stats) return {};
  return stats.get(venueStatsKey(teacherLabel, courseName))?.counts ?? {};
}
