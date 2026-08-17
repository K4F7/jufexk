/**
 * Course catalog result table — visually frozen: prototype B (dense fold).
 *
 * Four columns: 课程 (name + category Chip · code) · 教师 · 院系 · 投稿.
 * Whole row → course detail; course name + teacher names are real links
 * (keyboard / new-tab safe). Teacher pairs come from `teacher_refs`.
 * The teacher cell clamps to one line so row heights stay consistent; when
 * the names overflow, an inline 展开/折叠 Button (aria-expanded) reveals the
 * full list. Ratings bind to 教师×课程 and are never shown on course rows
 * (Issue #140); the last column carries the public review count only.
 *
 * Intent (not implemented): unfiltered high-density scan could use a
 * seven-column layout (prototype A); production ships B only this batch.
 */
import { Button, Chip, Table } from "@heroui/react";
import { useEffect, useId, useRef, useState } from "react";
import { categoryLabel } from "../lib/labels";
import type { Course } from "../lib/types";
import { RouterAriaLink } from "./RouterAriaLink";

export type CourseResultTableProps = {
  items: Course[];
  /** Preserved catalog query string, e.g. location.search including `?` */
  search: string;
  /** Active search keyword for empty-state copy */
  emptyQuery?: string;
  className?: string;
};

type TeacherRef = { id: number | null; name: string };

function parseTeachers(course: Course): TeacherRef[] {
  const refs = (course.teacher_refs || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (refs.length > 0) {
    return refs.map((ref) => {
      const colon = ref.indexOf(":");
      if (colon <= 0) return { id: null, name: ref };
      const id = Number(ref.slice(0, colon));
      const name = ref.slice(colon + 1);
      return {
        name: name || ref,
        id: Number.isFinite(id) && id > 0 ? id : null,
      };
    });
  }

  return (course.teachers || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ id: null, name }));
}

function TeacherLinks({ course }: { course: Course }) {
  const teachers = parseTeachers(course);
  const listId = useId();
  const listRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  /** Leading teachers fully visible on the clamped line; null until measured */
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  const overflowing = visibleCount != null && visibleCount < teachers.length;

  useEffect(() => {
    if (expanded) return;
    const el = listRef.current;
    if (!el) return;
    const check = () => {
      const limit = el.getBoundingClientRect().right;
      let n = 0;
      for (const child of Array.from(el.children)) {
        if (child.getBoundingClientRect().right <= limit + 1) n++;
        else break;
      }
      setVisibleCount(n);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, teachers.length]);

  if (teachers.length === 0) {
    return <span className="text-muted">待补充</span>;
  }

  return (
    <span
      className={`flex min-w-0 gap-1.5 ${expanded ? "items-start" : "items-center"}`}
    >
      <span
        ref={listRef}
        id={listId}
        className={
          expanded
            ? "inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5"
            : "inline-flex min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden"
        }
      >
        {teachers.map((t, i) => {
          // Clipped names leave the tab order; keyboard users reveal them
          // via the 展开 toggle instead of tabbing onto invisible links.
          const clipped =
            !expanded && visibleCount != null && i >= visibleCount;
          return t.id != null ? (
            <RouterAriaLink
              key={`${t.id}-${t.name}`}
              to={`/teachers/${t.id}`}
              className="text-sm"
              tabIndex={clipped ? -1 : undefined}
            >
              {t.name}
            </RouterAriaLink>
          ) : (
            <span key={`${t.name}-${i}`}>{t.name}</span>
          );
        })}
      </span>
      {overflowing || expanded ? (
        <span
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls={listId}
            onPress={() => setExpanded((v) => !v)}
          >
            {expanded ? "折叠" : "展开"}
          </Button>
        </span>
      ) : null}
    </span>
  );
}

export function CourseResultTable({
  items,
  search,
  emptyQuery,
  className,
}: CourseResultTableProps) {
  return (
    <Table className={className ? `dense-table ${className}` : "dense-table"}>
      <Table.ScrollContainer>
        <Table.Content aria-label="课程目录" className="min-w-[720px]">
          <Table.Header>
            <Table.Column isRowHeader>课程</Table.Column>
            <Table.Column>教师</Table.Column>
            <Table.Column>院系</Table.Column>
            <Table.Column>投稿</Table.Column>
          </Table.Header>
          <Table.Body
            items={items}
            renderEmptyState={() => (
              <div className="py-8 text-center text-muted" role="status">
                {emptyQuery
                  ? `没有找到匹配“${emptyQuery}”的课程`
                  : "没有课程数据"}
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
                      <RouterAriaLink
                        to={`/courses/${course.id}${search}`}
                        className="font-semibold no-underline"
                      >
                        {course.name}
                      </RouterAriaLink>
                      <Chip size="sm" variant="soft" className="w-fit shrink-0">
                        <Chip.Label>
                          {categoryLabel(course.category)}
                        </Chip.Label>
                      </Chip>
                    </div>
                    <span className="tabular text-[12px] text-muted">
                      {course.code}
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <TeacherLinks course={course} />
                </Table.Cell>
                <Table.Cell>
                  <span className="whitespace-nowrap text-[13px] text-muted">
                    {course.department || "—"}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  {course.review_count > 0 ? (
                    <span className="whitespace-nowrap tabular text-[13px]">
                      <span className="font-semibold">{course.review_count}</span>
                      <span className="ms-1 text-[12px] text-muted">投</span>
                    </span>
                  ) : (
                    <span className="text-[13px] text-muted">暂无</span>
                  )}
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
