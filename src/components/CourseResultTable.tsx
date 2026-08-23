/**
 * Course catalog result table — visually frozen: prototype B (dense fold).
 *
 * Four columns: 课程 (name + category Chip · code) · 教师 · 院系 · 投稿.
 * Whole row → course detail; course name + teacher names are real links
 * (keyboard / new-tab safe). Teacher names go to that course×teacher
 * review page (`/courses/:id?teacher=`). Teacher pairs come from
 * `teacher_refs`.
 * The teacher cell is a single line clipped with an ellipsis so row heights
 * stay consistent; only the first few names are mounted as links, and the
 * full teacher list lives on the course detail page (Issue #155). Search
 * hits stay among those visible names. Ratings bind to 教师×课程 and are
 * never shown on course rows (Issue #140); the last column carries the
 * public review count only.
 *
 * Intent (not implemented): unfiltered high-density scan could use a
 * seven-column layout (prototype A); production ships B only this batch.
 */
import { Chip, Table } from "@heroui/react";
import { Fragment } from "react";
import {
  HighlightSearchTerms,
  highlightTermsFromSearch,
} from "../lib/catalog-search-highlight";
import {
  previewCatalogTeachers,
  teacherNameMatchesTerms,
} from "../lib/catalog-teacher-preview";
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

function teacherReviewHref(courseId: number, teacherId: number, search: string) {
  const sp = new URLSearchParams(search);
  sp.set("teacher", String(teacherId));
  const q = sp.toString();
  return `/courses/${courseId}${q ? `?${q}` : ""}`;
}

function TeacherLinks({
  course,
  search,
  highlightTerms,
}: {
  course: Course;
  search: string;
  highlightTerms: string[];
}) {
  const teachers = parseTeachers(course);

  if (teachers.length === 0) {
    return <span className="text-muted">待补充</span>;
  }

  const { visible, hiddenCount } = previewCatalogTeachers(teachers, {
    isPriority: highlightTerms.length
      ? (teacher) => teacherNameMatchesTerms(teacher.name, highlightTerms)
      : undefined,
  });

  // max-w-lg caps the cell's intrinsic max-content, so auto table layout
  // keeps the column bounded (no horizontal table scroll) and other columns
  // keep their natural width; text-overflow then renders the ellipsis.
  // p-1 + -m-1 expands the overflow clip box by 4px without shifting layout,
  // so the links' focus ring/outline is not clipped by overflow-hidden.
  return (
    <span className="-m-1 block max-w-lg min-w-0 overflow-hidden p-1 text-ellipsis whitespace-nowrap">
      {visible.map((t, i) => (
        <Fragment key={t.id != null ? `${t.id}-${t.name}` : `${t.name}-${i}`}>
          {i > 0 ? " " : null}
          {t.id != null ? (
            <RouterAriaLink
              to={teacherReviewHref(course.id, t.id, search)}
              className="text-sm"
              aria-label={highlightTerms.length ? t.name : undefined}
            >
              <HighlightSearchTerms text={t.name} terms={highlightTerms} />
            </RouterAriaLink>
          ) : (
            <span>
              <HighlightSearchTerms text={t.name} terms={highlightTerms} />
            </span>
          )}
        </Fragment>
      ))}
      {hiddenCount > 0 ? (
        <span className="text-muted">{` 等${hiddenCount}人`}</span>
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
  const highlightTerms = highlightTermsFromSearch(search);

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
            /* Row hrefs embed the catalog query; dependencies keep them fresh
             * under client-side row navigation. */
            dependencies={[search]}
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
                        aria-label={
                          highlightTerms.length ? course.name : undefined
                        }
                      >
                        <HighlightSearchTerms
                          text={course.name}
                          terms={highlightTerms}
                        />
                      </RouterAriaLink>
                      <Chip size="sm" variant="soft" className="w-fit shrink-0">
                        <Chip.Label>
                          {categoryLabel(course.category)}
                        </Chip.Label>
                      </Chip>
                    </div>
                    <span className="tabular text-[calc(12/15*1rem)] text-muted">
                      <HighlightSearchTerms
                        text={course.code}
                        terms={highlightTerms}
                      />
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <TeacherLinks
                    course={course}
                    search={search}
                    highlightTerms={highlightTerms}
                  />
                </Table.Cell>
                <Table.Cell>
                  <span className="whitespace-nowrap text-[calc(13/15*1rem)] text-muted">
                    {course.department ? (
                      <HighlightSearchTerms
                        text={course.department}
                        terms={highlightTerms}
                      />
                    ) : (
                      "—"
                    )}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  {course.review_count > 0 ? (
                    <span className="whitespace-nowrap tabular text-[calc(13/15*1rem)]">
                      <span className="font-semibold">{course.review_count}</span>
                      <span className="text-[calc(12/15*1rem)] text-muted">{" "}投</span>
                    </span>
                  ) : (
                    <span className="text-[calc(13/15*1rem)] text-muted">暂无</span>
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
