/**
 * Catalog pagination + load/error/empty.
 *
 * - First load: 20 skeleton rows + pagination reserve, matching the public
 *   catalog pageSize so the list height does not jump (Issue #205). Course
 *   pending uses CourseRelationRow-shaped Skeleton rows (Issue #418).
 * - Refresh with data: compact Spinner line above the results
 * - Error: official Alert + 重试
 * - Empty: official Card; search-miss vs true empty catalog
 * - Pagination: official Pagination + 共 N {unit}
 *
 * Entity-specific wording via `copy`.
 */
import {
  Alert,
  Button,
  Card,
  Pagination,
  Skeleton,
  Spinner,
} from "@heroui/react";
import type { ReactNode } from "react";
import { REVIEW_DIMENSIONS } from "../lib/review-dimensions";

export type CatalogResultsCopy = {
  /** e.g. 课程目录加载失败 */
  errorTitle: string;
  /** e.g. 正在更新课程目录… */
  refreshingLabel: string;
  /** Search-miss title; receives the active query when present */
  emptyFilteredTitle: (query?: string) => string;
  emptyFilteredDesc: string;
  emptyCatalogTitle: string;
  emptyCatalogDesc: string;
  /** Button on search-miss empty — 清空搜索 */
  clearLabel: string;
  /** Pagination unit after total — 条 / 门 / 位 */
  totalUnit: string;
};

export const COURSE_CATALOG_COPY: CatalogResultsCopy = {
  errorTitle: "课程目录加载失败",
  refreshingLabel: "正在更新课程目录…",
  emptyFilteredTitle: (query) =>
    query ? `没有找到匹配「${query}」的课程` : "没有找到匹配的课程",
  emptyFilteredDesc: "试试换个关键词。",
  emptyCatalogTitle: "目录暂无课程数据",
  emptyCatalogDesc: "目录还在整理，请稍后再来看看。",
  clearLabel: "清空搜索",
  totalUnit: "门",
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
  currentPage: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  children: ReactNode;
  copy?: CatalogResultsCopy;
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
          className="block border-b border-separator py-3 last:border-b-0 max-sm:py-2.5"
        >
          <Skeleton className="h-4 w-56 max-w-[70%] rounded" />
          <div className="mt-1 flex flex-wrap items-center gap-x-2">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-0.5 max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3">
            {REVIEW_DIMENSIONS.map((dim) => (
              <Skeleton key={dim.key} className="h-3 w-20 rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** First-load placeholder + pagination so row/footer height matches
 * the loaded catalog (Issue #205). */
function CatalogSkeleton({
  rowCount,
  totalUnit,
}: {
  rowCount: number;
  totalUnit: string;
}) {
  return (
    <div role="status" aria-label="加载中…">
      <span className="sr-only">加载中…</span>
      <CourseRelationSkeletonRows rowCount={rowCount} />
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
  onClearFilters,
  copy,
}: {
  hasFilters: boolean;
  emptyQuery?: string;
  onClearFilters: () => void;
  copy: CatalogResultsCopy;
}) {
  const title = hasFilters
    ? copy.emptyFilteredTitle(emptyQuery)
    : copy.emptyCatalogTitle;
  const desc = hasFilters ? copy.emptyFilteredDesc : copy.emptyCatalogDesc;

  return (
    <Card role="status">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <Card.Description>{desc}</Card.Description>
      </Card.Header>
      {hasFilters ? (
        <Card.Footer className="flex-wrap gap-2">
          <Button size="sm" variant="secondary" onPress={onClearFilters}>
            {copy.clearLabel}
          </Button>
        </Card.Footer>
      ) : null}
    </Card>
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

/** Phone: first / current / last + ellipsis so the cluster stays compact. */
function catalogPageNumbersCompact(current: number, totalPages: number) {
  const pages: Array<number | "ellipsis"> = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }
  const start = Math.max(2, current - (current === totalPages ? 1 : 0));
  const end = Math.min(totalPages - 1, current + (current === 1 ? 1 : 0));
  pages.push(1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push("ellipsis");
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
  const selectedPage = Math.min(Math.max(currentPage, 1), pages);
  return (
    <Pagination
      aria-label="分页"
      className="mt-3 w-full max-sm:flex-row! max-sm:flex-nowrap max-sm:items-center max-sm:justify-between"
      size="sm"
    >
      <Pagination.Summary className="max-sm:w-auto max-sm:shrink-0">
        共 {total} {totalUnit}
      </Pagination.Summary>
      <Pagination.Content className="max-sm:w-auto max-sm:shrink-0 sm:hidden">
        <Pagination.Item>
          <Pagination.Previous
            isDisabled={disabled || selectedPage <= 1}
            onPress={() => onPageChange(Math.max(1, selectedPage - 1))}
          >
            <Pagination.PreviousIcon />
            <span className="sr-only">上一页</span>
          </Pagination.Previous>
        </Pagination.Item>
        {catalogPageNumbersCompact(selectedPage, pages).map((page, index) =>
          page === "ellipsis" ? (
            <Pagination.Item key={`ellipsis-${index}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={page}>
              <Pagination.Link
                isActive={page === selectedPage}
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
            isDisabled={disabled || selectedPage >= pages}
            onPress={() => onPageChange(Math.min(pages, selectedPage + 1))}
          >
            <span className="sr-only">下一页</span>
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
      <Pagination.Content className="max-sm:hidden">
        <Pagination.Item>
          <Pagination.Previous
            isDisabled={disabled || selectedPage <= 1}
            onPress={() => onPageChange(Math.max(1, selectedPage - 1))}
          >
            <Pagination.PreviousIcon />
            <span>上一页</span>
          </Pagination.Previous>
        </Pagination.Item>
        {catalogPageNumbers(selectedPage, pages).map((page, index) =>
          page === "ellipsis" ? (
            <Pagination.Item key={`ellipsis-${index}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={page}>
              <Pagination.Link
                isActive={page === selectedPage}
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
            isDisabled={disabled || selectedPage >= pages}
            onPress={() => onPageChange(Math.min(pages, selectedPage + 1))}
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
  currentPage,
  totalPages,
  total,
  onPageChange,
  onRetry,
  onClearFilters,
  children,
  copy = COURSE_CATALOG_COPY,
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
        onClearFilters={onClearFilters}
        copy={copy}
      />
    );
  }

  if (!hasPayload) {
    return (
      <CatalogSkeleton
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
