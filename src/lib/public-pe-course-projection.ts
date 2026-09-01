import { catalogPinyinText, isAsciiLetterTerm } from "./catalog-pinyin";
import type { RelationPeDisplaySemantics } from "./pe-specialization-mapping";
import {
  formatPeSkillDisplayName,
  PE_PUBLIC_DISPLAY_PREFIX,
} from "./public-course-presentation";

export type PublicPeCourseListRow = {
  id: null;
  public_id: string;
  code: string;
  name: string;
  category: "sports";
  department: string;
  teachers: string | null;
  teacher_refs: string | null;
  review_count: number;
};

export const PUBLIC_COURSE_IDENTITY_PREFIX = "course:";
export const PUBLIC_PE_COURSE_IDENTITY_PREFIX = "pe:";
export const PUBLIC_RELATION_IDENTITY_PREFIX = "relation:";

export function publicCourseIdentity(courseId: number): string {
  return `${PUBLIC_COURSE_IDENTITY_PREFIX}${courseId}`;
}

export function publicPeCourseIdentity(normalizedSpecialization: string): string {
  return `${PUBLIC_PE_COURSE_IDENTITY_PREFIX}${normalizedSpecialization}`;
}

export function publicRelationIdentity(
  courseId: number,
  teacherId: number | null,
): string {
  return `${PUBLIC_RELATION_IDENTITY_PREFIX}${courseId}:${teacherId ?? "none"}`;
}

export function publicPeRelationIdentity(
  normalizedSpecialization: string,
  teacherId: number,
): string {
  return `${PUBLIC_PE_COURSE_IDENTITY_PREFIX}${normalizedSpecialization}:${teacherId}`;
}

export function resolvePePublicDisplayName(input: {
  normalizedSpecialization: string;
  sources: Array<{
    displaySemantics: RelationPeDisplaySemantics | string;
    sourceCourseName: string;
  }>;
}): string {
  const specialization = input.normalizedSpecialization.trim();
  const keepNames = [
    ...new Set(
      input.sources
        .filter((source) => source.displaySemantics === "keep_source_name")
        .map((source) => source.sourceCourseName.trim())
        .filter(Boolean),
    ),
  ];
  if (!keepNames.length) return formatPeSkillDisplayName(specialization);
  if (keepNames.length === 1) return keepNames[0];
  if (keepNames.includes(specialization)) return specialization;
  return formatPeSkillDisplayName(specialization);
}

/** Hide mapped source Courses from the ordinary Course-list SQL. */
export function publicPeMappedSourceCourseExcludeSql(alias = "c"): string {
  return `${alias}.id NOT IN (SELECT course_id FROM catalog_relation_pe_specializations)`;
}

type PeMappingRow = {
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

export type PeCourseAggregate = PublicPeCourseListRow & {
  specialization: string;
  teacherIds: number[];
  sourceNames: string[];
  sourceCodes: string[];
  sourceTeacherLabels: string[];
  sourceDepartments: string[];
};

function compareTeacher(
  left: { id: number; name: string },
  right: { id: number; name: string },
) {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  return left.id - right.id;
}

function aggregatePeMappings(rows: PeMappingRow[]): PeCourseAggregate[] {
  const groups = new Map<string, PeMappingRow[]>();
  for (const row of rows) {
    const specialization = row.normalized_specialization.trim();
    if (!specialization) continue;
    const list = groups.get(specialization) ?? [];
    list.push(row);
    groups.set(specialization, list);
  }
  return [...groups.entries()]
    .map(([specialization, sources]) => {
      const teachers = [
        ...new Map(
          sources.map((source) => [
            source.teacher_id,
            { id: source.teacher_id, name: source.teacher_name },
          ]),
        ).values(),
      ].sort(compareTeacher);
      const sourceNames = [
        ...new Set(sources.map((source) => source.course_name).filter(Boolean)),
      ];
      const sourceCodes = [
        ...new Set(sources.map((source) => source.course_code).filter(Boolean)),
      ];
      const sourceTeacherLabels = [
        ...new Set(
          sources.map((source) => source.source_teacher_label).filter(Boolean),
        ),
      ];
      const sourceDepartments = [
        ...new Set(
          sources
            .map((source) => (source.department ?? "").trim())
            .filter(Boolean),
        ),
      ];
      const name = resolvePePublicDisplayName({
        normalizedSpecialization: specialization,
        sources: sources.map((source) => ({
          displaySemantics: source.display_semantics,
          sourceCourseName: source.course_name,
        })),
      });
      return {
        id: null,
        public_id: publicPeCourseIdentity(specialization),
        code: "",
        name,
        category: "sports",
        department: sourceDepartments.length === 1 ? sourceDepartments[0] : "",
        teachers: teachers.map((teacher) => teacher.name).join(",") || null,
        teacher_refs: teachers.length
          ? teachers.map((teacher) => `${teacher.id}:${teacher.name}`).join(",")
          : null,
        review_count: sources.reduce(
          (sum, source) => sum + (Number(source.review_count) || 0),
          0,
        ),
        specialization,
        teacherIds: teachers.map((teacher) => teacher.id),
        sourceNames,
        sourceCodes,
        sourceTeacherLabels,
        sourceDepartments,
      } satisfies PeCourseAggregate;
    })
    .sort((left, right) =>
      left.specialization < right.specialization
        ? -1
        : left.specialization > right.specialization
          ? 1
          : 0,
    );
}

function peItemMatchesTerm(item: PeCourseAggregate, term: string): boolean {
  const needle = term.toLowerCase();
  const haystack = [
    item.specialization,
    item.name,
    formatPeSkillDisplayName(item.specialization),
    PE_PUBLIC_DISPLAY_PREFIX,
    ...item.sourceNames,
    ...item.sourceCodes,
    item.teachers ?? "",
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
    ...(item.teachers ? item.teachers.split(",") : []),
  ]).toLowerCase();
  return pinyin.includes(needle);
}

function toPublicPeCourseListItem(item: PeCourseAggregate): PublicPeCourseListRow {
  return {
    id: null,
    public_id: item.public_id,
    code: item.code,
    name: item.name,
    category: "sports",
    department: item.department,
    teachers: item.teachers,
    teacher_refs: item.teacher_refs,
    review_count: item.review_count,
  };
}

export async function loadPublicPeCourseProjection(db: D1Database): Promise<{
  items: PeCourseAggregate[];
  specializations: Set<string>;
}> {
  const { results } = await db
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
    .all<PeMappingRow>();
  const items = aggregatePeMappings(results ?? []);
  return {
    items,
    specializations: new Set(items.map((item) => item.specialization)),
  };
}

export function filterPublicPeCourseItems(
  items: PeCourseAggregate[],
  query: {
    searchTerms: string[];
    category: string;
    department: string;
    teacherId: number | null;
  },
): PublicPeCourseListRow[] {
  if (query.category && query.category !== "sports") return [];
  return items
    .filter((item) => {
      if (
        query.teacherId != null &&
        !item.teacherIds.includes(query.teacherId)
      )
        return false;
      if (
        query.department &&
        !item.sourceDepartments.some(
          (department) => department === query.department.trim(),
        )
      )
        return false;
      if (
        query.searchTerms.length &&
        !query.searchTerms.every((term) => peItemMatchesTerm(item, term))
      )
        return false;
      return true;
    })
    .map(toPublicPeCourseListItem);
}
