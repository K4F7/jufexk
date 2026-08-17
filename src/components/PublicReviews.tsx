import { Button, Separator, Spinner } from "@heroui/react";
import { useEndorsementViewer } from "../hooks/useEndorsementViewer";
import { isEndorsableReview } from "../lib/recognition";
import type { PublicReview } from "../lib/types";
import { EmptyBox } from "./EmptyBox";
import { ReviewRecognitionControl } from "./ReviewRecognitionControl";
import { RouterAriaLink } from "./RouterAriaLink";

export function PublicReviews({
  rows,
  identity,
  total,
  hasMore,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
}: {
  rows: PublicReview[];
  identity: "teacher" | "course";
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError: string;
  onLoadMore: () => void;
}) {
  const { viewer, ready, clear } = useEndorsementViewer();
  return (
    <section className="mb-2" aria-labelledby={`${identity}-reviews-heading`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id={`${identity}-reviews-heading`}
          className="m-0 text-[17px] font-bold leading-snug"
        >
          评价
        </h2>
        {total ? (
          <span className="text-[13px] text-muted">{total} 条</span>
        ) : null}
      </div>
      {rows.length ? (
        <div role="list" aria-label="评价列表" aria-busy={isLoadingMore}>
          {rows.map((review, index) => {
            const counterpart = identity === "course" ? review.course_name : review.teacher_name;
            const href =
              identity === "course"
                ? `/courses/${review.course_id}`
                : `/teachers/${review.teacher_id}`;
            return (
              <div key={review.id} role="listitem">
                {index > 0 ? <Separator /> : null}
                <article className="py-4">
                  <p className="m-0 min-w-0 text-sm font-semibold">
                    <RouterAriaLink className="break-words" to={href}>
                      {counterpart ||
                        (identity === "course" ? "课程未标注" : "教师未标注")}
                      {identity === "course" && review.course_code
                        ? `（${review.course_code}）`
                        : null}
                    </RouterAriaLink>
                  </p>
                  <p className="mb-0 mt-1.5 break-words text-sm leading-relaxed">
                    {review.comment}
                  </p>
                  {isEndorsableReview(review) ? (
                    <ReviewRecognitionControl
                      review={review}
                      ready={ready}
                      authenticated={viewer.authenticated}
                      loginPath={viewer.loginPath}
                      onUnauthenticated={clear}
                    />
                  ) : null}
                </article>
              </div>
            );
          })}
          {hasMore ? (
            <div className="flex justify-center border-t border-border pt-4">
              <Button variant="secondary" isPending={isLoadingMore} onPress={onLoadMore}>
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner color="current" size="sm" /> : null}
                    {isPending ? "加载中…" : "继续加载"}
                  </>
                )}
              </Button>
            </div>
          ) : null}
          {loadMoreError ? (
            <p className="mb-0 mt-3 text-center text-sm text-danger" role="alert">
              {loadMoreError}
            </p>
          ) : null}
          <span className="sr-only" aria-live="polite">
            {isLoadingMore ? "正在加载更多评价" : `已显示 ${rows.length} 条评价`}
          </span>
        </div>
      ) : (
        <EmptyBox>暂无评价</EmptyBox>
      )}
    </section>
  );
}
