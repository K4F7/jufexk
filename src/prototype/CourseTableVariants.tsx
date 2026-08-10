/**
 * PROTOTYPE — course-table variants (throwaway; not production-ready).
 *
 * Question: 结果表的列密度与行内链接语义？
 *
 * 已冻结：catalog-search C · catalog-filters D（本模块只改「结果列表」这一块）。
 * 官方优先：HeroUI Table / Card / Chip / Link。
 *
 * A — 七列工作台：完整表格，每字段一列（意向：无筛选粗浏览）
 * B — 课程优先折叠高密度 — **视觉冻结胜出** → 生产 `CourseResultTable`
 * C — 卡片列表：不用 Table，每门课一张 Card
 *
 * Mounted via CoursesPage when ?module=course-table&variant=A|B|C (DEV only).
 */
import { Card, Chip, Link, Table } from "@heroui/react";
import type { ReactNode } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { categoryLabel, scoreText } from "../lib/labels";
import type { Course } from "../lib/types";

export type CourseTableVariantKey = "A" | "B" | "C";

const KEYS: CourseTableVariantKey[] = ["A", "B", "C"];

export function isCourseTableVariantKey(
  key: string,
): key is CourseTableVariantKey {
  return (KEYS as string[]).includes(key);
}

export type CourseTableProps = {
  variant: CourseTableVariantKey;
  items: Course[];
  emptyQuery?: string;
  /** Optional footer (pagination) kept outside the table */
  footer?: ReactNode;
};

type TeacherRef = { id: number | null; name: string };

const VARIANT_HINT: Record<
  CourseTableVariantKey,
  { title: string; lookFor: string }
> = {
  A: {
    title: "A — 七列工作台",
    lookFor: "表头应有 7 列：课号 · 课程 · 类别 · 教师 · 院系 · 评分 · 投稿",
  },
  B: {
    title: "B — 课程优先折叠（高密度）",
    lookFor:
      "仍是 4 列；课程格改成单行紧凑：课名 + Chip，课号次行；评分/投稿合并且行高接近 A",
  },
  C: {
    title: "C — 卡片列表",
    lookFor: "没有表格线，每门课是一张 Card；左侧课名，右侧大号评分与投稿数",
  },
};

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

/** Keep nested links from also triggering Table.Row navigation. */
function mergeStopPropagation(
  onClick?: (e: React.MouseEvent) => void,
): (e: React.MouseEvent) => void {
  return (e) => {
    e.stopPropagation();
    onClick?.(e);
  };
}

function TeacherLinks({ course }: { course: Course }) {
  const teachers = parseTeachers(course);
  if (teachers.length === 0) {
    return <span className="text-muted">待补充</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {teachers.map((t, i) =>
        t.id != null ? (
          <Link
            key={`${t.id}-${t.name}`}
            href={`/teachers/${t.id}`}
            className="text-sm"
            render={(domProps) => (
              <RouterLink
                {...(domProps as object)}
                to={`/teachers/${t.id}`}
                className={
                  typeof domProps.className === "string"
                    ? domProps.className
                    : undefined
                }
                onClick={mergeStopPropagation(
                  (domProps as { onClick?: (ev: React.MouseEvent) => void })
                    .onClick,
                )}
              />
            )}
          >
            {t.name}
          </Link>
        ) : (
          <span key={`${t.name}-${i}`}>{t.name}</span>
        ),
      )}
    </span>
  );
}

function CourseNameLink({
  course,
  search,
  children,
  className,
}: {
  course: Course;
  search: string;
  children: ReactNode;
  className?: string;
}) {
  const to = `/courses/${course.id}${search}`;
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

function emptyState(emptyQuery?: string) {
  return (
    <div className="py-8 text-center text-muted" role="status">
      {emptyQuery
        ? `没有找到匹配“${emptyQuery}”的课程`
        : "没有课程数据"}
    </div>
  );
}

function VariantBanner({ variant }: { variant: CourseTableVariantKey }) {
  const hint = VARIANT_HINT[variant];
  return (
    <div
      className="mb-3 rounded-xl border-2 border-dashed border-accent/50 bg-accent/10 px-3 py-2"
      role="status"
      data-prototype-table-variant={variant}
    >
      <div className="text-sm font-semibold text-accent">
        原型比较区 · 只改下面这一块结果列表
      </div>
      <div className="mt-0.5 text-sm font-medium text-foreground">
        {hint.title}
      </div>
      <div className="mt-0.5 text-xs text-muted">
        上方搜索 / 筛选已冻结，切换时不会动。请看：{hint.lookFor}
      </div>
    </div>
  );
}

function VariantA({
  items,
  emptyQuery,
  search,
}: {
  items: Course[];
  emptyQuery?: string;
  search: string;
}) {
  return (
    <Table className="dense-table">
      <Table.ScrollContainer>
        <Table.Content aria-label="课程目录（七列工作台）" className="min-w-[900px]">
          <Table.Header>
            <Table.Column isRowHeader>课号</Table.Column>
            <Table.Column>课程</Table.Column>
            <Table.Column>类别</Table.Column>
            <Table.Column>教师</Table.Column>
            <Table.Column>院系</Table.Column>
            <Table.Column>评分</Table.Column>
            <Table.Column>投稿</Table.Column>
          </Table.Header>
          <Table.Body
            items={items}
            renderEmptyState={() => emptyState(emptyQuery)}
          >
            {(course) => (
              <Table.Row
                id={String(course.id)}
                key={course.id}
                href={`/courses/${course.id}${search}`}
                className="cursor-pointer"
              >
                <Table.Cell>
                  <span className="tabular text-[13px] text-muted">
                    {course.code}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <CourseNameLink
                    course={course}
                    search={search}
                    className="font-semibold no-underline"
                  >
                    {course.name}
                  </CourseNameLink>
                </Table.Cell>
                <Table.Cell>
                  <span className="text-[13px] text-muted">
                    {categoryLabel(course.category)}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <TeacherLinks course={course} />
                </Table.Cell>
                <Table.Cell>
                  <span className="text-muted">
                    {course.department || "—"}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <span className="tabular font-semibold text-accent">
                    {scoreText(course.rating)}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <span className="tabular font-semibold text-accent">
                    {course.review_count}
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

function VariantB({
  items,
  emptyQuery,
  search,
}: {
  items: Course[];
  emptyQuery?: string;
  search: string;
}) {
  return (
    <Table className="dense-table">
      <Table.ScrollContainer>
        <Table.Content
          aria-label="课程目录（课程优先折叠·高密度）"
          className="min-w-[720px]"
        >
          <Table.Header>
            <Table.Column isRowHeader>课程</Table.Column>
            <Table.Column>教师</Table.Column>
            <Table.Column>院系</Table.Column>
            <Table.Column>评分 / 投稿</Table.Column>
          </Table.Header>
          <Table.Body
            items={items}
            renderEmptyState={() => emptyState(emptyQuery)}
          >
            {(course) => (
              <Table.Row
                id={String(course.id)}
                key={course.id}
                href={`/courses/${course.id}${search}`}
                className="cursor-pointer"
              >
                <Table.Cell>
                  {/* 两行：主行课名+类别，次行课号 — 比三行堆叠更密 */}
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
                    <span className="tabular text-[12px] text-muted">
                      {course.code}
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <TeacherLinks course={course} />
                </Table.Cell>
                <Table.Cell>
                  <span className="text-[13px] text-muted">
                    {course.department || "—"}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex items-baseline gap-1.5 tabular whitespace-nowrap">
                    <span className="font-semibold text-accent">
                      {scoreText(course.rating)}
                    </span>
                    <span className="text-[12px] text-muted">
                      · {course.review_count} 投
                    </span>
                  </div>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function VariantC({
  items,
  emptyQuery,
  search,
}: {
  items: Course[];
  emptyQuery?: string;
  search: string;
}) {
  if (items.length === 0) {
    return emptyState(emptyQuery);
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="课程目录（卡片列表）">
      {items.map((course) => {
        const to = `/courses/${course.id}${search}`;
        return (
          <li key={course.id}>
            <Card className="w-full" variant="secondary">
              <Card.Header className="flex flex-row items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Chip size="sm" variant="soft">
                      <Chip.Label>{categoryLabel(course.category)}</Chip.Label>
                    </Chip>
                    <span className="tabular text-xs text-muted">
                      {course.code}
                    </span>
                  </div>
                  <Card.Title className="text-base">
                    <CourseNameLink
                      course={course}
                      search={search}
                      className="no-underline"
                    >
                      {course.name}
                    </CourseNameLink>
                  </Card.Title>
                  <Card.Description className="mt-1">
                    <span className="text-muted">
                      {course.department || "院系待补充"}
                    </span>
                    <span className="mx-1.5 text-muted">·</span>
                    <TeacherLinks course={course} />
                  </Card.Description>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  <div className="tabular text-2xl font-bold leading-none text-accent">
                    {scoreText(course.rating)}
                  </div>
                  <div className="text-xs text-muted">评分</div>
                  <div className="mt-1 tabular text-sm font-semibold">
                    {course.review_count}
                    <span className="ms-1 font-normal text-muted">投稿</span>
                  </div>
                </div>
              </Card.Header>
              <Card.Footer className="justify-end">
                <Link
                  href={to}
                  className="text-sm"
                  render={(domProps) => (
                    <RouterLink
                      {...(domProps as object)}
                      to={to}
                      className={
                        typeof domProps.className === "string"
                          ? domProps.className
                          : undefined
                      }
                    />
                  )}
                >
                  查看课程
                  <Link.Icon />
                </Link>
              </Card.Footer>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export function CourseTablePrototype({
  variant,
  items,
  emptyQuery,
  footer,
}: CourseTableProps) {
  const location = useLocation();
  const search = location.search;

  let table: ReactNode;
  switch (variant) {
    case "B":
      table = (
        <VariantB items={items} emptyQuery={emptyQuery} search={search} />
      );
      break;
    case "C":
      table = (
        <VariantC items={items} emptyQuery={emptyQuery} search={search} />
      );
      break;
    case "A":
    default:
      table = (
        <VariantA items={items} emptyQuery={emptyQuery} search={search} />
      );
      break;
  }

  return (
    <div data-prototype-module="course-table" data-variant={variant}>
      <VariantBanner variant={variant} />
      {table}
      {footer}
    </div>
  );
}
