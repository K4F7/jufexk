/**
 * Teachers of a course — dense fold aligned with TeacherCourseTable.
 * Columns: 教师 (name) · 院系 · 评分/投稿 (per course-teacher relation).
 * Whole row + teacher name → teacher detail; real links (keyboard / new-tab safe).
 * Issue #115 · docs/ui/foundations.md §详情体验.
 */
import { Table } from "@heroui/react";
import type { Teacher } from "../lib/types";
import { RatingCell } from "./RatingCell";
import { RouterAriaLink } from "./RouterAriaLink";

export type CourseTeacherTableProps = {
  items: Teacher[];
  className?: string;
};

export function CourseTeacherTable({ items, className }: CourseTeacherTableProps) {
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
            renderEmptyState={() => (
              <div className="py-8 text-center text-muted" role="status">
                教师待补充
              </div>
            )}
          >
            {(teacher) => (
              <Table.Row
                id={String(teacher.id)}
                key={teacher.id}
                href={`/teachers/${teacher.id}`}
                className="cursor-pointer"
              >
                <Table.Cell>
                  <RouterAriaLink
                    to={`/teachers/${teacher.id}`}
                    className="font-semibold no-underline"
                  >
                    {teacher.name}
                  </RouterAriaLink>
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
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
