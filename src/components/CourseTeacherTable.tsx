/**
 * Teachers of a course — dense fold aligned with TeacherCourseTable.
 * Columns: 教师 (name) · 院系 · 评分/投稿 (per course-teacher relation).
 * Row click goes to `?teacher=` on the course page (评价按 课程×教师
 * 展示). The course page hides this table once a teacher is selected
 * (Issue #252); teacher name stays a real link to the teacher detail
 * page (keyboard / new-tab safe).
 * Issue #239 · #252 · docs/ui/foundations.md §详情体验.
 */
import { Table } from "@heroui/react";
import type { Teacher } from "../lib/types";
import { RatingCell } from "./RatingCell";
import { RouterAriaLink } from "./RouterAriaLink";

export type CourseTeacherTableProps = {
  items: Teacher[];
  /** Owning course id — row hrefs toggle the teacher selection on it. */
  courseId: number;
  /** Current query string (location.search, with or without `?`); catalog
   * state is preserved while the `teacher` selection param is toggled. */
  search: string;
  /** Currently selected teacher id (null = none). */
  selectedId: number | null;
  className?: string;
};

export function CourseTeacherTable({
  items,
  courseId,
  search,
  selectedId,
  className,
}: CourseTeacherTableProps) {
  const hrefFor = (teacherId: number) => {
    const id = Number(teacherId);
    const sp = new URLSearchParams(search);
    if (id === selectedId) sp.delete("teacher");
    else sp.set("teacher", String(id));
    const q = sp.toString();
    return `/courses/${courseId}${q ? `?${q}` : ""}`;
  };

  return (
    <Table className={className ? `dense-table ${className}` : "dense-table"}>
      <Table.ScrollContainer>
        <Table.Content aria-label="任课教师" className="min-w-[440px]">
          <Table.Header>
            <Table.Column isRowHeader>教师</Table.Column>
            <Table.Column>院系</Table.Column>
            <Table.Column>评分 / 投稿</Table.Column>
          </Table.Header>
          <Table.Body
            items={items}
            /* Row hrefs embed the current `teacher` selection; refresh them
             * when the query changes so a second click can clear it. */
            dependencies={[search, selectedId]}
            renderEmptyState={() => (
              <div className="py-8 text-center text-muted" role="status">
                教师待补充
              </div>
            )}
          >
            {(teacher) => {
              const selected = Number(teacher.id) === selectedId;
              return (
                <Table.Row
                  id={String(teacher.id)}
                  key={teacher.id}
                  href={hrefFor(teacher.id)}
                  aria-current={selected ? "true" : undefined}
                  className={
                    selected
                      ? "cursor-pointer bg-surface-secondary"
                      : "cursor-pointer"
                  }
                >
                  <Table.Cell>
                    <RouterAriaLink
                      to={`/teachers/${teacher.id}`}
                      className="font-semibold no-underline"
                    >
                      {teacher.name}
                    </RouterAriaLink>
                    {selected ? (
                      <span className="sr-only">
                        （当前选中，正在展示其评价）
                      </span>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-[13px] text-muted">
                      {teacher.department || "—"}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <RatingCell
                      rating={teacher.rating}
                      reviewCount={teacher.review_count}
                    />
                  </Table.Cell>
                </Table.Row>
              );
            }}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
