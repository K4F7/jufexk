import {
  aggregateRelationDimensionLabels,
  relationDimensionKey,
  type FourDimSnapshot,
} from "./relation-four-dims";
import type { PublicDimensionLabel } from "./review-schemes";
import { publicReviewBindingSql } from "../public-review-visibility";

export type RelationKey = { courseId: number; teacherId: number | null };

type DimensionReviewRow = {
  course_id: number;
  teacher_id: number;
  scheme_key: string | null;
  scheme_version: number | null;
  scores: string | null;
};

async function loadPublicDimensionSnapshots(
  db: D1Database,
  courseIds: number[],
): Promise<DimensionReviewRow[]> {
  if (!courseIds.length) return [];
  const placeholders = courseIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT r.course_id,r.teacher_id,r.scheme_key,r.scheme_version,r.scores
       FROM reviews r
       WHERE r.status='approved'${publicReviewBindingSql}
         AND r.course_id IN (${placeholders})`,
    )
    .bind(...courseIds)
    .all<DimensionReviewRow>();
  return results ?? [];
}

function snapshotFromRow(row: DimensionReviewRow): FourDimSnapshot {
  return {
    schemeKey: row.scheme_key,
    schemeVersion: row.scheme_version,
    scores: row.scores,
  };
}

export async function loadRelationDimensionLabels(
  db: D1Database,
  relations: RelationKey[],
): Promise<Map<string, PublicDimensionLabel[]>> {
  const map = new Map<string, PublicDimensionLabel[]>();
  const withTeacher = relations.filter(
    (item): item is { courseId: number; teacherId: number } =>
      item.teacherId != null,
  );
  if (!withTeacher.length) return map;
  const results = await loadPublicDimensionSnapshots(
    db,
    [...new Set(withTeacher.map((item) => item.courseId))],
  );
  const allowed = new Set(
    withTeacher.map((item) => relationDimensionKey(item.courseId, item.teacherId)),
  );
  const grouped = new Map<string, FourDimSnapshot[]>();
  for (const row of results) {
    const key = relationDimensionKey(row.course_id, row.teacher_id);
    if (!allowed.has(key)) continue;
    const list = grouped.get(key) ?? [];
    list.push(snapshotFromRow(row));
    grouped.set(key, list);
  }
  for (const [key, snapshots] of grouped) {
    const labels = aggregateRelationDimensionLabels(snapshots);
    if (labels) map.set(key, labels);
  }
  return map;
}

export async function loadGroupedRelationDimensionLabels(
  db: D1Database,
  groups: Array<{
    key: string;
    sources: Array<{ courseId: number; teacherId: number }>;
  }>,
): Promise<Map<string, PublicDimensionLabel[]>> {
  const map = new Map<string, PublicDimensionLabel[]>();
  const sources = groups.flatMap((group) => group.sources);
  if (!sources.length) return map;
  const results = await loadPublicDimensionSnapshots(
    db,
    [...new Set(sources.map((item) => item.courseId))],
  );
  const snapshotsBySource = new Map<string, FourDimSnapshot[]>();
  for (const row of results) {
    const key = relationDimensionKey(row.course_id, row.teacher_id);
    const list = snapshotsBySource.get(key) ?? [];
    list.push(snapshotFromRow(row));
    snapshotsBySource.set(key, list);
  }
  for (const group of groups) {
    const snapshots = group.sources.flatMap(
      (source) =>
        snapshotsBySource.get(
          relationDimensionKey(source.courseId, source.teacherId),
        ) ?? [],
    );
    const labels = aggregateRelationDimensionLabels(snapshots);
    if (labels) map.set(group.key, labels);
  }
  return map;
}
