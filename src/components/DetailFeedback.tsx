import { Alert, Skeleton, Spinner, Surface } from "@heroui/react";

/** Official danger Alert for page / review-feed failures (Issue #244). */
export function DetailErrorAlert({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Alert role="alert" status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** Official Spinner + muted copy for first-load waits (Issue #244). */
export function DetailLoadingStatus({ label }: { label: string }) {
  return (
    <p
      aria-label={label}
      aria-live="polite"
      className="m-0 flex items-center gap-2 text-sm text-muted"
      role="status"
    >
      <Spinner color="current" size="sm" />
      {label}
    </p>
  );
}

/** First-paint placeholder that matches 摘要 B + a dense table so the
 * footer does not jump when the real detail page lands. */
export const DETAIL_SKELETON_ROWS = 12;

export function DetailPageSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-live="polite"
      className="min-h-[calc(100dvh-6.5rem)]"
    >
      <span className="sr-only">{label}</span>
      <header className="mb-6" aria-hidden>
        <Skeleton className="mb-1 h-8 w-28 rounded" />
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-border pb-5">
          <div className="min-w-0 flex-1 basis-72 space-y-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-8 w-3/5 rounded" />
            <Skeleton className="h-4 w-2/5 rounded" />
          </div>
          <Surface
            variant="secondary"
            className="flex h-[88px] w-full shrink-0 flex-col items-center justify-center rounded-xl px-8 py-5 sm:w-36"
          >
            <Skeleton className="h-8 w-12 rounded" />
            <Skeleton className="mt-2 h-3 w-10 rounded" />
          </Surface>
        </div>
      </header>
      <section className="mb-6" aria-hidden>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <Skeleton className="h-5 w-20 rounded" />
          <Skeleton className="h-3 w-8 rounded" />
        </div>
        <Skeleton className="mb-2 h-4 w-3/4 rounded" />
        <div className="flex items-center gap-4 border-b border-separator py-2.5">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-3 w-20 rounded" />
        </div>
        {Array.from({ length: DETAIL_SKELETON_ROWS }).map((_, index) => (
          <div
            key={index}
            data-detail-skeleton-row=""
            className="flex items-center gap-4 border-b border-separator py-2.5"
          >
            <Skeleton className="h-4 w-1/4 rounded" />
            <Skeleton className="h-4 w-1/6 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
          </div>
        ))}
      </section>
    </div>
  );
}
