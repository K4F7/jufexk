/**
 * Teacher catalog result table — adapted from course-table B (dense fold).
 *
 * Four columns (teacher domain, not course isomorphic):
 *   教师 (name + title) · 院系 · 评分/投稿 · 课程数
 * Whole row → teacher detail; name is a real link.
 */
import { Link, Table } from "@heroui/react";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { scoreText } from "../lib/labels";
import type { Teacher } from "../lib/types";

export type TeacherResultTableProps = {
  items: Teacher[];
  /** Preserved catalog query string, e.g. location.search including `?` */
  search: string;
  className?: string;
};

function mergeStopPropagation(
  onClick?: (e: React.MouseEvent) => void,
): (e: React.MouseEvent) => void {
  return (e) => {
    e.stopPropagation();
    onClick?.(e);
  };
}

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
  const to = `/teachers/${teacher.id}${search}`;
  return (
    <Link
      href={to}
      className={className}
      render={(domProps) => (
        <RouterLink
          {...(domProps as object)}
          to={to}
          className={
            typeof domProps.className === "string"
              ? domProps.className
              : undefined
          }
          onClick={mergeStopPropagation(
            (domProps as { onClick?: (ev: React.MouseEvent) => void }).onClick,
          )}
        />
      )}
    >
      {children}
    </Link>
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
            <Table.Column>评分 / 投稿</Table.Column>
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
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap tabular">
                    <span className="font-semibold text-accent">
                      {scoreText(teacher.rating)}
                    </span>
                    <span className="text-[12px] text-muted">
                      · {teacher.review_count ?? 0} 投
                    </span>
                  </div>
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
