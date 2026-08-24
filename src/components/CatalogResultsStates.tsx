/**
 * Catalog pagination + load/error/empty.
 *
 * - First load: 20 skeleton rows + pagination reserve, matching the public
 *   catalog pageSize so the list height does not jump (Issue #205). Course
 *   pending uses CourseRelationRow-shaped Skeleton rows (Issue #418); teacher
 *   pending still matches TeacherResultTable.
 * - Refresh with data: compact Spinner line above the results
 * - Error: official Alert + 重试
 * - Empty: official Card; distinct copy for filters vs true empty catalog
 * - Pagination: official Pagination + 共 N {unit}
 *
 * Entity-specific wording via `copy` (courses vs teachers).
 */
import {
  Alert,
  Button,
  Card,
  Link,
  Pagination,
  Skeleton,
  Spinner,
  Table,
} from "@heroui/react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { REVIEW_DIMENSIONS } from "../lib/review-dimensions";

export type CatalogResultsCopy = {
  /** e.g. 课程目录加载失败 */
  errorTitle: string;
  /** e.g. 正在更新课程目录… */
  refreshingLabel: string;
  /** Filtered empty title; receives active query when present */
  emptyFilteredTitle: (query?: string) => string;
  emptyFilteredDesc: string;
  emptyCatalogTitle: string;
  emptyCatalogDesc: string;
  /** Button on filtered empty — 清空筛选 / 清空搜索 */
  clearLabel: string;
  /** Pagination unit after total — 门 / 位 */
  totalUnit: string;
};

export const COURSE_CATALOG_COPY: CatalogResultsCopy = {
  errorTitle: "课程目录加载失败",
  refreshingLabel: "正在更新课程目录…",
  emptyFilteredTitle: (query) =>
    query
      ? `没有找到匹配「${query}」的课程`
      : "没有符合筛选条件的课程",
  emptyFilteredDesc: "试试调整关键词、类别或教师筛选。",
  emptyCatalogTitle: "目录暂无课程数据",
  emptyCatalogDesc: "目录还在整理，请稍后再来看看。",
  // 与筛选工具条按钮同文案（Issue #276）。
  clearLabel: "清空筛选",
  totalUnit: "门",
};

export const TEACHER_CATALOG_COPY: CatalogResultsCopy = {
  errorTitle: "教师资料加载失败",
  refreshingLabel: "正在更新教师资料…",
  emptyFilteredTitle: (query) =>
    query
      ? `没有找到匹配「${query}」的教师`
      : "没有符合搜索条件的教师",
  emptyFilteredDesc: "试试调整姓名或院系关键词。",
  emptyCatalogTitle: "暂无教师资料",
  emptyCatalogDesc: "目录还在整理，请稍后再来看看。",
  clearLabel: "清空搜索",
  totalUnit: "位",
};

export type CatalogResultsStatesProps = {
  loading: boolean;
  /** True after first successful payload (items may still be empty). */
  hasPayload: boolean;
  error: string;
  itemCount: number;
  hasFilters: boolean;
  /** Active search keyword for empty-state copy */
  emptyQuery?: string;
  /** Labels of every active filter (keyword/category/department/teacher) so
   *  the filtered empty state names them all instead of only the keyword
   *  (Issue #276). */
  emptyFilters?: string[];
  currentPage: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  children: ReactNode;
  copy?: CatalogResultsCopy;
  /** Opposite-catalog hint when this catalog is empty (Issue #287). */
  rescue?: ReactNode;
  /** First-load chrome: course = relation list; teacher = result table. */
  skeleton?: "course" | "teacher";
};

/** Matches the public catalog default `pageSize` so first-load height
 * lines up with a full result page (desktop CLS). */
export const CATALOG_SKELETON_ROWS = 20;

/** Course first-load: HeroUI Skeleton stacked like CourseRelationRow
 * (课名（老师） / 星级+评价 / 四维), not the retired 课程/教师/院系/投稿 table. */
function CourseRelationSkeletonRows({ rowCount }: { rowCount: number }) {
  return (
    <div>
      {Array.from({ length: rowCount }).map((_, index) => (
        <div
          key={index}
          id={`catalog-skeleton-${index}`}
          data-catalog-skeleton-row=""
          className="block border-b border-separator py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-56 max-w-[70%] rounded" />
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-0.5">
            {REVIEW_DIMENSIONS.map((dim) => (
              <Skeleton key={dim.key} className="h-3 w-20 rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Teacher first-load still matches TeacherResultTable chrome. */
function TeacherTableSkeleton({ rowCount }: { rowCount: number }) {
  return (
    <Table className="dense-table">
      <Table.ScrollContainer>
        <Table.Content aria-label="教师资料" className="min-w-[640px]">
          <Table.Header>
            <Table.Column isRowHeader>教师</Table.Column>
            <Table.Column>院系</Table.Column>
            <Table.Column>投稿</Table.Column>
            <Table.Column>课程数</Table.Column>
          </Table.Header>
          <Table.Body>
            {Array.from({ length: rowCount }).map((_, index) => (
              <Table.Row
                key={index}
                id={`catalog-skeleton-${index}`}
                data-catalog-skeleton-row=""
              >
                <Table.Cell>
                  <Skeleton className="h-4 w-24 rounded" />
                </Table.Cell>
                <Table.Cell>
                  <Skeleton className="h-4 w-28 rounded" />
                </Table.Cell>
                <Table.Cell>
                  <Skeleton className="h-4 w-10 rounded" />
                </Table.Cell>
                <Table.Cell>
                  <Skeleton className="h-4 w-10 rounded" />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

/** First-load placeholder + pagination so row/footer height matches
 * the loaded catalog (Issue #205). */
function CatalogSkeleton({
  variant,
  rowCount,
  totalUnit,
}: {
  variant: "course" | "teacher";
  rowCount: number;
  totalUnit: string;
}) {
  return (
    <div role="status" aria-label="加载中…">
      <span className="sr-only">加载中…</span>
      {variant === "course" ? (
        <CourseRelationSkeletonRows rowCount={rowCount} />
      ) : (
        <TeacherTableSkeleton rowCount={rowCount} />
      )}
      <PaginationFooter
        currentPage={1}
        totalPages={1}
        total={0}
        totalUnit={totalUnit}
        disabled
        onPageChange={() => {}}
      />
    </div>
  );
}

function ErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
      <Button size="sm" variant="danger" onPress={onRetry}>
        重试
      </Button>
    </Alert>
  );
}

function EmptyPanel({
  hasFilters,
  emptyQuery,
  emptyFilters,
  onClearFilters,
  copy,
  rescue,
}: {
  hasFilters: boolean;
  emptyQuery?: string;
  emptyFilters?: string[];
  onClearFilters: () => void;
  copy: CatalogResultsCopy;
  rescue?: ReactNode;
}) {
  const title = hasFilters
    ? copy.emptyFilteredTitle(emptyQuery)
    : copy.emptyCatalogTitle;
  // 叠了多个筛时空文案点名全部生效筛选，不只提关键词（Issue #276）。
  const desc = hasFilters
    ? emptyFilters?.length
      ? `试试调整或清空当前筛选：${emptyFilters.join("、")}。`
      : copy.emptyFilteredDesc
    : copy.emptyCatalogDesc;

  return (
    <Card role="status">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <Card.Description>{desc}</Card.Description>
      </Card.Header>
      {rescue || hasFilters ? (
        <Card.Footer className="flex-wrap gap-2">
          {rescue ? <p className="m-0 text-sm">{rescue}</p> : null}
          {hasFilters ? (
            <Button size="sm" variant="secondary" onPress={onClearFilters}>
              {copy.clearLabel}
            </Button>
          ) : null}
        </Card.Footer>
      ) : null}
    </Card>
  );
}

/** SPA rescue link: official Link + React Router NavLink (same as AppShell). */
export function CatalogEmptyRescueLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={to}
      render={(domProps) => (
        <NavLink
          {...(domProps as object)}
          className={
            typeof domProps.className === "string"
              ? domProps.className
              : undefined
          }
          to={to}
        />
      )}
    >
      {children}
    </Link>
  );
}

function catalogPageNumbers(current: number, totalPages: number) {
  const pages: Array<number | "ellipsis"> = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }
  pages.push(1);
  if (current > 3) pages.push("ellipsis");
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < totalPages - 2) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

function PaginationFooter({
  currentPage,
  totalPages,
  total,
  totalUnit,
  disabled,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  total: number;
  totalUnit: string;
  disabled?: boolean;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(totalPages, 1);
  return (
    <Pagination className="mt-3 w-full" size="sm">
      <Pagination.Summary>
        共 {total} {totalUnit}
      </Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous
            isDisabled={disabled || currentPage <= 1}
            onPress={() => onPageChange(currentPage - 1)}
          >
            <Pagination.PreviousIcon />
            <span>上一页</span>
          </Pagination.Previous>
        </Pagination.Item>
        {catalogPageNumbers(currentPage, pages).map((page, index) =>
          page === "ellipsis" ? (
            <Pagination.Item key={`ellipsis-${index}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={page}>
              <Pagination.Link
                isActive={page === currentPage}
                isDisabled={disabled}
                onPress={() => onPageChange(page)}
              >
                {page}
              </Pagination.Link>
            </Pagination.Item>
          ),
        )}
        <Pagination.Item>
          <Pagination.Next
            isDisabled={disabled || currentPage >= pages}
            onPress={() => onPageChange(currentPage + 1)}
          >
            <span>下一页</span>
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}

export function CatalogResultsStates({
  loading,
  hasPayload,
  error,
  itemCount,
  hasFilters,
  emptyQuery,
  emptyFilters,
  currentPage,
  totalPages,
  total,
  onPageChange,
  onRetry,
  onClearFilters,
  children,
  copy = COURSE_CATALOG_COPY,
  rescue,
  skeleton = "course",
}: CatalogResultsStatesProps) {
  if (error && !hasPayload) {
    return (
      <ErrorPanel
        title={copy.errorTitle}
        message={error}
        onRetry={onRetry}
      />
    );
  }

  if (loading && !hasPayload) {
    return (
      <CatalogSkeleton
        variant={skeleton}
        rowCount={CATALOG_SKELETON_ROWS}
        totalUnit={copy.totalUnit}
      />
    );
  }

  if (hasPayload && itemCount === 0) {
    return (
      <EmptyPanel
        hasFilters={hasFilters}
        emptyQuery={emptyQuery}
        emptyFilters={emptyFilters}
        onClearFilters={onClearFilters}
        copy={copy}
        rescue={rescue}
      />
    );
  }

  if (!hasPayload) {
    return (
      <CatalogSkeleton
        variant={skeleton}
        rowCount={CATALOG_SKELETON_ROWS}
        totalUnit={copy.totalUnit}
      />
    );
  }

  return (
    <div aria-busy={loading}>
      {loading ? (
        <div
          className="mb-2 flex items-center gap-2 text-sm text-muted"
          role="status"
          aria-live="polite"
        >
          <Spinner size="sm" />
          {copy.refreshingLabel}
        </div>
      ) : null}
      {error ? (
        <Alert className="mb-2" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>更新失败</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="danger" onPress={onRetry}>
            重试
          </Button>
        </Alert>
      ) : null}
      {children}
      <PaginationFooter
        currentPage={currentPage}
        totalPages={totalPages}
        total={total}
        totalUnit={copy.totalUnit}
        disabled={loading}
        onPageChange={onPageChange}
      />
    </div>
  );
}
