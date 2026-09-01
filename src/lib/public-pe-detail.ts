import { toPublicTeacher } from "../cta-teacher-homepage";
import { loadGroupedRelationDimensionLabels } from "./relation-projections";
import { courseSchemeView } from "./review-schemes";
import {
  VIRTUAL_PE_SPORTS,
  virtualPeSportById,
  virtualPeSportDisplayName,
} from "./public-course-presentation";
import {
  normalizePublicPeSpecialization,
  parsePublicCourseParam,
  virtualPeAliasSpecialization,
  virtualPeSportForSpecialization,
} from "./public-course-identity";
import {
  loadPublicPeCourseProjection,
  publicPeCourseIdentity,
} from "./public-pe-course-projection";
import {
  loadPublicPeRelationProjection,
  type PeRelationAggregate,
} from "./public-pe-relation-projection";
import {
  loadRelationSignalPayloads,
  type RelationSignalCounts,
  type RelationSignalViewer,
} from "../relation-signals";
import { getMappedRelationSummaries } from "../review-summary";

export type PublicPeReadTarget =
  | { kind: "mapped"; specialization: string }
  | { kind: "virtual"; sport: (typeof VIRTUAL_PE_SPORTS)[number] }
  | { kind: "ordinary"; courseId: number }
  | { kind: "missing" };

export type PublicPeSourceRelation = { courseId: number; teacherId: number };

export type PublicPeCourseDetail = {
  course: Record<string, unknown> & {
    id: null;
    public_id: string;
    teachers: Array<Record<string, unknown>>;
    nameVariants: unknown[];
  };
  reviewCount: number;
  summaries: Awaited<ReturnType<typeof getMappedRelationSummaries>>;
};

const emptySignals = (
  viewerUserId: string | null,
): RelationSignalCounts & Partial<RelationSignalViewer> => ({
  follow_count: 0,
  recommend_count: 0,
  not_recommend_count: 0,
  ...(viewerUserId
    ? {
        viewer_followed: false,
        viewer_recommended: false,
        viewer_not_recommended: false,
      }
    : {}),
});

export function peRelationSourceKeys(
  item: Pick<PeRelationAggregate, "source_course_ids" | "teacher_id" | "specialization">,
): PublicPeSourceRelation[] {
  const teacherId = Number(item.teacher_id);
  const keys = item.source_course_ids
    .map((courseId) => Number(courseId))
    .filter((courseId) => Number.isSafeInteger(courseId) && courseId > 0)
    .map((courseId) => ({ courseId, teacherId }));
  const aliasId = VIRTUAL_PE_SPORTS.find(
    (sport) => sport.label === item.specialization,
  )?.id;
  if (aliasId) keys.push({ courseId: aliasId, teacherId });
  return keys;
}

export async function loadMappedPeSourceRelations(
  db: D1Database,
  specialization: string,
  teacherId?: number | null,
): Promise<PublicPeSourceRelation[]> {
  const teacherFilter = teacherId != null ? " AND teacher_id=?" : "";
  const binds =
    teacherId != null ? [specialization, teacherId] : [specialization];
  const { results } = await db
    .prepare(
      `SELECT course_id,teacher_id
       FROM catalog_relation_pe_specializations
       WHERE normalized_specialization=?${teacherFilter}
       ORDER BY course_id,teacher_id`,
    )
    .bind(...binds)
    .all<{ course_id: number; teacher_id: number }>();
  return (results ?? [])
    .map((row) => ({
      courseId: Number(row.course_id),
      teacherId: Number(row.teacher_id),
    }))
    .filter(
      (row) =>
        Number.isSafeInteger(row.courseId) &&
        row.courseId > 0 &&
        Number.isSafeInteger(row.teacherId) &&
        row.teacherId > 0,
    );
}

export async function resolvePublicPeReadTarget(
  db: D1Database,
  rawParam: string | undefined,
  peSpecializations?: ReadonlySet<string>,
): Promise<PublicPeReadTarget> {
  const parsed = parsePublicCourseParam(rawParam);
  if (parsed.kind === "invalid") return { kind: "missing" };
  const alias =
    parsed.kind === "numeric" ? virtualPeAliasSpecialization(parsed.id) : null;
  if (parsed.kind === "numeric" && !alias) {
    return { kind: "ordinary", courseId: parsed.id };
  }
  const specializations =
    peSpecializations ?? (await loadPublicPeCourseProjection(db)).specializations;
  if (parsed.kind === "numeric") {
    if (alias && specializations.has(alias)) {
      return { kind: "mapped", specialization: alias };
    }
    const sport = virtualPeSportById(parsed.id);
    return sport ? { kind: "virtual", sport } : { kind: "missing" };
  }
  const specialization =
    normalizePublicPeSpecialization(parsed.specialization) ??
    parsed.specialization.trim();
  if (!specialization) return { kind: "missing" };
  if (specializations.has(specialization)) {
    return { kind: "mapped", specialization };
  }
  const sport = virtualPeSportForSpecialization(specialization);
  return sport ? { kind: "virtual", sport } : { kind: "missing" };
}

function mergeSignalPayloads(
  keys: PublicPeSourceRelation[],
  map: Awaited<ReturnType<typeof loadRelationSignalPayloads>>,
  viewerUserId: string | null,
) {
  const merged = emptySignals(viewerUserId);
  for (const key of keys) {
    const current = map.get(`${key.courseId}:${key.teacherId}`);
    if (!current) continue;
    merged.follow_count += current.follow_count;
    merged.recommend_count += current.recommend_count;
    merged.not_recommend_count += current.not_recommend_count;
    if (current.viewer_followed) merged.viewer_followed = true;
    if (current.viewer_recommended) merged.viewer_recommended = true;
    if (current.viewer_not_recommended) merged.viewer_not_recommended = true;
  }
  return merged;
}

export async function loadMappedPeCourseDetail(
  db: D1Database,
  specialization: string,
  viewerUserId: string | null,
  courseProjection?: Awaited<ReturnType<typeof loadPublicPeCourseProjection>>,
  relationProjection?: Awaited<ReturnType<typeof loadPublicPeRelationProjection>>,
): Promise<PublicPeCourseDetail | null> {
  const [courses, relations] = await Promise.all([
    courseProjection
      ? Promise.resolve(courseProjection)
      : loadPublicPeCourseProjection(db),
    relationProjection
      ? Promise.resolve(relationProjection)
      : loadPublicPeRelationProjection(db),
  ]);
  const course = courses.items.find(
    (item) => item.specialization === specialization,
  );
  if (!course) return null;
  const peRelations = relations.items.filter(
    (item) => item.specialization === specialization,
  );
  if (!peRelations.length) return null;
  const teacherIds = peRelations.map((item) => item.teacher_id);
  const placeholders = teacherIds.map(() => "?").join(",");
  const teacherRows = (
    (await db
      .prepare(
        `SELECT t.* FROM teachers t WHERE t.id IN (${placeholders})`,
      )
      .bind(...teacherIds)
      .all()) as { results?: Array<Record<string, unknown>> }
  ).results;
  const teachersById = new Map(
    (teacherRows ?? []).map((row) => [Number(row.id), row]),
  );
  const signalKeys = peRelations.flatMap((item) => peRelationSourceKeys(item));
  const dimGroups = peRelations.map((item) => ({
    key: String(item.teacher_id),
    sources: item.source_course_ids.map((courseId) => ({
      courseId,
      teacherId: item.teacher_id,
    })),
  }));
  const [dimMap, signalMap, summaries] = await Promise.all([
    loadGroupedRelationDimensionLabels(db, dimGroups),
    loadRelationSignalPayloads(db, signalKeys, viewerUserId),
    getMappedRelationSummaries(
      db,
      peRelations.flatMap((item) =>
        item.source_course_ids.map((courseId) => ({
          courseId,
          teacherId: item.teacher_id,
        })),
      ),
    ),
  ]);
  const teachers = peRelations
    .map((item) => {
      const teacher = teachersById.get(item.teacher_id);
      if (!teacher) return null;
      return {
        ...toPublicTeacher(teacher),
        review_count: item.review_count,
        rating: item.rating,
        dimensionLabels: dimMap.get(String(item.teacher_id)) ?? null,
        ...mergeSignalPayloads(
          peRelationSourceKeys(item),
          signalMap,
          viewerUserId,
        ),
      } as Record<string, unknown>;
    })
    .filter((teacher): teacher is Record<string, unknown> => teacher != null)
    .sort((left, right) => {
      const leftCount = Number(left.review_count) || 0;
      const rightCount = Number(right.review_count) || 0;
      if (leftCount !== rightCount) return rightCount - leftCount;
      const leftName = String(left.name ?? "");
      const rightName = String(right.name ?? "");
      if (leftName !== rightName) return leftName < rightName ? -1 : 1;
      return Number(left.id) - Number(right.id);
    });
  if (!teachers.length) return null;
  return {
    course: {
      id: null,
      public_id: publicPeCourseIdentity(specialization),
      code: "",
      name: course.name,
      category: "sports",
      department: course.department,
      teachers,
      nameVariants: [],
      enrollment_category: "",
      teaching_type: "",
      course_level: "",
      ...courseSchemeView(null, "sports", []),
    },
    reviewCount: course.review_count,
    summaries,
  };
}

export function virtualPeCourseListItem(
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  teachers: Array<{ id: number; name: string }>,
) {
  return {
    id: sport.id,
    public_id: publicPeCourseIdentity(sport.label),
    code: "",
    name: virtualPeSportDisplayName(sport),
    category: "sports" as const,
    department: "",
    teachers: teachers.map((teacher) => teacher.name).join(","),
    teacher_refs: teachers
      .map((teacher) => `${teacher.id}:${teacher.name}`)
      .join(","),
    review_count: 0,
    rating: null,
  };
}

export async function loadVirtualPeCourseDetail(
  db: D1Database,
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  viewerUserId: string | null,
) {
  const placeholders = sport.teacherNames.map(() => "?").join(",");
  const teachers = (
    await db
      .prepare(
        `SELECT t.*,0 review_count,NULL rating FROM teachers t
         WHERE t.name IN (${placeholders}) ORDER BY t.name,t.id`,
      )
      .bind(...sport.teacherNames)
      .all()
  ).results as Array<Record<string, unknown> & { id: number; name: string }>;
  if (!teachers.length) return null;
  const signals = await loadRelationSignalPayloads(
    db,
    teachers.map((teacher) => ({
      courseId: sport.id,
      teacherId: teacher.id,
    })),
    viewerUserId,
  );
  return {
    course: {
      id: sport.id,
      public_id: publicPeCourseIdentity(sport.label),
      code: "",
      name: virtualPeSportDisplayName(sport),
      category: "sports",
      department: "",
      teachers: teachers.map((teacher) => ({
        ...toPublicTeacher(teacher),
        review_count: 0,
        rating: null,
        dimensionLabels: null,
        ...(signals.get(`${sport.id}:${teacher.id}`) ?? {
          follow_count: 0,
          recommend_count: 0,
          not_recommend_count: 0,
        }),
      })),
      nameVariants: [],
      enrollment_category: "",
      teaching_type: "",
      course_level: "",
      ...courseSchemeView(null, "sports", []),
    },
    reviewCount: 0,
  };
}

export function peCourseFromTeacherRelation(item: PeRelationAggregate) {
  return {
    id: null,
    public_id: publicPeCourseIdentity(item.specialization),
    code: "",
    name: item.name,
    category: "sports" as const,
    department: item.department,
    review_count: item.review_count,
    rating: item.rating,
  };
}
