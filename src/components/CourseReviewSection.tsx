/**
 * 课程页点评区（Issue #402，对齐 icourse）：标题「点评」+ 计数 + 蓝色「写点评」；
 * 排序、学期、评分用 secondary Select 单行「标签：当前值」，由服务端排序/筛选；条目为官方占位
 * 头像 + 匿名用户 + 星级 + 学期 + 四维档位 + 正文 + 认可（Issue #431）。
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
import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminSession } from "../hooks/useAdminSession";
import { useViewer } from "../hooks/useViewer";
import { formatReviewDate } from "../lib/review-date";
import { isEndorsableReview } from "../lib/recognition";
import { reviewAnchorId } from "../lib/review-dimensions";
import type { PublicReview } from "../lib/types";
import { ReviewAuthor } from "./ReviewAuthor";
import { DetailErrorAlert, DetailLoadingStatus } from "./DetailFeedback";
import { ReviewAdminControls } from "./ReviewAdminControls";
import { ReviewNoteContent } from "./ReviewNoteContent";
import { ReviewRecognitionControl } from "./ReviewRecognitionControl";
import { Stars } from "./Stars";

export type CourseReviewSort =
  | "recognized"
  | "latest"
  | "oldest"
  | "rating_desc"
  | "rating_asc";

const SORT_ITEMS: Array<{ id: CourseReviewSort; label: string }> = [
  { id: "recognized", label: "认可最多" },
  { id: "latest", label: "最新发布" },
  { id: "oldest", label: "最早发布" },
  { id: "rating_desc", label: "评分最高" },
  { id: "rating_asc", label: "评分最低" },
];

const RATING_ITEMS: Array<{ id: string; label: string }> = [
  { id: "all", label: "全部" },
  ...[5, 4, 3, 2, 1].map((score) => ({
    id: String(score),
    label: `${score} 星`,
  })),
];

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
      className="w-auto"
      variant="secondary"
      value={value}
      onChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <Label className="sr-only">{label}</Label>
      <Select.Trigger>
        <Select.Value>
          {({ defaultChildren }) => (
            <>
              {label}：{defaultChildren}
            </>
          )}
        </Select.Value>
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

const CourseReviewItem = memo(function CourseReviewItem({
  review,
  ready,
  authenticated,
  loginPath,
  onUnauthenticated,
  adminAuthed,
  onReviewChanged,
}: {
  review: PublicReview;
  ready: boolean;
  authenticated: boolean;
  loginPath: string;
  onUnauthenticated: () => void;
  /** 管理员会话有效时渲染管理动作（屏蔽 / 删除 / 查作者）。 */
  adminAuthed: boolean;
  onReviewChanged?: () => void;
}) {
  const date = formatReviewDate(review.created_at);
  return (
    <article
      id={reviewAnchorId(review.id)}
      className="scroll-mt-20 border-b border-separator py-5 last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_9rem]"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-x-2 text-[calc(13/15*1rem)] font-medium text-foreground">
          <ReviewAuthor
            publicCode={review.author_public_code}
            avatarKey={review.author_avatar_key}
          />
          {review.overall != null ? (
            <Stars rating={review.overall} className="text-[calc(13/15*1rem)]" />
          ) : null}
          {review.term ? (
            <span className="font-normal text-muted">{review.term}</span>
          ) : null}
          {review.grade ? (
            <span className="font-normal text-muted">成绩 {review.grade}</span>
          ) : null}
          {review.blocked ? (
            <Chip color="danger" size="sm" variant="soft">
              <Chip.Label>已屏蔽</Chip.Label>
            </Chip>
          ) : null}
        </span>
        {date ? (
          <time className="text-[calc(12/15*1rem)] text-muted" dateTime={date}>
            {date}
          </time>
        ) : null}
      </header>
      {review.blocked && adminAuthed ? (
        <p className="mb-0 mt-1 text-[12px] text-danger">
          此评价已被屏蔽，公开列表不再展示，仅管理员可见。
        </p>
      ) : null}
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
      {review.headline ? (
        <p className="mb-0 mt-2 break-words text-[calc(14/15*1rem)] font-semibold">
          {review.headline}
        </p>
      ) : null}
      <div className="mt-2">
        <ReviewNoteContent
          comment={review.comment}
          commentFormat={review.comment_format}
        />
      </div>
      {isEndorsableReview(review) ? (
        <footer className="mt-3">
          <ReviewRecognitionControl
            review={review}
            ready={ready}
            authenticated={authenticated}
            loginPath={loginPath}
            onUnauthenticated={onUnauthenticated}
          />
        </footer>
      ) : null}
      {adminAuthed && onReviewChanged ? (
        <ReviewAdminControls review={review} onChanged={onReviewChanged} />
      ) : null}
    </article>
  );
});

export function CourseReviewSection({
  courseId,
  teacherId,
  terms = [],
  sort,
  term,
  rating,
  onSortChange,
  onTermChange,
  onRatingChange,
  reviews,
  total,
  loading,
  error,
  hasMore,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
  onReviewChanged,
}: {
  courseId: number;
  /** 当前选中的任课教师；为空（课程无教师）时隐藏写点评入口。 */
  teacherId: number | null;
  /** 该关系的学期列表，与头部共用。 */
  terms?: string[];
  sort: CourseReviewSort;
  term: string;
  rating: string;
  onSortChange: (value: CourseReviewSort) => void;
  onTermChange: (value: string) => void;
  onRatingChange: (value: string) => void;
  reviews: PublicReview[];
  /** 该关系的公开文字评价总数。 */
  total: number;
  loading: boolean;
  error: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError: string;
  onLoadMore: () => void;
  /** 管理动作改变公开集合后触发（清空缓存并重拉第一页）。 */
  onReviewChanged?: () => void;
}) {
  const navigate = useNavigate();
  const { viewer, ready, clear } = useViewer();
  const { authed: adminAuthed } = useAdminSession();

  const writeHref = `/submit?courseId=${courseId}${teacherId ? `&teacherId=${teacherId}` : ""}`;

  return (
    <section className="mt-10" aria-labelledby="course-reviews-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <Typography
            className="m-0 text-[calc(20/15*1rem)] font-bold leading-snug text-accent"
            id="course-reviews-heading"
            type="h2"
          >
            点评
          </Typography>
          <span className="text-[calc(13/15*1rem)] text-muted">{total} 条点评</span>
        </div>
        {teacherId ? (
          <Button variant="primary" size="md" onPress={() => navigate(writeHref)}>
            写点评
          </Button>
        ) : null}
      </div>

      <div
        role="group"
        aria-label="点评筛选"
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        <FilterSelect
          label="排序"
          value={sort}
          onChange={(value) => onSortChange(value as CourseReviewSort)}
          items={SORT_ITEMS}
        />
        <FilterSelect
          label="学期"
          value={term}
          onChange={onTermChange}
          items={[
            { id: "all", label: "全部" },
            ...terms.map((term) => ({ id: term, label: term })),
          ]}
        />
        <FilterSelect
          label="评分"
          value={rating}
          onChange={onRatingChange}
          items={RATING_ITEMS}
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
          className="border-b border-separator py-14 text-center text-[calc(13/15*1rem)] text-muted"
          role="status"
        >
          {teacherId && (term !== "all" || rating !== "all")
            ? "没有符合当前筛选条件的点评。"
            : teacherId
              ? "暂无评价 —— 成为第一位评价这位老师这门课的同学。"
            : "暂无评价 —— 课程教师待补充，补充任课关系后即可评价。"}
        </p>
      ) : (
        <div className="mt-2" role="list" aria-label="评价列表">
          {reviews.map((review) => (
            <div key={review.id} role="listitem">
              <CourseReviewItem
                review={review}
                ready={ready}
                authenticated={viewer.authenticated}
                loginPath={viewer.loginPath}
                onUnauthenticated={clear}
                adminAuthed={adminAuthed}
                onReviewChanged={onReviewChanged}
              />
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
              : `已显示 ${reviews.length} 条评价`}
          </span>
        </div>
      )}
    </section>
  );
}
