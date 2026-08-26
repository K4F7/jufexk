/**
 * 把教务开课班收成待选课表用的课程行，以及某课的全部班次。
 */
import type { JwxtOffering } from "./jwxt-offering";
import type { PlannedItem, PlanOrigin } from "./jwxt-plan";
import type { JwxtSnapshotV1 } from "./jwxt-snapshot";

export function requiredElectiveLabel(categoryPath: string, origin: PlanOrigin): string {
  if (/选修|公选|通识/.test(categoryPath) || origin === "public") return "选";
  if (/必修/.test(categoryPath) || origin === "enrolled" || origin === "planned") return "必";
  return "—";
}

export function planStatusLabel(item: PlannedItem | undefined): string {
  if (!item) return "未选";
  if (item.origin === "enrolled" && !item.included) return "已排除";
  if (item.status === 0) return "未选";
  if (!item.included) return "已排除";
  if (item.status === 1) return "备选";
  return "已选";
}

export function uniquePlanCourses(items: PlannedItem[]): PlannedItem[] {
  const seen = new Map<string, PlannedItem>();
  for (const item of items) {
    const existing = seen.get(item.courseCode);
    if (!existing || item.status > existing.status || (item.included && !existing.included)) {
      seen.set(item.courseCode, item);
    }
  }
  return [...seen.values()];
}

export function snapshotSectionsForCourse(
  snapshot: JwxtSnapshotV1,
  courseCode: string,
  includeCandidates = true,
): JwxtOffering[] {
  if (!courseCode) return [];
  const buckets = includeCandidates
    ? [snapshot.enrolled, snapshot.planned, snapshot.publicElectives]
    : [snapshot.enrolled];
  const seen = new Set<string>();
  const rows: JwxtOffering[] = [];
  for (const bucket of buckets) {
    for (const offering of bucket) {
      if (offering.courseCode !== courseCode) continue;
      const dedupeKey = `${offering.section}\0${offering.teacherName}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push(offering);
    }
  }
  return rows;
}
