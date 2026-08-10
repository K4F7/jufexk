/**
 * PROTOTYPE — catalog-states variants (throwaway; not production-ready).
 *
 * Question: 分页与页面状态如何与表格共存？
 *
 * 已冻结：search C · filters D · course-table B。本模块只改：
 *   首次加载 / 刷新加载 / 错误 / 筛选空 / 真·无数据 / 分页条。
 * 官方优先：Pagination · Skeleton · Spinner · Alert · Button · Chip。
 *
 * A — 精简页脚 — **视觉冻结胜出** → 生产 `CatalogResultsStates`
 * B — 完整分页：Pagination 页码 + Summary 范围；Skeleton 表骨架；Alert 错误 + 重试
 * C — 底栏状态条：分页与状态同条 sticky；表上半透明刷新层；空态居中操作区
 *
 * 演示：顶部「强制状态」可一键看 loading / error / empty（不改真实 API）。
 * Mounted via CoursesPage when ?module=catalog-states&variant=A|B|C (DEV only).
 */
import {
  Alert,
  Button,
  Chip,
  Pagination,
  Skeleton,
  Spinner,
} from "@heroui/react";
import { useState, type ReactNode } from "react";
import { CourseResultTable } from "../components/CourseResultTable";
import type { Course } from "../lib/types";

export type CatalogStatesVariantKey = "A" | "B" | "C";

const KEYS: CatalogStatesVariantKey[] = ["A", "B", "C"];

export function isCatalogStatesVariantKey(
  key: string,
): key is CatalogStatesVariantKey {
  return (KEYS as string[]).includes(key);
}

export type CatalogStatesModel = {
  items: Course[];
  search: string;
  /** URL search keyword (for empty copy) */
  emptyQuery?: string;
  loading: boolean;
  /** True once first successful payload arrived (even if items empty) */
  hasPayload: boolean;
  error: string;
  currentPage: number;
  totalPages: number;
  total: number;
  pageSize: number;
  hasFilters: boolean;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onClearFilters: () => void;
};

export type CatalogStatesProps = {
  variant: CatalogStatesVariantKey;
  model: CatalogStatesModel;
};

type ForceState = "auto" | "loading" | "error" | "empty" | "ready";

const FORCE_OPTIONS: { id: ForceState; label: string }[] = [
  { id: "auto", label: "真实" },
  { id: "loading", label: "加载" },
  { id: "error", label: "错误" },
  { id: "empty", label: "空结果" },
  { id: "ready", label: "有数据" },
];

const VARIANT_HINT: Record<
  CatalogStatesVariantKey,
  { title: string; lookFor: string }
> = {
  A: {
    title: "A — 精简页脚",
    lookFor:
      "只有「上一页 / 页码 / 下一页」；刷新是一行小 Spinner；空/错是虚线框",
  },
  B: {
    title: "B — 完整分页 + 骨架",
    lookFor:
      "HeroUI Pagination 页码与范围 Summary；首次加载是表骨架；错误是 Alert+重试",
  },
  C: {
    title: "C — 底栏状态条",
    lookFor:
      "分页与状态挤在底部 sticky 条；刷新时表格半透明遮罩；空态居中大按钮",
  },
};

function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "…")[] = [1];
  if (current > 3) pages.push("…");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}

function rangeText(page: number, pageSize: number, total: number) {
  if (total <= 0) return "共 0 门";
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return `第 ${start}–${end} 门，共 ${total} 门`;
}

function VariantBanner({ variant }: { variant: CatalogStatesVariantKey }) {
  const hint = VARIANT_HINT[variant];
  return (
    <div
      className="mb-3 rounded-xl border-2 border-dashed border-accent/50 bg-accent/10 px-3 py-2"
      role="status"
      data-prototype-states-variant={variant}
    >
      <div className="text-sm font-semibold text-accent">
        原型比较区 · 只改分页与加载/错误/空状态
      </div>
      <div className="mt-0.5 text-sm font-medium text-foreground">
        {hint.title}
      </div>
      <div className="mt-0.5 text-xs text-muted">
        上方搜索 / 筛选 / 结果表结构已冻结。请看：{hint.lookFor}
      </div>
    </div>
  );
}

function ForceToolbar({
  force,
  onForce,
}: {
  force: ForceState;
  onForce: (next: ForceState) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2">
      <span className="text-xs font-medium text-muted">强制状态（演示）</span>
      {FORCE_OPTIONS.map((opt) => (
        <Button
          key={opt.id}
          size="sm"
          variant={force === opt.id ? "secondary" : "ghost"}
          onPress={() => onForce(opt.id)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="rounded-xl border border-border p-3"
      role="status"
      aria-label="加载中"
    >
      <div className="mb-3 grid grid-cols-4 gap-3">
        <Skeleton className="h-3 w-16 rounded" />
        <Skeleton className="h-3 w-12 rounded" />
        <Skeleton className="h-3 w-14 rounded" />
        <Skeleton className="h-3 w-20 rounded" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid grid-cols-4 items-center gap-3">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-3/4 rounded" />
              <Skeleton className="h-2.5 w-1/3 rounded" />
            </div>
            <Skeleton className="h-3 w-1/2 rounded" />
            <Skeleton className="h-3 w-2/3 rounded" />
            <Skeleton className="h-3 w-1/3 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyPanel({
  hasFilters,
  emptyQuery,
  onClearFilters,
  emphasis,
}: {
  hasFilters: boolean;
  emptyQuery?: string;
  onClearFilters: () => void;
  emphasis: "box" | "center";
}) {
  const title = hasFilters
    ? emptyQuery
      ? `没有找到匹配「${emptyQuery}」的课程`
      : "没有符合筛选条件的课程"
    : "目录暂无课程数据";
  const desc = hasFilters
    ? "试试调整关键词、类别或教师筛选。"
    : "请稍后再来，或联系维护者导入公开目录。";

  if (emphasis === "center") {
    return (
      <div
        className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface-secondary px-6 py-12 text-center"
        role="status"
      >
        <Chip size="sm" variant="soft">
          <Chip.Label>{hasFilters ? "无匹配" : "空目录"}</Chip.Label>
        </Chip>
        <div className="text-base font-semibold text-foreground">{title}</div>
        <p className="m-0 max-w-md text-sm text-muted">{desc}</p>
        {hasFilters ? (
          <Button size="sm" variant="secondary" onPress={onClearFilters}>
            清除筛选
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="rounded border border-dashed border-border px-7 py-7 text-center text-muted"
      role="status"
    >
      <div className="font-medium text-foreground">{title}</div>
      <p className="mt-1 mb-3 text-sm">{desc}</p>
      {hasFilters ? (
        <Button size="sm" variant="outline" onPress={onClearFilters}>
          清除筛选
        </Button>
      ) : null}
    </div>
  );
}

function ErrorPanel({
  message,
  onRetry,
  style,
}: {
  message: string;
  onRetry: () => void;
  style: "box" | "alert";
}) {
  if (style === "alert") {
    return (
      <Alert status="danger" className="mb-2">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>课程目录加载失败</Alert.Title>
          <Alert.Description>{message}</Alert.Description>
        </Alert.Content>
        <Button size="sm" variant="danger" onPress={onRetry}>
          重试
        </Button>
      </Alert>
    );
  }

  return (
    <div
      className="rounded border border-dashed border-danger/40 px-7 py-7 text-center"
      role="alert"
    >
      <div className="font-medium text-foreground">课程目录加载失败</div>
      <p className="mt-1 mb-3 text-sm text-muted">{message}</p>
      <Button size="sm" variant="outline" onPress={onRetry}>
        重试
      </Button>
    </div>
  );
}

function PaginationA({
  model,
  disabled,
}: {
  model: CatalogStatesModel;
  disabled?: boolean;
}) {
  const { currentPage, totalPages, total, onPageChange } = model;
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
        {currentPage}/{Math.max(totalPages, 1)}
        <span className="ms-2 text-xs">· 共 {total} 门</span>
      </span>
      <Button
        size="sm"
        variant="outline"
        isDisabled={disabled || currentPage >= totalPages}
        onPress={() => onPageChange(currentPage + 1)}
      >
        下一页
      </Button>
    </div>
  );
}

function PaginationB({
  model,
  disabled,
}: {
  model: CatalogStatesModel;
  disabled?: boolean;
}) {
  const {
    currentPage,
    totalPages,
    total,
    pageSize,
    onPageChange,
  } = model;
  const pages = pageWindow(currentPage, Math.max(totalPages, 1));

  return (
    <Pagination className="mt-3 w-full" size="sm">
      <Pagination.Summary>
        {rangeText(currentPage, pageSize, total)}
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
        {pages.map((p, i) =>
          p === "…" ? (
            <Pagination.Item key={`e-${i}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={p}>
              <Pagination.Link
                isActive={p === currentPage}
                isDisabled={disabled}
                onPress={() => onPageChange(p)}
              >
                {p}
              </Pagination.Link>
            </Pagination.Item>
          ),
        )}
        <Pagination.Item>
          <Pagination.Next
            isDisabled={disabled || currentPage >= totalPages}
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

function PaginationC({
  model,
  statusSlot,
  disabled,
}: {
  model: CatalogStatesModel;
  statusSlot?: ReactNode;
  disabled?: boolean;
}) {
  const { currentPage, totalPages, total, pageSize, onPageChange } = model;
  return (
    <div className="sticky bottom-16 z-10 mt-3 rounded-full border border-border bg-overlay/95 px-3 py-2 shadow-overlay backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-muted">
          {rangeText(currentPage, pageSize, total)}
        </div>
        <div className="flex items-center gap-1">
          {statusSlot}
          <Button
            size="sm"
            variant="ghost"
            isDisabled={disabled || currentPage <= 1}
            onPress={() => onPageChange(currentPage - 1)}
          >
            上一页
          </Button>
          <span className="min-w-12 text-center text-xs font-medium tabular">
            {currentPage}/{Math.max(totalPages, 1)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={disabled || currentPage >= totalPages}
            onPress={() => onPageChange(currentPage + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}

type ResolvedView =
  | { kind: "loading-first" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; refreshing: boolean };

function resolveView(
  force: ForceState,
  model: CatalogStatesModel,
): ResolvedView {
  if (force === "loading") return { kind: "loading-first" };
  if (force === "error")
    return { kind: "error", message: "（演示）无法连接课程目录接口" };
  if (force === "empty") return { kind: "empty" };
  if (force === "ready") return { kind: "ready", refreshing: false };

  // auto — real state
  if (model.error && !model.hasPayload)
    return { kind: "error", message: model.error };
  if (model.loading && !model.hasPayload) return { kind: "loading-first" };
  if (model.hasPayload && model.items.length === 0) return { kind: "empty" };
  if (model.hasPayload)
    return { kind: "ready", refreshing: model.loading };
  if (model.error) return { kind: "error", message: model.error };
  return { kind: "loading-first" };
}

function VariantA({
  model,
  view,
  onRetry,
}: {
  model: CatalogStatesModel;
  view: ResolvedView;
  onRetry: () => void;
}) {
  if (view.kind === "loading-first") {
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
  if (view.kind === "error") {
    return (
      <ErrorPanel message={view.message} onRetry={onRetry} style="box" />
    );
  }
  if (view.kind === "empty") {
    return (
      <EmptyPanel
        hasFilters={model.hasFilters}
        emptyQuery={model.emptyQuery}
        onClearFilters={model.onClearFilters}
        emphasis="box"
      />
    );
  }

  return (
    <div aria-busy={view.refreshing}>
      {view.refreshing ? (
        <div
          className="mb-2 flex items-center gap-2 text-sm text-muted"
          role="status"
          aria-live="polite"
        >
          <Spinner size="sm" />
          正在更新课程目录…
        </div>
      ) : null}
      <CourseResultTable
        items={model.items}
        search={model.search}
        emptyQuery={model.emptyQuery}
      />
      <PaginationA model={model} disabled={view.refreshing} />
    </div>
  );
}

function VariantB({
  model,
  view,
  onRetry,
}: {
  model: CatalogStatesModel;
  view: ResolvedView;
  onRetry: () => void;
}) {
  if (view.kind === "loading-first") {
    return <TableSkeleton />;
  }
  if (view.kind === "error") {
    return (
      <ErrorPanel message={view.message} onRetry={onRetry} style="alert" />
    );
  }
  if (view.kind === "empty") {
    return (
      <EmptyPanel
        hasFilters={model.hasFilters}
        emptyQuery={model.emptyQuery}
        onClearFilters={model.onClearFilters}
        emphasis="center"
      />
    );
  }

  return (
    <div aria-busy={view.refreshing}>
      {view.refreshing ? (
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 z-[1] rounded-xl bg-background/40" />
          <CourseResultTable
            items={model.items}
            search={model.search}
            emptyQuery={model.emptyQuery}
          />
        </div>
      ) : (
        <CourseResultTable
          items={model.items}
          search={model.search}
          emptyQuery={model.emptyQuery}
        />
      )}
      <PaginationB model={model} disabled={view.refreshing} />
    </div>
  );
}

function VariantC({
  model,
  view,
  onRetry,
}: {
  model: CatalogStatesModel;
  view: ResolvedView;
  onRetry: () => void;
}) {
  if (view.kind === "loading-first") {
    return (
      <>
        <TableSkeleton rows={4} />
        <PaginationC
          model={model}
          disabled
          statusSlot={
            <Chip size="sm" variant="soft">
              <Spinner size="sm" />
              <Chip.Label>加载中</Chip.Label>
            </Chip>
          }
        />
      </>
    );
  }
  if (view.kind === "error") {
    return (
      <>
        <ErrorPanel message={view.message} onRetry={onRetry} style="alert" />
        <PaginationC
          model={model}
          disabled
          statusSlot={
            <Chip size="sm" color="danger" variant="soft">
              <Chip.Label>失败</Chip.Label>
            </Chip>
          }
        />
      </>
    );
  }
  if (view.kind === "empty") {
    return (
      <>
        <EmptyPanel
          hasFilters={model.hasFilters}
          emptyQuery={model.emptyQuery}
          onClearFilters={model.onClearFilters}
          emphasis="center"
        />
        <PaginationC
          model={model}
          disabled
          statusSlot={
            <Chip size="sm" variant="soft">
              <Chip.Label>无结果</Chip.Label>
            </Chip>
          }
        />
      </>
    );
  }

  return (
    <div aria-busy={view.refreshing}>
      <div className="relative">
        {view.refreshing ? (
          <div className="pointer-events-none absolute inset-0 z-[1] flex items-start justify-center rounded-xl bg-background/35 pt-8">
            <Chip size="sm" variant="secondary">
              <Spinner size="sm" />
              <Chip.Label>更新中</Chip.Label>
            </Chip>
          </div>
        ) : null}
        <CourseResultTable
          items={model.items}
          search={model.search}
          emptyQuery={model.emptyQuery}
        />
      </div>
      <PaginationC
        model={model}
        disabled={view.refreshing}
        statusSlot={
          view.refreshing ? (
            <Chip size="sm" variant="soft">
              <Spinner size="sm" />
              <Chip.Label>更新</Chip.Label>
            </Chip>
          ) : (
            <Chip size="sm" color="success" variant="soft">
              <Chip.Label>就绪</Chip.Label>
            </Chip>
          )
        }
      />
    </div>
  );
}

export function CatalogStatesPrototype({
  variant,
  model,
}: CatalogStatesProps) {
  const [force, setForce] = useState<ForceState>("auto");
  const view = resolveView(force, model);

  function handleRetry() {
    setForce("auto");
    model.onRetry();
  }

  let body: ReactNode;
  switch (variant) {
    case "B":
      body = <VariantB model={model} view={view} onRetry={handleRetry} />;
      break;
    case "C":
      body = <VariantC model={model} view={view} onRetry={handleRetry} />;
      break;
    case "A":
    default:
      body = <VariantA model={model} view={view} onRetry={handleRetry} />;
      break;
  }

  return (
    <div data-prototype-module="catalog-states" data-variant={variant}>
      <VariantBanner variant={variant} />
      <ForceToolbar force={force} onForce={setForce} />
      {body}
    </div>
  );
}
