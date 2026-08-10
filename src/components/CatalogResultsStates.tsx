/**
 * Catalog pagination + load/error/empty — visually frozen: prototype A.
 *
 * - First load: centered Spinner + copy
 * - Refresh with data: compact Spinner line above table
 * - Error: dashed box + 重试
 * - Empty: distinct copy for filters vs true empty catalog; clear action when filtered
 * - Pagination: 上一页 / current/total · 共 N {unit} / 下一页
 *
 * Entity-specific wording via `copy` (courses vs teachers).
 */
import { Button, Spinner } from "@heroui/react";
import type { ReactNode } from "react";

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
  /** Button on filtered empty — 清除筛选 / 清空搜索 */
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
  emptyCatalogDesc: "请稍后再来，或联系维护者导入公开目录。",
  clearLabel: "清除筛选",
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
  emptyCatalogDesc: "请稍后再来，或联系维护者导入公开目录。",
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
  currentPage: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  children: ReactNode;
  copy?: CatalogResultsCopy;
};

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
    <div
      className="rounded border border-dashed border-danger/40 px-7 py-7 text-center"
      role="alert"
    >
      <div className="font-medium text-foreground">{title}</div>
      <p className="mt-1 mb-3 text-sm text-muted">{message}</p>
      <Button size="sm" variant="outline" onPress={onRetry}>
        重试
      </Button>
    </div>
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
    <div
      className="rounded border border-dashed border-border px-7 py-7 text-center text-muted"
      role="status"
    >
      <div className="font-medium text-foreground">{title}</div>
      <p className="mt-1 mb-3 text-sm">{desc}</p>
      {hasFilters ? (
        <Button size="sm" variant="outline" onPress={onClearFilters}>
          {copy.clearLabel}
        </Button>
      ) : null}
    </div>
  );
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
    <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[13px] text-muted">
      <Button
        size="sm"
        variant="outline"
        isDisabled={disabled || currentPage <= 1}
        onPress={() => onPageChange(currentPage - 1)}
      >
        上一页
      </Button>
      <span aria-live="polite">
        {currentPage}/{pages}
        <span className="ms-2 text-xs">
          · 共 {total} {totalUnit}
        </span>
      </span>
      <Button
        size="sm"
        variant="outline"
        isDisabled={disabled || currentPage >= pages}
        onPress={() => onPageChange(currentPage + 1)}
      >
        下一页
      </Button>
    </div>
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
      <div
        className="flex items-center justify-center gap-2 py-10 text-sm text-muted"
        role="status"
      >
        <Spinner size="sm" />
        加载中…
      </div>
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
      <div
        className="flex items-center justify-center gap-2 py-10 text-sm text-muted"
        role="status"
      >
        <Spinner size="sm" />
        加载中…
      </div>
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
        <div
          className="mb-2 rounded border border-dashed border-danger/40 px-3 py-2 text-sm"
          role="alert"
        >
          <span className="text-foreground">更新失败：{error}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ms-2"
            onPress={onRetry}
          >
            重试
          </Button>
        </div>
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
