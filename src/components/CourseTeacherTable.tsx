/**
 * Teachers of a course — two-column Card grid (Issue #221).
 * The main card link toggles `?teacher=` on the course page (评价按 课程×教师
 * 展示，再次点击已选卡片取消选择). Teacher detail is a sibling「教师主页」
 * link so the card stays a single selection target without nested anchors
 * (keyboard / new-tab safe). Empty department / rating / review count are
 * omitted so the grid is not filled with "—" / "暂无".
 * docs/ui/foundations.md §详情体验.
 */
import { Avatar, Card, Chip } from "@heroui/react";
import { scoreText } from "../lib/labels";
import type { Teacher } from "../lib/types";
import { RouterAriaLink } from "./RouterAriaLink";

export type CourseTeacherTableProps = {
  items: Teacher[];
  /** Owning course id — card hrefs toggle the teacher selection on it. */
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

function TeacherCardStats({ teacher }: { teacher: Teacher }) {
  const count = teacher.review_count ?? 0;
  const rated = hasRating(teacher.rating);
  if (!rated && count <= 0) return null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {rated ? (
        <span className="tabular font-semibold text-accent">
          {scoreText(teacher.rating)}
        </span>
      ) : null}
      {count > 0 ? (
        <Chip size="sm" variant="soft">
          <Chip.Label>{count} 投</Chip.Label>
        </Chip>
      ) : null}
    </div>
  );
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
        const selectLabel = selected
          ? `取消选择${teacher.name}（当前选中，正在展示其评价）`
          : `查看${teacher.name}的评价`;
        return (
          <li key={teacher.id} className="min-w-0">
            <Card
              variant={selected ? "secondary" : "default"}
              className="h-full flex-row items-center gap-3"
            >
              <RouterAriaLink
                to={selectHref}
                className="flex min-w-0 flex-1 items-center gap-3 no-underline text-foreground"
                aria-current={selected ? "true" : undefined}
                aria-label={selectLabel}
              >
                <Avatar
                  size="sm"
                  color={selected ? "accent" : "default"}
                  variant="soft"
                >
                  <Avatar.Fallback>{initial}</Avatar.Fallback>
                </Avatar>
                <Card.Header className="min-w-0 flex-1 gap-0.5 p-0">
                  <Card.Title className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
                    {teacher.name}
                    {selected ? (
                      <Chip size="sm" color="accent" variant="soft">
                        <Chip.Label>查看中</Chip.Label>
                      </Chip>
                    ) : null}
                  </Card.Title>
                  {teacher.department ? (
                    <Card.Description className="truncate">
                      {teacher.department}
                    </Card.Description>
                  ) : null}
                </Card.Header>
                <TeacherCardStats teacher={teacher} />
              </RouterAriaLink>
              <RouterAriaLink
                to={`/teachers/${teacher.id}`}
                className="shrink-0 text-[12px]"
                aria-label={`${teacher.name}的教师主页`}
              >
                教师主页
              </RouterAriaLink>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
