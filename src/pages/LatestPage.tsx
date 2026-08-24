/**
 * 最新课评 /latest：全站公开文字评价，按发表时间倒序。
 * 数据走 GET /api/reviews/latest（游标分页）。
 */
import { Button, Card, Spinner, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { ReviewAuthor } from "../components/ReviewAuthor";
import { DetailErrorAlert } from "../components/DetailFeedback";
import { ReviewNoteContent } from "../components/ReviewNoteContent";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { api } from "../lib/api";
import { formatReviewDate } from "../lib/review-date";
import { reviewAnchorId } from "../lib/review-dimensions";
import type { LatestReview, PublicReviewPage } from "../lib/types";

const MOBILE_REVIEW_QUERY = "(max-width: 639px)";

export function LatestPage() {
  const isMobileLayout = useMediaQuery(MOBILE_REVIEW_QUERY);
  const [items, setItems] = useState<LatestReview[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError("");
    api<PublicReviewPage<LatestReview>>("/api/reviews/latest", {
      signal: controller.signal,
    })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((reason) => {
        if (!cancelled) setError((reason as Error).message || "最新课评加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError("");
    try {
      const page = await api<PublicReviewPage<LatestReview>>(
        `/api/reviews/latest?cursor=${encodeURIComponent(nextCursor)}`,
      );
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setLoadMoreError((reason as Error).message || "继续加载失败");
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <section>
      <header aria-label="最新课评标题" className="mb-3">
        <Typography
          className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
          type="h1"
        >
          最新课评
        </Typography>
      </header>
      {error && items.length === 0 ? (
        <DetailErrorAlert title="最新课评加载失败" message={error} />
      ) : loading && items.length === 0 ? (
        <p className="py-10 text-center text-[calc(13/15*1rem)] text-muted" role="status">
          正在加载最新课评…
        </p>
      ) : items.length === 0 ? (
        <Card role="status">
          <Card.Header>
            <Card.Title>暂时还没有公开课评</Card.Title>
            <Card.Description>
              先到
              <RouterAriaLink to="/courses" className="text-accent">
                课程列表
              </RouterAriaLink>
              看看，或通过课程页的「写点评」分享第一门课的体验。
            </Card.Description>
          </Card.Header>
        </Card>
      ) : (
        <div>
          {items.map((review) => (
            <LatestReviewItem
              key={review.id}
              review={review}
              isMobileLayout={isMobileLayout}
            />
          ))}
          {nextCursor ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                isPending={isLoadingMore}
                onPress={loadMore}
              >
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
            <p className="mt-3 text-center text-[calc(13/15*1rem)] text-danger" role="alert">
              {loadMoreError}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function LatestReviewItem({
  review,
  isMobileLayout,
}: {
  review: LatestReview;
  isMobileLayout: boolean;
}) {
  const date = formatReviewDate(review.created_at);
  const moreHref = `/courses/${review.course_id}?teacher=${review.teacher_id}#${encodeURIComponent(reviewAnchorId(review.id))}`;
  const reviewDetails = (
    <div className="min-w-0 flex-1">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="m-0 min-w-0 text-[calc(13/15*1rem)] leading-6">
          <span className="text-muted">点评了 </span>
          <RouterAriaLink
            to={`/courses/${review.course_id}?teacher=${review.teacher_id}`}
            className="text-accent"
          >
            {review.course_name}
            {review.teacher_name ? `（${review.teacher_name}）` : ""}
          </RouterAriaLink>
        </p>
        {!isMobileLayout && date ? (
          <time
            className="shrink-0 text-[calc(12/15*1rem)] text-muted"
            dateTime={date}
          >
            {date}
          </time>
        ) : null}
      </header>
      <div className="mt-1 line-clamp-3">
        {review.headline ? (
          <p className="m-0 break-words text-sm font-medium leading-relaxed">
            {review.headline}
          </p>
        ) : (
          <ReviewNoteContent
            comment={review.comment}
            commentFormat={review.comment_format}
          />
        )}
      </div>
      <RouterAriaLink
        aria-label={isMobileLayout ? "更多" : undefined}
        to={moreHref}
        className="text-[calc(13/15*1rem)] text-accent"
      >
        {isMobileLayout ? ">>更多" : "查看全文"}
      </RouterAriaLink>
    </div>
  );

  if (isMobileLayout) {
    return (
      <article className="flex gap-3 border-b border-separator py-4 last:border-b-0">
        <ReviewAuthor
          publicCode={review.author_public_code}
          avatarKey={review.author_avatar_key}
          layout="responsive"
        />
        <div className="min-w-0 flex-1">
          <header className="flex min-h-5 items-baseline justify-end">
            {date ? (
              <time
                className="shrink-0 text-[calc(12/15*1rem)] text-muted"
                dateTime={date}
              >
                {date}
              </time>
            ) : null}
          </header>
          {reviewDetails}
        </div>
      </article>
    );
  }

  return (
    <article className="flex gap-3 border-b border-separator py-4 last:border-b-0">
      <span className="mt-0.5">
        <ReviewAuthor
          publicCode={review.author_public_code}
          avatarKey={review.author_avatar_key}
          layout="responsive"
        />
      </span>
      {reviewDetails}
    </article>
  );
}
