import {
  aggregateRelationDimensionLabels,
  relationDimensionKey,
  type FourDimSnapshot,
} from "./relation-four-dims";
import { publicTerm } from "./public-review-fields";
import type { PublicDimensionLabel } from "./review-schemes";
import { publicReviewBindingSql } from "../review-summary";

export type RelationKey = { courseId: number; teacherId: number | null };

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
  const courseIds = [...new Set(withTeacher.map((item) => item.courseId))];
  const placeholders = courseIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT r.course_id,r.teacher_id,r.scheme_key,r.scheme_version,r.scores
       FROM reviews r
       WHERE r.status='approved'${publicReviewBindingSql}
         AND r.course_id IN (${placeholders})`,
    )
    .bind(...courseIds)
    .all<{
      course_id: number;
      teacher_id: number;
      scheme_key: string | null;
      scheme_version: number | null;
      scores: string | null;
    }>();
  const allowed = new Set(
    withTeacher.map((item) => relationDimensionKey(item.courseId, item.teacherId)),
  );
  const grouped = new Map<string, FourDimSnapshot[]>();
  for (const row of results) {
    const key = relationDimensionKey(row.course_id, row.teacher_id);
    if (!allowed.has(key)) continue;
    const list = grouped.get(key) ?? [];
    list.push({
      schemeKey: row.scheme_key,
      schemeVersion: row.scheme_version,
      scores: row.scores,
    });
    grouped.set(key, list);
  }
  for (const [key, snapshots] of grouped) {
    const labels = aggregateRelationDimensionLabels(snapshots);
    if (labels) map.set(key, labels);
  }
  return map;
}

export async function loadRelationTerms(
  db: D1Database,
  courseId: number,
  teacherId: number,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT term FROM (
         SELECT trim(r.term) term
         FROM reviews r
         WHERE r.course_id=? AND r.teacher_id=? AND r.status='approved'
           AND trim(COALESCE(r.term,''))<>''${publicReviewBindingSql}
         UNION
         SELECT trim(lr.term) term
         FROM legacy_reviews lr
         WHERE lr.course_id=? AND lr.teacher_id=? AND lr.status='approved'
           AND trim(COALESCE(lr.comment,''))<>''
           AND trim(COALESCE(lr.term,''))<>''
         UNION
         SELECT trim(o.term) term
         FROM offerings o
         JOIN offering_teachers ot ON ot.offering_id=o.id
         WHERE o.course_id=? AND ot.teacher_id=?
           AND trim(COALESCE(o.term,''))<>''
       ) terms
       WHERE term IS NOT NULL AND term<>''
       ORDER BY term DESC`,
    )
    .bind(courseId, teacherId, courseId, teacherId, courseId, teacherId)
    .all<{ term: string }>();
  return results
    .map((row) => publicTerm(row.term))
    .filter((term): term is string => !!term);
}

export async function loadCourseRelationTerms(
  db: D1Database,
  courseId: number,
  teacherIds: number[],
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  await Promise.all(
    teacherIds.map(async (teacherId) => {
      map.set(teacherId, await loadRelationTerms(db, courseId, teacherId));
    }),
  );
  return map;
}
