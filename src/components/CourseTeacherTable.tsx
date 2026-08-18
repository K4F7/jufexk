/**
 * Teachers of a course — two-column Card grid (Issue #223, after #221).
 * Official Card anatomy: Header (Avatar + Title + Description) and Footer
 * Links (查看评价 toggles `?teacher=`; 教师主页 + Link.Icon goes to the
 * teacher page). Empty department / rating / review count are omitted.
 * docs/ui/foundations.md §详情体验.
 */
import { Avatar, Card, Chip, Link } from "@heroui/react";
import { scoreText } from "../lib/labels";
import type { Teacher } from "../lib/types";
import { RouterAriaLink } from "./RouterAriaLink";

export type CourseTeacherTableProps = {
  items: Teacher[];
  /** Owning course id — Footer hrefs toggle the teacher selection on it. */
  courseId: number;
  /** Current query string (location.search, with or without `?`); catalog
   * state is preserved while the `teacher` selection param is toggled. */
  search: string;
  /** Currently selected teacher id (null = none). */
  selectedId: number | null;
  className?: string;
};

function hasRating(rating?: number | null): boolean {
  return rating != null && Number(rating) > 0;
}

export function CourseTeacherTable({
  items,
  courseId,
  search,
  selectedId,
  className,
}: CourseTeacherTableProps) {
  const hrefFor = (teacherId: number) => {
    const sp = new URLSearchParams(search);
    if (teacherId === selectedId) sp.delete("teacher");
    else sp.set("teacher", String(teacherId));
    const q = sp.toString();
    return `/courses/${courseId}${q ? `?${q}` : ""}`;
  };

  if (!items.length) {
    return (
      <div className="py-8 text-center text-muted" role="status">
        教师待补充
      </div>
    );
  }

  const gridClass = "m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2";

  return (
    <ul
      className={className ? `${gridClass} ${className}` : gridClass}
      aria-label="任课教师"
    >
      {items.map((teacher) => {
        const selected = teacher.id === selectedId;
        const selectHref = hrefFor(teacher.id);
        const initial = teacher.name.trim().slice(0, 1) || "?";
        const count = teacher.review_count ?? 0;
        const rated = hasRating(teacher.rating);
        const selectLabel = selected
          ? `取消选择${teacher.name}（当前选中，正在展示其评价）`
          : `查看${teacher.name}的评价`;
        return (
          <li key={teacher.id} className="min-w-0">
            <Card
              variant={selected ? "secondary" : "default"}
              className="h-full"
            >
              <Card.Header>
                <Avatar
                  size="sm"
                  color={selected ? "accent" : "default"}
                  variant="soft"
                >
                  <Avatar.Fallback>{initial}</Avatar.Fallback>
                </Avatar>
                <Card.Title>{teacher.name}</Card.Title>
                {teacher.department ? (
                  <Card.Description>{teacher.department}</Card.Description>
                ) : null}
              </Card.Header>
              <Card.Footer>
                {selected ? (
                  <Chip size="sm" color="accent" variant="soft">
                    <Chip.Label>查看中</Chip.Label>
                  </Chip>
                ) : null}
                {rated ? (
                  <Chip size="sm" color="accent" variant="soft">
                    <Chip.Label>{scoreText(teacher.rating)}</Chip.Label>
                  </Chip>
                ) : null}
                {count > 0 ? (
                  <Chip size="sm" variant="soft">
                    <Chip.Label>{count} 投</Chip.Label>
                  </Chip>
                ) : null}
                <RouterAriaLink
                  to={selectHref}
                  aria-current={selected ? "true" : undefined}
                  aria-label={selectLabel}
                >
                  {selected ? "取消选择" : "查看评价"}
                </RouterAriaLink>
                <RouterAriaLink
                  to={`/teachers/${teacher.id}`}
                  aria-label={`${teacher.name}的教师主页`}
                >
                  教师主页
                  <Link.Icon />
                </RouterAriaLink>
              </Card.Footer>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
