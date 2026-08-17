/**
 * Teacher catalog result table — adapted from course-table B (dense fold).
 *
 * Four columns (teacher domain, not course isomorphic):
 *   教师 (name + title) · 院系 · 投稿 · 课程数
 * Whole row → teacher detail; name is a real link.
 * Ratings bind to 教师×课程 and are never shown on teacher rows
 * (Issue #153); the 投稿 column carries the public review count only.
 */
import { Table } from "@heroui/react";
import type { ReactNode } from "react";
import type { Teacher } from "../lib/types";
import { RouterAriaLink } from "./RouterAriaLink";

export type TeacherResultTableProps = {
  items: Teacher[];
  /** Preserved catalog query string, e.g. location.search including `?` */
  search: string;
  className?: string;
};

function TeacherNameLink({
  teacher,
  search,
  children,
  className,
}: {
  teacher: Teacher;
  search: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RouterAriaLink to={`/teachers/${teacher.id}${search}`} className={className}>
      {children}
    </RouterAriaLink>
  );
}

export function TeacherResultTable({
  items,
  search,
  className,
}: TeacherResultTableProps) {
  return (
    <Table className={className ? `dense-table ${className}` : "dense-table"}>
      <Table.ScrollContainer>
        <Table.Content aria-label="教师资料" className="min-w-[640px]">
          <Table.Header>
            <Table.Column isRowHeader>教师</Table.Column>
            <Table.Column>院系</Table.Column>
            <Table.Column>投稿</Table.Column>
            <Table.Column>课程数</Table.Column>
          </Table.Header>
          <Table.Body
            items={items}
            renderEmptyState={() => (
              <div className="py-8 text-center text-muted" role="status">
                暂无教师资料
              </div>
            )}
          >
            {(teacher) => (
              <Table.Row
                id={String(teacher.id)}
                key={teacher.id}
                href={`/teachers/${teacher.id}${search}`}
                className="cursor-pointer"
              >
                <Table.Cell>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <TeacherNameLink
                      teacher={teacher}
                      search={search}
                      className="font-semibold no-underline"
                    >
                      {teacher.name}
                    </TeacherNameLink>
                    <span className="text-[12px] text-muted">
                      {teacher.title || "职称待补充"}
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <span className="text-[13px] text-muted">
                    {teacher.department || "—"}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  {(teacher.review_count ?? 0) > 0 ? (
                    <span className="whitespace-nowrap tabular text-[13px]">
                      <span className="font-semibold">
                        {teacher.review_count}
                      </span>
                      <span className="text-[12px] text-muted">{" "}投</span>
                    </span>
                  ) : (
                    <span className="text-[13px] text-muted">暂无</span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <span className="tabular font-semibold text-accent">
                    {teacher.course_count ?? 0}
                  </span>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
