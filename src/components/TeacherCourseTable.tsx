/**
 * Courses taught by a teacher — dense fold aligned with CourseResultTable B.
 * Course-domain columns (not teacher-catalog isomorphic):
 *   课程 (name + category Chip · code) · 院系
 * Whole row + course name → course detail; real links (keyboard / new-tab safe).
 * Issue #62 · module 11 · docs/ui/foundations.md §详情体验.
 */
import { Chip, Table } from "@heroui/react";
import type { ReactNode } from "react";
import { categoryLabel } from "../lib/labels";
import type { Course } from "../lib/types";
import { RatingCell } from "./RatingCell";
import { RouterAriaLink } from "./RouterAriaLink";

export type TeacherCourseTableProps = {
  items: Course[];
  /** Preserved query string when linking to course detail, e.g. location.search */
  search?: string;
  className?: string;
};

function CourseNameLink({
  course,
  search = "",
  children,
  className,
}: {
  course: Course;
  search?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RouterAriaLink to={`/courses/${course.id}${search}`} className={className}>
      {children}
    </RouterAriaLink>
  );
}

export function TeacherCourseTable({
  items,
  search = "",
  className,
}: TeacherCourseTableProps) {
  return (
    <Table className={className ? `dense-table ${className}` : "dense-table"}>
      <Table.ScrollContainer>
        <Table.Content aria-label="任课课程" className="min-w-[440px]">
          <Table.Header>
            <Table.Column isRowHeader>课程</Table.Column>
            <Table.Column>院系</Table.Column>
            <Table.Column>评分 / 投稿</Table.Column>
          </Table.Header>
          <Table.Body
            items={items}
            /* Row hrefs embed the catalog query; dependencies keep them fresh
             * under client-side row navigation. */
            dependencies={[search]}
            renderEmptyState={() => (
              <div className="py-8 text-center text-muted" role="status">
                暂无任课课程
              </div>
            )}
          >
            {(course) => (
              <Table.Row
                id={String(course.id)}
                key={course.id}
                href={`/courses/${course.id}${search}`}
                className="cursor-pointer"
              >
                <Table.Cell>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <CourseNameLink
                        course={course}
                        search={search}
                        className="font-semibold no-underline"
                      >
                        {course.name}
                      </CourseNameLink>
                      <Chip size="sm" variant="soft" className="w-fit shrink-0">
                        <Chip.Label>
                          {categoryLabel(course.category)}
                        </Chip.Label>
                      </Chip>
                    </div>
                    <span className="tabular text-[calc(12/15*1rem)] text-muted">
                      {course.code || "课号未标注"}
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <span className="text-[calc(13/15*1rem)] text-muted">
                    {course.department || "—"}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <RatingCell
                    rating={course.rating}
                    reviewCount={course.review_count}
                  />
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
