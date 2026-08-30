/**
 * Courses taught by a teacher — icourse-style stacked list.
 * Course name + code + stars / count; whole row → course×teacher detail.
 * Issue #482 · docs/ui/foundations.md §详情体验.
 */
import { Separator } from "@heroui/react";
import type { Course } from "../lib/types";
import { RouterAriaLink } from "./RouterAriaLink";
import { Stars } from "./Stars";

export type TeacherCourseTableProps = {
  items: Course[];
  /** Selected teacher, so course links open the matching 课程×教师 page. */
  teacherId?: number;
  /** Preserved query string when linking to course detail, e.g. location.search */
  search?: string;
  className?: string;
};

function courseHref(courseId: number, teacherId?: number, search = "") {
  const sp = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  if (teacherId != null) sp.set("teacher", String(teacherId));
  const q = sp.toString();
  return `/courses/${courseId}${q ? `?${q}` : ""}`;
}

export function TeacherCourseTable({
  items,
  teacherId,
  search = "",
  className,
}: TeacherCourseTableProps) {
  if (!items.length) {
    return (
      <div className="py-8 text-center text-muted" role="status">
        暂无任课课程
      </div>
    );
  }

  return (
    <div aria-label="任课课程" className={`min-w-0 ${className ?? ""}`.trim()} role="list">
      {items.map((course, index) => {
        const rating = course.rating ?? null;
        const reviewCount = course.review_count ?? 0;
        return (
          <div key={course.id} role="listitem">
            {index > 0 ? <Separator /> : null}
            <RouterAriaLink
              className="block! w-full! min-w-0 rounded-none! py-2.5 no-underline hover:bg-transparent hover:no-underline! sm:py-3"
              to={courseHref(course.id, teacherId, search)}
            >
              <span className="block min-w-0 break-words [overflow-wrap:anywhere] text-[1rem] font-medium text-accent">
                {course.name}
              </span>
              <span className="mt-1 block min-w-0 break-all text-[calc(13/15*1rem)] text-muted">
                课程号：{course.code || "未标注"}
              </span>
              <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Stars rating={rating} className="shrink-0 text-[1rem]" />
                {rating != null ? (
                  <span className="tabular text-[1rem] font-semibold leading-none text-accent">
                    {rating.toFixed(1)}
                  </span>
                ) : null}
                <span className="min-w-0 break-words text-[calc(12/15*1rem)] leading-none text-muted">
                  {reviewCount > 0
                    ? rating != null
                      ? `（${reviewCount} 人评价）`
                      : `（${reviewCount} 条评价）`
                    : "暂无评价"}
                </span>
              </span>
            </RouterAriaLink>
          </div>
        );
      })}
    </div>
  );
}
