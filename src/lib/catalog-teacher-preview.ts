/** Catalog rows only mount this many teacher links; the rest stay on the detail page. */
export const CATALOG_TEACHER_PREVIEW_LIMIT = 3;

export type CatalogTeacherPreview<T> = {
  visible: T[];
  hiddenCount: number;
};

/**
 * Pick which teachers to mount in a clipped catalog cell.
 * Priority names (search hits) stay visible even when they are not in the
 * first `limit` source entries; the visible set keeps source order.
 */
export function previewCatalogTeachers<T>(
  teachers: readonly T[],
  options: {
    limit?: number;
    isPriority?: (teacher: T) => boolean;
  } = {},
): CatalogTeacherPreview<T> {
  const limit = options.limit ?? CATALOG_TEACHER_PREVIEW_LIMIT;
  if (teachers.length <= limit) {
    return { visible: [...teachers], hiddenCount: 0 };
  }

  const isPriority = options.isPriority;
  if (!isPriority) {
    return {
      visible: teachers.slice(0, limit),
      hiddenCount: teachers.length - limit,
    };
  }

  const chosen = new Set<number>();
  for (const [index, teacher] of teachers.entries()) {
    if (chosen.size >= limit) break;
    if (isPriority(teacher)) chosen.add(index);
  }
  for (const [index] of teachers.entries()) {
    if (chosen.size >= limit) break;
    chosen.add(index);
  }

  return {
    visible: teachers.filter((_, index) => chosen.has(index)),
    hiddenCount: teachers.length - chosen.size,
  };
}

export function teacherNameMatchesTerms(
  name: string,
  terms: readonly string[],
): boolean {
  if (!terms.length) return false;
  const hay = name.toLowerCase();
  return terms.some((term) => hay.includes(term.toLowerCase()));
}
