import { Alert, Skeleton, Spinner, Surface, Table } from "@heroui/react";

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

/** Official Spinner + muted copy for in-page waits (Issue #244). */
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

/** First-paint placeholder that matches 摘要 B + the official dense table. */
export const DETAIL_SKELETON_ROWS = 12;

export type DetailSkeletonKind = "course" | "course-reviews" | "teacher";

export function DetailPageSkeleton({
  label,
  kind,
}: {
  label: string;
  kind: DetailSkeletonKind;
}) {
  const teacher = kind === "teacher";
  const reviews = kind === "course-reviews";
  return (
    <div role="status" aria-label={label} aria-live="polite">
      <span className="sr-only">{label}</span>
      <header className="mb-6" aria-hidden>
        <Skeleton className="mb-1 h-8 w-28 rounded" />
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-border pb-5">
          <div className="min-w-0 flex-1 basis-72 space-y-2">
            {teacher ? null : <Skeleton className="h-5 w-16 rounded-full" />}
            <Skeleton className="h-8 w-3/5 rounded" />
            <Skeleton className="h-4 w-2/5 rounded" />
            {teacher ? <Skeleton className="h-4 w-24 rounded" /> : null}
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
      {reviews ? (
        <section className="mb-6" aria-hidden>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <Skeleton className="h-5 w-12 rounded" />
            <Skeleton className="h-3 w-8 rounded" />
          </div>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="border-b border-separator py-4">
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="mt-2 h-4 w-5/6 rounded" />
              <Skeleton className="mt-2 h-4 w-2/3 rounded" />
            </div>
          ))}
        </section>
      ) : (
        <section className="mb-6" aria-hidden>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <Skeleton className="h-5 w-20 rounded" />
            <Skeleton className="h-3 w-8 rounded" />
          </div>
          {teacher ? null : <Skeleton className="mb-2 h-4 w-3/4 rounded" />}
          <Table className="dense-table">
            <Table.ScrollContainer>
              <Table.Content
                aria-label={teacher ? "任课课程" : "任课教师"}
                className="min-w-[440px]"
              >
                <Table.Header>
                  <Table.Column isRowHeader>
                    {teacher ? "课程" : "教师"}
                  </Table.Column>
                  <Table.Column>院系</Table.Column>
                  <Table.Column>评分 / 投稿</Table.Column>
                </Table.Header>
                <Table.Body>
                  {Array.from({ length: DETAIL_SKELETON_ROWS }).map(
                    (_, index) => (
                      <Table.Row
                        key={index}
                        id={`detail-skeleton-${index}`}
                        data-detail-skeleton-row=""
                      >
                        <Table.Cell>
                          {teacher ? (
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <Skeleton className="h-4 w-3/4 rounded" />
                              <Skeleton className="h-3 w-1/3 rounded" />
                            </div>
                          ) : (
                            <Skeleton className="h-4 w-24 rounded" />
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <Skeleton className="h-4 w-20 rounded" />
                        </Table.Cell>
                        <Table.Cell>
                          <Skeleton className="h-4 w-16 rounded" />
                        </Table.Cell>
                      </Table.Row>
                    ),
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </section>
      )}
    </div>
  );
}
