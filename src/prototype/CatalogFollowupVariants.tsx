/**
 * PROTOTYPE — catalog-followup variants (throwaway; not production-ready).
 *
 * Question (issue #63): 目录后续意向里，收藏 / 本专业入口与条件密度
 * （无筛选七列 A / 有筛选四列 B）应如何与已冻结的筛选 D · 表 B 共存？
 *
 * 已冻结：search C · filters D · course-table B · states A。
 * 本模块只改：筛选条扩展位 + 行内收藏 + 结果表密度策略。
 * 官方优先：ToggleButton · Switch · Chip · Button · Table · TagGroup。
 *
 * A — 类别区下 Toggle 扩展位 + 固定四列：收藏/本专业 ToggleButton；表始终 B
 * B — 独立收藏工具行 + 固定七列：Switch/Chip/清空；表始终 A 粗浏览
 * C — 条件密度：无筛选七列 A、有筛选（含仅收藏/本专业）四列 B；Tag 清单管理收藏
 *
 * 状态纯内存；本专业为 stub（category=major 近似，见横幅）。
 * Mounted via CoursesPage when ?module=catalog-followup&variant=A|B|C (DEV only).
 */
import {
  Button,
  Chip,
  Link,
  Switch,
  Table,
  Tag,
  TagGroup,
  ToggleButton,
} from "@heroui/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import {
  CatalogResultsStates,
  COURSE_CATALOG_COPY,
} from "../components/CatalogResultsStates";
import { CatalogFilters } from "../components/CatalogFilters";
import { categoryLabel, scoreText } from "../lib/labels";
import type { Course, Teacher } from "../lib/types";

export type CatalogFollowupVariantKey = "A" | "B" | "C";

const KEYS: CatalogFollowupVariantKey[] = ["A", "B", "C"];

export function isCatalogFollowupVariantKey(
  key: string,
): key is CatalogFollowupVariantKey {
  return (KEYS as string[]).includes(key);
}

export type CatalogFollowupModel = {
  items: Course[];
  emptyQuery?: string;
  /** API-level load / error / pagination (frozen states A). */
  loading: boolean;
  hasPayload: boolean;
  error: string;
  currentPage: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  queryDraft: string;
  category: string;
  departmentDraft: string;
  teacherQueryDraft: string;
  teacherId: string;
  teachers: Teacher[];
  teacherLoading: boolean;
  teacherError: string;
  teacherQuery: string;
  hasFilters: boolean;
  onCategoryChange: (value: string) => void;
  onDepartmentDraftChange: (value: string) => void;
  onTeacherQueryDraftChange: (value: string) => void;
  onTeacherIdChange: (value: string) => void;
  onClear: () => void;
};

export type CatalogFollowupProps = {
  variant: CatalogFollowupVariantKey;
  model: CatalogFollowupModel;
};

type TeacherRef = { id: number | null; name: string };

const VARIANT_HINT: Record<
  CatalogFollowupVariantKey,
  { title: string; lookFor: string }
> = {
  A: {
    title: "A — 扩展位 Toggle + 固定四列",
    lookFor:
      "筛选下方「仅收藏 / 本专业」ToggleButton；行首星标；表始终四列折叠 B",
  },
  B: {
    title: "B — 独立收藏工具行 + 固定七列",
    lookFor:
      "筛选下整行工具：收藏数 Chip · 仅收藏 Switch · 本专业 · 清空；表始终七列",
  },
  C: {
    title: "C — 条件密度 + Tag 收藏清单",
    lookFor:
      "无筛选→七列 A；有筛选/仅收藏/本专业→四列 B；TagGroup 可移除已藏",
  },
};

function useSessionFavorites() {
  const [ids, setIds] = useState<Set<number>>(() => new Set());
  const seeded = useRef(false);

  const toggle = useCallback((id: number) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const remove = useCallback((id: number) => {
    setIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setIds(new Set()), []);

  /** Seed first 3 visible courses once so 「仅收藏」 can be demoed. */
  const seedFrom = useCallback((items: Course[]) => {
    if (seeded.current || items.length === 0) return;
    seeded.current = true;
    setIds(new Set(items.slice(0, 3).map((c) => c.id)));
  }, []);

  return { ids, toggle, remove, clear, count: ids.size, seedFrom };
}

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

function mergeStopPropagation(
  onClick?: (e: React.MouseEvent) => void,
): (e: React.MouseEvent) => void {
  return (e) => {
    e.stopPropagation();
    onClick?.(e);
  };
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

function emptyState(emptyQuery?: string, favoritesOnly?: boolean) {
  return (
    <div className="py-8 text-center text-muted" role="status">
      {favoritesOnly
        ? "收藏集为空：点行内星标加入几门课再开「仅收藏」"
        : emptyQuery
          ? `没有找到匹配“${emptyQuery}”的课程`
          : "没有课程数据"}
    </div>
  );
}

/**
 * v1 star look (user preferred) — HeroUI ToggleButton + outline/fill SVG.
 *
 * KNOWN BUG (handoff): favorites Set state does update (banner `favorites=N`,
 * 「仅收藏」 filter works) but this SVG does not visibly recolor when
 * `isFavorite` flips. Do NOT replace with ★ text buttons — fix paint/update
 * path while keeping this visual. See handoff doc.
 *
 * Official Controlled pattern for reference:
 * https://heroui.com/docs/react/components/toggle-button#controlled
 */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden
      className="size-3.5"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.5c.2-.5.9-.5 1.1 0l1.86 4.74a.6.6 0 0 0 .5.37l5.13.3c.54.03.76.71.35 1.06l-3.94 3.27a.6.6 0 0 0-.2.6l1.25 4.94c.13.52-.44.93-.9.65L12.3 16.8a.6.6 0 0 0-.62 0l-4.42 2.63c-.46.28-1.03-.13-.9-.65l1.25-4.94a.6.6 0 0 0-.2-.6L3.47 9.97c-.41-.35-.19-1.03.35-1.06l5.13-.3a.6.6 0 0 0 .5-.37L11.48 3.5Z"
      />
    </svg>
  );
}

function FavoriteToggle({
  courseId,
  isFavorite,
  onToggle,
}: {
  courseId: number;
  isFavorite: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <ToggleButton
      isIconOnly
      isSelected={isFavorite}
      size="sm"
      variant="ghost"
      aria-label={isFavorite ? "取消收藏" : "收藏课程"}
      onChange={() => onToggle(courseId)}
    >
      <StarIcon filled={isFavorite} />
    </ToggleButton>
  );
}

function VariantBanner({
  variant,
  stateLine,
}: {
  variant: CatalogFollowupVariantKey;
  stateLine: string;
}) {
  const hint = VARIANT_HINT[variant];
  return (
    <div
      className="mb-3 rounded-xl border-2 border-dashed border-accent/50 bg-accent/10 px-3 py-2"
      role="status"
      data-prototype-followup-variant={variant}
    >
      <div className="text-sm font-semibold text-accent">
        原型比较区 · issue #63 目录后续意向
      </div>
      <div className="mt-0.5 text-sm font-medium text-foreground">
        {hint.title}
      </div>
      <div className="mt-0.5 text-xs text-muted">请看：{hint.lookFor}</div>
      <div className="mt-1 text-xs text-muted">
        本专业 = stub（≈ 专业课 category=major）；收藏仅内存，刷新即失。
      </div>
      <div className="mt-1 font-mono text-[11px] text-foreground/80">
        state: {stateLine}
      </div>
    </div>
  );
}

function FavCell({
  courseId,
  favorites,
  onToggle,
}: {
  courseId: number;
  favorites: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    // Table.Row has href — stop bubble so star press doesn't navigate.
    // Do NOT preventDefault on pointerdown (breaks React Aria press).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="relative z-10 flex items-center"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <FavoriteToggle
        courseId={courseId}
        isFavorite={favorites.has(courseId)}
        onToggle={onToggle}
      />
    </div>
  );
}

function TableFourCol({
  items,
  emptyQuery,
  search,
  favorites,
  onToggleFavorite,
  favoritesOnly,
}: {
  items: Course[];
  emptyQuery?: string;
  search: string;
  favorites: Set<number>;
  onToggleFavorite: (id: number) => void;
  favoritesOnly?: boolean;
}) {
  return (
    <Table className="dense-table">
      <Table.ScrollContainer>
        <Table.Content
          aria-label="课程目录（四列折叠 + 收藏）"
          className="min-w-[760px]"
        >
          <Table.Header>
            <Table.Column className="w-10">
              <span className="sr-only">收藏</span>
            </Table.Column>
            <Table.Column isRowHeader>课程</Table.Column>
            <Table.Column>教师</Table.Column>
            <Table.Column>院系</Table.Column>
            <Table.Column>评分 / 投稿</Table.Column>
          </Table.Header>
          {/* React Aria caches dynamic rows by item; favorites is a render input. */}
          <Table.Body
            items={items}
            dependencies={[favorites]}
            renderEmptyState={() => emptyState(emptyQuery, favoritesOnly)}
          >
            {(course) => (
              <Table.Row
                id={String(course.id)}
                key={course.id}
                /* Prototype: no row href — star ToggleButton must not fight navigation.
                   Course name remains a real Link (same as production). */
              >
                <Table.Cell>
                  <FavCell
                    courseId={course.id}
                    favorites={favorites}
                    onToggle={onToggleFavorite}
                  />
                </Table.Cell>
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
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap tabular">
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

function TableSevenCol({
  items,
  emptyQuery,
  search,
  favorites,
  onToggleFavorite,
  favoritesOnly,
}: {
  items: Course[];
  emptyQuery?: string;
  search: string;
  favorites: Set<number>;
  onToggleFavorite: (id: number) => void;
  favoritesOnly?: boolean;
}) {
  return (
    <Table className="dense-table">
      <Table.ScrollContainer>
        <Table.Content
          aria-label="课程目录（七列工作台 + 收藏）"
          className="min-w-[960px]"
        >
          <Table.Header>
            <Table.Column className="w-10">
              <span className="sr-only">收藏</span>
            </Table.Column>
            <Table.Column isRowHeader>课号</Table.Column>
            <Table.Column>课程</Table.Column>
            <Table.Column>类别</Table.Column>
            <Table.Column>教师</Table.Column>
            <Table.Column>院系</Table.Column>
            <Table.Column>评分</Table.Column>
            <Table.Column>投稿</Table.Column>
          </Table.Header>
          {/* React Aria caches dynamic rows by item; favorites is a render input. */}
          <Table.Body
            items={items}
            dependencies={[favorites]}
            renderEmptyState={() => emptyState(emptyQuery, favoritesOnly)}
          >
            {(course) => (
              <Table.Row id={String(course.id)} key={course.id}>
                <Table.Cell>
                  <FavCell
                    courseId={course.id}
                    favorites={favorites}
                    onToggle={onToggleFavorite}
                  />
                </Table.Cell>
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

function ProductionFilters(model: CatalogFollowupModel) {
  return (
    <CatalogFilters
      queryDraft={model.queryDraft}
      category={model.category}
      departmentDraft={model.departmentDraft}
      teacherQueryDraft={model.teacherQueryDraft}
      teacherId={model.teacherId}
      teachers={model.teachers}
      teacherLoading={model.teacherLoading}
      teacherError={model.teacherError}
      teacherQuery={model.teacherQuery}
      hasFilters={model.hasFilters}
      onCategoryChange={model.onCategoryChange}
      onDepartmentDraftChange={model.onDepartmentDraftChange}
      onTeacherQueryDraftChange={model.onTeacherQueryDraftChange}
      onTeacherIdChange={model.onTeacherIdChange}
      onClear={model.onClear}
    />
  );
}

export function CatalogFollowupPrototype({
  variant,
  model,
}: CatalogFollowupProps) {
  const location = useLocation();
  const search = location.search;
  const favorites = useSessionFavorites();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [majorOnly, setMajorOnly] = useState(false);
  const seedFrom = favorites.seedFrom;

  useEffect(() => {
    seedFrom(model.items);
  }, [model.items, seedFrom]);

  const visibleItems = useMemo(() => {
    let list = model.items;
    if (favoritesOnly) {
      list = list.filter((c) => favorites.ids.has(c.id));
    }
    if (majorOnly) {
      list = list.filter((c) => c.category === "major");
    }
    return list;
  }, [model.items, favoritesOnly, majorOnly, favorites.ids]);

  const densityMode = useMemo(() => {
    if (variant === "A") return "four" as const;
    if (variant === "B") return "seven" as const;
    const hasAnyFilter = model.hasFilters || favoritesOnly || majorOnly;
    return hasAnyFilter ? ("four" as const) : ("seven" as const);
  }, [variant, model.hasFilters, favoritesOnly, majorOnly]);

  const stateLine = [
    `variant=${variant}`,
    `density=${densityMode}`,
    `favorites=${favorites.count}`,
    `favoritesOnly=${favoritesOnly}`,
    `majorOnly=${majorOnly}`,
    `visible=${visibleItems.length}/${model.items.length}`,
    `hasFilters=${model.hasFilters}`,
  ].join(" · ");

  const tableProps = {
    items: visibleItems,
    emptyQuery: model.emptyQuery,
    search,
    favorites: favorites.ids,
    onToggleFavorite: favorites.toggle,
    favoritesOnly,
  };

  const table =
    densityMode === "seven" ? (
      <TableSevenCol {...tableProps} />
    ) : (
      <TableFourCol {...tableProps} />
    );

  const favoriteTags = useMemo(() => {
    const byId = new Map(model.items.map((c) => [c.id, c]));
    return [...favorites.ids]
      .map((id) => byId.get(id))
      .filter((c): c is Course => Boolean(c));
  }, [favorites.ids, model.items]);

  return (
    <div data-prototype-module="catalog-followup" data-variant={variant}>
      <VariantBanner variant={variant} stateLine={stateLine} />

      <ProductionFilters {...model} />

      {variant === "A" ? (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
          <span className="mr-1 text-xs text-muted">快捷</span>
          <ToggleButton
            size="sm"
            isSelected={favoritesOnly}
            onChange={setFavoritesOnly}
          >
            仅收藏
            {favorites.count > 0 ? (
              <Chip size="sm" variant="soft" className="ms-1">
                <Chip.Label>{favorites.count}</Chip.Label>
              </Chip>
            ) : null}
          </ToggleButton>
          <ToggleButton
            size="sm"
            isSelected={majorOnly}
            onChange={setMajorOnly}
          >
            本专业
          </ToggleButton>
          <span className="ms-auto text-[11px] text-muted">
            扩展位：筛选区下方（生产可并入类别条 trailing）
          </span>
        </div>
      ) : null}

      {variant === "B" ? (
        <div
          className="mb-2.5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
          role="toolbar"
          aria-label="收藏与本专业"
        >
          <Chip size="sm" variant="soft">
            <Chip.Label>已收藏 {favorites.count}</Chip.Label>
          </Chip>
          <Switch
            size="sm"
            isSelected={favoritesOnly}
            onChange={setFavoritesOnly}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              仅看收藏
            </Switch.Content>
          </Switch>
          <ToggleButton
            size="sm"
            variant="ghost"
            isSelected={majorOnly}
            onChange={setMajorOnly}
          >
            本专业
          </ToggleButton>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={favorites.count === 0}
            onPress={favorites.clear}
          >
            清空收藏
          </Button>
          <span className="ms-auto text-[11px] text-muted">
            独立工具行 · 表固定七列粗扫
          </span>
        </div>
      ) : null}

      {variant === "C" ? (
        <div className="mb-2.5 grid gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <ToggleButton
              size="sm"
              isSelected={favoritesOnly}
              onChange={setFavoritesOnly}
            >
              仅收藏
            </ToggleButton>
            <ToggleButton
              size="sm"
              isSelected={majorOnly}
              onChange={setMajorOnly}
            >
              本专业
            </ToggleButton>
            <Chip size="sm" variant="soft">
              <Chip.Label>
                密度：{densityMode === "seven" ? "七列粗扫" : "四列折叠"}
              </Chip.Label>
            </Chip>
            <span className="text-[11px] text-muted">
              条件切换：无筛选→A，有筛选/收藏/本专业→B
            </span>
          </div>
          {favoriteTags.length > 0 ? (
            <TagGroup
              aria-label="已收藏课程"
              size="sm"
              onRemove={(keys) => {
                for (const key of keys) {
                  const id = Number(key);
                  if (Number.isFinite(id)) favorites.remove(id);
                }
              }}
            >
              <TagGroup.List>
                {favoriteTags.map((course) => (
                  <Tag
                    key={course.id}
                    id={String(course.id)}
                    textValue={course.name}
                  >
                    {course.name}
                  </Tag>
                ))}
              </TagGroup.List>
            </TagGroup>
          ) : (
            <p className="m-0 text-xs text-muted">
              点行内星标收藏后，这里会出现可移除的 Tag 清单。
            </p>
          )}
        </div>
      ) : null}

      <CatalogResultsStates
        loading={model.loading}
        hasPayload={model.hasPayload}
        error={model.error}
        itemCount={model.items.length}
        hasFilters={model.hasFilters || favoritesOnly || majorOnly}
        emptyQuery={model.emptyQuery}
        currentPage={model.currentPage}
        totalPages={model.totalPages}
        total={model.total}
        onPageChange={model.onPageChange}
        onRetry={model.onRetry}
        onClearFilters={() => {
          setFavoritesOnly(false);
          setMajorOnly(false);
          model.onClear();
        }}
        copy={COURSE_CATALOG_COPY}
      >
        {table}
      </CatalogResultsStates>
    </div>
  );
}
