/**
 * 课程页点评区（Issue #402，对齐 icourse）：标题「点评」+ 蓝色「写点评」主按钮；
 * 排序 Select（默认 / 认可最多）筛选已加载条目；条目为匿名用户 +
 * 四维档位 + 正文 + 认可。
 *
 * 四维档位标签由 #373 公开流投影按条目下发（dimensionLabels），有则渲染
 * 中文档位 Chip；旧 1–5 规则快照继续显示维度均分 Chip；两者都没有的历史
 * 行不渲染维度行。逐条星级 / 学期 / 日期与学期、评分筛选依赖 #410 的
 * 投影字段（overall/term/created_at），未下发前不渲染对应控件。
 */
import {
  Alert,
  Button,
  Chip,
  Label,
  ListBox,
  Select,
  Spinner,
  Typography,
} from "@heroui/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useViewer } from "../hooks/useViewer";
import { isEndorsableReview } from "../lib/recognition";
import { reviewAnchorId } from "../lib/review-dimensions";
import type { PublicReview } from "../lib/types";
import { DetailErrorAlert, DetailLoadingStatus } from "./DetailFeedback";
import { ReviewRecognitionControl } from "./ReviewRecognitionControl";

type ReviewSort = "default" | "recognized";

function FilterSelect({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: Array<{ id: string; label: string }>;
}) {
  return (
    <Select
      className="w-[148px]"
      value={value}
      onChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {items.map((item) => (
            <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
              {item.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function CourseReviewItem({ review }: { review: PublicReview }) {
  const { viewer, ready, clear } = useViewer();
  return (
    <article
      id={reviewAnchorId(review.id)}
      className="scroll-mt-20 border-b border-separator py-5 last:border-b-0"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] font-medium text-foreground">
          匿名用户
        </span>
      </header>
      {review.dimensionLabels?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {review.dimensionLabels.map((dimension) => (
            <Chip key={dimension.id} size="sm" variant="soft">
              <Chip.Label>
                {dimension.label} {dimension.option}
              </Chip.Label>
            </Chip>
          ))}
        </div>
      ) : typeof review.dimensionAverage === "number" ? (
        <div className="mt-1.5">
          <Chip size="sm" variant="soft">
            <Chip.Label>
              维度均分 {review.dimensionAverage.toFixed(1)}
            </Chip.Label>
          </Chip>
        </div>
      ) : null}
      <p className="m-0 mt-2 break-words text-sm leading-relaxed">
        {review.comment}
      </p>
      {isEndorsableReview(review) ? (
        <footer className="mt-3">
          <ReviewRecognitionControl
            review={review}
            ready={ready}
            authenticated={viewer.authenticated}
            loginPath={viewer.loginPath}
            onUnauthenticated={clear}
          />
        </footer>
      ) : null}
    </article>
  );
}

export function CourseReviewSection({
  courseId,
  teacherId,
  reviews,
  total,
  loading,
  error,
  hasMore,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
}: {
  courseId: number;
  /** 当前选中的任课教师；为空（课程无教师）时隐藏写点评入口。 */
  teacherId: number | null;
  reviews: PublicReview[];
  /** 该关系的公开文字评价总数。 */
  total: number;
  loading: boolean;
  error: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError: string;
  onLoadMore: () => void;
}) {
  const navigate = useNavigate();
  const [reviewSort, setReviewSort] = useState<ReviewSort>("default");

  const visible = useMemo(
    () =>
      reviewSort === "recognized"
        ? [...reviews].sort(
            (a, b) => (b.endorsement_count ?? 0) - (a.endorsement_count ?? 0),
          )
        : reviews,
    [reviews, reviewSort],
  );

  const writeHref = `/submit?courseId=${courseId}${teacherId ? `&teacherId=${teacherId}` : ""}`;

  return (
    <section className="mt-10" aria-labelledby="course-reviews-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <Typography
            className="m-0 text-[20px] font-bold leading-snug text-accent"
            id="course-reviews-heading"
            type="h2"
          >
            点评
          </Typography>
          {total > 0 ? (
            <span className="text-[13px] text-muted">{total} 条</span>
          ) : null}
        </div>
        {teacherId ? (
          <Button variant="primary" size="md" onPress={() => navigate(writeHref)}>
            写点评
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <FilterSelect
          label="排序"
          value={reviewSort}
          onChange={(value) => setReviewSort(value as ReviewSort)}
          items={[
            { id: "default", label: "默认" },
            { id: "recognized", label: "认可最多" },
          ]}
        />
      </div>

      {error && reviews.length === 0 ? (
        <div className="mt-4">
          <DetailErrorAlert title="评价加载失败" message={error} />
        </div>
      ) : loading && reviews.length === 0 ? (
        <div className="mt-4">
          <DetailLoadingStatus label="评价加载中…" />
        </div>
      ) : reviews.length === 0 ? (
        <p
          className="border-b border-separator py-14 text-center text-[13px] text-muted"
          role="status"
        >
          {teacherId
            ? "暂无评价 —— 成为第一位评价这位老师这门课的同学。"
            : "暂无评价 —— 课程教师待补充，补充任课关系后即可评价。"}
        </p>
      ) : (
        <div className="mt-2" role="list" aria-label="评价列表">
          {visible.map((review) => (
            <div key={review.id} role="listitem">
              <CourseReviewItem review={review} />
            </div>
          ))}
          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                isPending={isLoadingMore}
                onPress={onLoadMore}
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
            <Alert className="mt-3" role="alert" status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>继续加载失败</Alert.Title>
                <Alert.Description>{loadMoreError}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <span className="sr-only" aria-live="polite">
            {isLoadingMore
              ? "正在加载更多评价"
              : `已显示 ${visible.length} 条评价`}
          </span>
        </div>
      )}
    </section>
  );
}
