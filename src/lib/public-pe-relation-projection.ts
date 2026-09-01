import { catalogPinyinText, isAsciiLetterTerm } from "./catalog-pinyin";
import type { RelationPeDisplaySemantics } from "./pe-specialization-mapping";
import {
  formatPeSkillDisplayName,
  PE_PUBLIC_DISPLAY_PREFIX,
} from "./public-course-presentation";
import {
  publicPeRelationIdentity,
  resolvePePublicDisplayName,
} from "./public-pe-course-projection";
import { guestReviewBindingSql } from "../public-review-visibility";

export type PublicPeRelationListRow = {
  course_id: null;
  public_id: string;
  code: string;
  name: string;
  category: "sports";
  department: string;
  teacher_id: number;
  teacher_name: string;
  rating: number | null;
  review_count: number;
  source_course_ids: number[];
};

/** Same aggregation as `public_relation_ratings` / ordinary Relation rows. */
export const PUBLIC_RELATION_RATING_SQL = "ROUND(AVG(r.overall),1)";

export function publicPeMappedSourceRelationExcludeSql(
  courseAlias = "c",
  teacherAlias = "ct",
): string {
  return `NOT EXISTS (
    SELECT 1 FROM catalog_relation_pe_specializations pe_mapped
    WHERE pe_mapped.course_id=${courseAlias}.id
      AND pe_mapped.teacher_id=${teacherAlias}.teacher_id
  )`;
}

type PeRelationMappingRow = {
  course_id: number;
  teacher_id: number;
  normalized_specialization: string;
  display_semantics: string;
  course_name: string;
  course_code: string;
  department: string | null;
  teacher_name: string;
  source_teacher_label: string;
  review_count: number;
};

type PeRelationRatingRow = {
  normalized_specialization: string;
  teacher_id: number;
  rating: number | null;
};

export type PeRelationAggregate = PublicPeRelationListRow & {
  specialization: string;
  sourceNames: string[];
  sourceCodes: string[];
  sourceTeacherLabels: string[];
  sourceDepartments: string[];
};

function relationGroupKey(specialization: string, teacherId: number): string {
  return `${specialization}\u001f${teacherId}`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => (value ?? "").trim()).filter(Boolean))];
}

function aggregatePeRelations(
  rows: PeRelationMappingRow[],
  ratings: Map<string, number>,
): PeRelationAggregate[] {
  const groups = new Map<string, PeRelationMappingRow[]>();
  for (const row of rows) {
    const specialization = row.normalized_specialization.trim();
    const teacherId = Number(row.teacher_id);
    if (!specialization || !Number.isSafeInteger(teacherId) || teacherId <= 0) {
      continue;
    }
    const key = relationGroupKey(specialization, teacherId);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([, sources]) => {
      const first = sources[0];
      const specialization = first.normalized_specialization.trim();
      const teacherId = Number(first.teacher_id);
      const sourceDepartments = uniqueStrings(
        sources.map((source) => source.department),
      );
      const name = resolvePePublicDisplayName({
        normalizedSpecialization: specialization,
        sources: sources.map((source) => ({
          displaySemantics: source.display_semantics as RelationPeDisplaySemantics,
          sourceCourseName: source.course_name,
        })),
      });
      const rating = ratings.get(relationGroupKey(specialization, teacherId));
      return {
        course_id: null,
        public_id: publicPeRelationIdentity(specialization, teacherId),
        code: "",
        name,
        category: "sports",
        department: sourceDepartments.length === 1 ? sourceDepartments[0] : "",
        teacher_id: teacherId,
        teacher_name: first.teacher_name,
        rating: rating == null ? null : Number(rating),
        review_count: sources.reduce(
          (sum, source) => sum + (Number(source.review_count) || 0),
          0,
        ),
        source_course_ids: [
          ...new Set(sources.map((source) => Number(source.course_id))),
        ],
        specialization,
        sourceNames: uniqueStrings(sources.map((source) => source.course_name)),
        sourceCodes: uniqueStrings(sources.map((source) => source.course_code)),
        sourceTeacherLabels: uniqueStrings(
          sources.map((source) => source.source_teacher_label),
        ),
        sourceDepartments,
      } satisfies PeRelationAggregate;
    })
    .sort((left, right) => {
      if (left.specialization !== right.specialization) {
        return left.specialization < right.specialization ? -1 : 1;
      }
      if (left.teacher_name !== right.teacher_name) {
        return left.teacher_name < right.teacher_name ? -1 : 1;
      }
      return left.teacher_id - right.teacher_id;
    });
}

function peRelationMatchesTerm(item: PeRelationAggregate, term: string): boolean {
  const needle = term.toLowerCase();
  const haystack = [
    item.specialization,
    item.name,
    formatPeSkillDisplayName(item.specialization),
    PE_PUBLIC_DISPLAY_PREFIX,
    ...item.sourceNames,
    ...item.sourceCodes,
    item.teacher_name,
    ...item.sourceTeacherLabels,
  ]
    .join("\n")
    .toLowerCase();
  if (haystack.includes(needle)) return true;
  if (!isAsciiLetterTerm(term)) return false;
  const pinyin = catalogPinyinText([
    item.specialization,
    item.name,
    formatPeSkillDisplayName(item.specialization),
    ...item.sourceNames,
    item.teacher_name,
  ]).toLowerCase();
  return pinyin.includes(needle);
}

function toPublicPeRelationListItem(
  item: PeRelationAggregate,
): PublicPeRelationListRow {
  return {
    course_id: null,
    public_id: item.public_id,
    code: item.code,
    name: item.name,
    category: "sports",
    department: item.department,
    teacher_id: item.teacher_id,
    teacher_name: item.teacher_name,
    rating: item.rating,
    review_count: item.review_count,
    source_course_ids: item.source_course_ids,
  };
}

export async function loadPublicPeRelationProjection(db: D1Database): Promise<{
  items: PeRelationAggregate[];
  specializations: Set<string>;
  identities: Set<string>;
}> {
  const [mappingResult, ratingResult] = await Promise.all([
    db
      .prepare(
        `SELECT m.course_id,m.teacher_id,m.normalized_specialization,
           m.display_semantics,c.name course_name,c.code course_code,c.department,
           t.name teacher_name,t.source_teacher_label,
           COALESCE(prc.review_count,0) review_count
         FROM catalog_relation_pe_specializations m
         JOIN courses c ON c.id=m.course_id
         JOIN teachers t ON t.id=m.teacher_id
         LEFT JOIN public_review_counts prc
           ON prc.course_id=m.course_id AND prc.teacher_id=m.teacher_id`,
      )
      .all<PeRelationMappingRow>(),
    db
      .prepare(
        `SELECT m.normalized_specialization,m.teacher_id,
           ${PUBLIC_RELATION_RATING_SQL} rating
         FROM catalog_relation_pe_specializations m
         JOIN reviews r
           ON r.course_id=m.course_id AND r.teacher_id=m.teacher_id
         WHERE r.status='approved'
           AND r.overall IS NOT NULL
           ${guestReviewBindingSql}
         GROUP BY m.normalized_specialization,m.teacher_id`,
      )
      .all<PeRelationRatingRow>(),
  ]);
  const ratings = new Map<string, number>();
  for (const row of ratingResult.results ?? []) {
    const specialization = row.normalized_specialization.trim();
    const teacherId = Number(row.teacher_id);
    if (!specialization || row.rating == null) continue;
    ratings.set(relationGroupKey(specialization, teacherId), Number(row.rating));
  }
  const items = aggregatePeRelations(mappingResult.results ?? [], ratings);
  return {
    items,
    specializations: new Set(items.map((item) => item.specialization)),
    identities: new Set(items.map((item) => item.public_id)),
  };
}

export function filterPublicPeRelationItems(
  items: PeRelationAggregate[],
  query: {
    category: string;
    department: string;
    teacherId: number | null;
    exactTeacherIds: number[] | null;
    courseSearchTerms: string[];
  },
): PublicPeRelationListRow[] {
  if (query.category && query.category !== "sports") return [];
  return items
    .filter((item) => {
      if (query.teacherId != null && item.teacher_id !== query.teacherId) {
        return false;
      }
      if (
        query.exactTeacherIds &&
        !query.exactTeacherIds.includes(item.teacher_id)
      ) {
        return false;
      }
      if (
        query.department &&
        !item.sourceDepartments.some(
          (department) => department === query.department.trim(),
        )
      ) {
        return false;
      }
      if (
        query.courseSearchTerms.length &&
        !query.courseSearchTerms.every((term) =>
          peRelationMatchesTerm(item, term),
        )
      ) {
        return false;
      }
      return true;
    })
    .map(toPublicPeRelationListItem);
}
