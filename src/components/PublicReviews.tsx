import { Alert, Button, Card, Chip, Separator, Spinner, Typography } from "@heroui/react";
import { useViewer } from "../hooks/useViewer";
import { formatReviewDate } from "../lib/review-date";
import { isEndorsableReview } from "../lib/recognition";
import type { PublicReview } from "../lib/types";
import { Stars } from "./Stars";
import { ReviewNoteContent } from "./ReviewNoteContent";
import { ReviewRecognitionControl } from "./ReviewRecognitionControl";
import { ReviewAuthor } from "./ReviewAuthor";
import { RouterAriaLink } from "./RouterAriaLink";

/**
 * 统一匿名文字流。课程页评价按 课程×教师 收敛（选定教师后整流同属该
 * 教师），条目不再重复对方身份「昵称」；只有跨课程流（教师页）通过
 * counterpart="course" 保留课程身份行。
 */
export function PublicReviews({
  rows,
  counterpart,
  total,
  hasMore,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
}: {
  rows: PublicReview[];
  /** 跨课程流（教师页）展示课程身份行；课程×教师流省略。 */
  counterpart?: "course";
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError: string;
  onLoadMore: () => void;
}) {
  const { viewer, ready, clear } = useViewer();
  return (
    <section className="mb-2" aria-labelledby="public-reviews-heading">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <Typography
          className="m-0 text-[calc(17/15*1rem)] font-bold leading-snug"
          id="public-reviews-heading"
          type="h2"
        >
          评价
        </Typography>
        {total ? (
          <span className="text-[calc(13/15*1rem)] text-muted">{total} 条</span>
        ) : null}
      </div>
      {rows.length ? (
        <div role="list" aria-label="评价列表" aria-busy={isLoadingMore}>
          {rows.map((review, index) => (
            <div key={review.id} role="listitem">
              {index > 0 ? <Separator /> : null}
              <article className="py-4 [content-visibility:auto] [contain-intrinsic-size:auto_6rem]">
                {counterpart === "course" ? (
                  <p className="m-0 min-w-0 text-sm font-semibold">
                    <RouterAriaLink
                      className="break-words"
                      to={`/courses/${review.course_id}`}
                    >
                      {review.course_name || "课程未标注"}
                      {review.course_code ? `（${review.course_code}）` : null}
                    </RouterAriaLink>
                  </p>
                ) : null}
                <div
                  className={`flex items-start gap-2 ${
                    counterpart === "course" ? "mt-1.5" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className="shrink-0 select-none font-serif text-4xl leading-[0.6] text-accent/35"
                  >
                    “
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 flex flex-wrap items-center gap-x-2 text-[calc(12/15*1rem)] text-muted">
                      <ReviewAuthor
                        publicCode={review.author_public_code}
                        avatarKey={review.author_avatar_key}
                      />
                      {review.overall != null ? (
                        <Stars rating={review.overall} className="text-[calc(13/15*1rem)]" />
                      ) : null}
                      {review.term ? <span>{review.term}</span> : null}
                      {review.grade ? <span>成绩 {review.grade}</span> : null}
                      {review.created_at ? (
                        <time dateTime={formatReviewDate(review.created_at)}>
                          {formatReviewDate(review.created_at)}
                        </time>
                      ) : null}
                    </p>
                    {review.headline ? (
                      <p className="mb-1 mt-0 break-words text-sm font-semibold">
                        {review.headline}
                      </p>
                    ) : null}
                    <ReviewNoteContent
                      comment={review.comment}
                      commentFormat={review.comment_format}
                    />
                    {review.dimensionLabels?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {review.dimensionLabels.map((dimension) => (
                          <Chip key={dimension.id} size="sm" variant="soft">
                            <Chip.Label>
                              {dimension.label} {dimension.option}
                            </Chip.Label>
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                    {typeof review.dimensionAverage === "number" ? (
                      <div className="mt-2">
                        <Chip size="sm" variant="soft">
                          <Chip.Label>
                            维度均分 {review.dimensionAverage.toFixed(1)}
                          </Chip.Label>
                        </Chip>
                      </div>
                    ) : null}
                    {isEndorsableReview(review) ? (
                      <ReviewRecognitionControl
                        review={review}
                        ready={ready}
                        authenticated={viewer.authenticated}
                        loginPath={viewer.loginPath}
                        onUnauthenticated={clear}
                      />
                    ) : null}
                  </div>
                </div>
              </article>
            </div>
          ))}
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
            <Alert className="mt-3" role="alert" status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>继续加载失败</Alert.Title>
                <Alert.Description>{loadMoreError}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <span className="sr-only" aria-live="polite">
            {isLoadingMore ? "正在加载更多评价" : `已显示 ${rows.length} 条评价`}
          </span>
        </div>
      ) : (
        <Card role="status">
          <Card.Header>
            <Card.Title>暂无评价</Card.Title>
          </Card.Header>
        </Card>
      )}
    </section>
  );
}
