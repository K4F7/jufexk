import { Chip } from "@heroui/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CourseTeacherTable } from "../components/CourseTeacherTable";
import { DetailSummary } from "../components/DetailSummary";
import { EmptyBox } from "../components/EmptyBox";
import { PublicReviews } from "../components/PublicReviews";
import { usePublicReviewPagination } from "../hooks/usePublicReviewPagination";
import { api } from "../lib/api";
import { categoryLabel } from "../lib/labels";
import type {
  Course,
  PublicReview,
  PublicReviewPage,
  Review,
  Teacher,
} from "../lib/types";

type Detail = {
  course: Course & { teachers: Teacher[] };
  reviewCount: number;
};

/** DEV-only: live course-detail-summary A/B/C compare. */
const CourseDetailSummaryPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/CourseDetailSummaryVariants").then((m) => ({
        default: m.CourseDetailSummaryPrototype,
      })),
    )
  : null;

/** DEV-only: live course-detail-reviews A/B/C compare (module 10 / #61). */
const CourseDetailReviewsPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/CourseDetailReviewsVariants").then((m) => ({
        default: m.CourseDetailReviewsPrototype,
      })),
    )
  : null;

/** DEV-only: 任课评价文字流 (module 12 / #71 承接 #68). */
const TeachingReviewsFeedPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/TeachingReviewsFeedVariants").then((m) => ({
        default: m.TeachingReviewsFeedPrototype,
      })),
    )
  : null;

/** DEV-only: 认可交互状态 (module 13 / #74 承接 #70). */
const ReviewRecognitionPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/ReviewRecognitionVariants").then((m) => ({
        default: m.ReviewRecognitionPrototype,
      })),
    )
  : null;

function useCourseDetailSummaryPrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "course-detail-summary") return null;
    const key = (params.get("variant") || "A").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "A";
  }, [params]);
}

function useCourseDetailReviewsPrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "course-detail-reviews") return null;
    const key = (params.get("variant") || "A").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "A";
  }, [params]);
}

function useTeachingReviewsFeedPrototypeVariant(): "A" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "teaching-reviews-feed") return null;
    return "A";
  }, [params]);
}

function useReviewRecognitionPrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "review-recognition") return null;
    const key = (params.get("variant") || "A").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "A";
  }, [params]);
}

/** Production summary — 摘要 B layout; course pages show no course-level
 * rating (scores stay on the 教师×课程 rows below, Issue #140). */
function ProductionSummary({
  course,
  reviewCount,
  onBack,
}: {
  course: Course & { teachers: Teacher[] };
  reviewCount: number;
  onBack: () => void;
}) {
  return (
    <DetailSummary
      backLabel="返回课程目录"
      onBack={onBack}
      reviewCount={reviewCount}
      ariaLabel="课程摘要"
    >
      <Chip size="sm" variant="soft">
        <Chip.Label>{categoryLabel(course.category)}</Chip.Label>
      </Chip>
      <h1 className="mb-1 mt-2 text-[26px] font-bold leading-tight">
        {course.name}
      </h1>
      <p className="m-0 text-muted">
        {course.code} · {course.department || "院系待补充"}
      </p>
    </DetailSummary>
  );
}

export function CourseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const summaryVariant = useCourseDetailSummaryPrototypeVariant();
  const reviewsVariant = useCourseDetailReviewsPrototypeVariant();
  const teachingFeedVariant = useTeachingReviewsFeedPrototypeVariant();
  const recognitionVariant = useReviewRecognitionPrototypeVariant();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [reviewsError, setReviewsError] = useState("");
  const [reviewsLoading, setReviewsLoading] = useState(false);

  /** 评价按 课程×教师 展示：URL `teacher` 参数记录选中的任课教师；
   * 未选教师时展示该课全部评价（Issue #201）。 */
  const selectedTeacherId = useMemo(() => {
    const raw = new URLSearchParams(location.search).get("teacher");
    if (!raw || !/^-?(?:0|[1-9]\d*)$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }, [location.search]);
  const teacherQuery = selectedTeacherId ? `teacherId=${selectedTeacherId}` : "";
  const reviewFeed = usePublicReviewPagination("courses", id, teacherQuery);
  /** Session cache of first pages by teacher scope, so switching teachers
   *  restores the previous list instantly instead of losing it (Issue #202).
   *  In-flight promises are shared too, so StrictMode double-effects and the
   *  course-payload arrival never issue a duplicate request. */
  const reviewCacheRef = useRef(new Map<string, PublicReviewPage>());
  const reviewInflightRef = useRef(new Map<string, Promise<PublicReviewPage>>());

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    (async () => {
      try {
        const d = await api<Detail>(`/api/courses/${id}`);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setReviewsError("");
    // 未选教师时需要课程总数判断是否有评价可加载；选定教师的深链不必等待。
    if (!selectedTeacherId && !data) {
      return () => {
        cancelled = true;
      };
    }
    const cacheKey = `${id}:${teacherQuery}`;
    const cached = reviewCacheRef.current.get(cacheKey);
    if (cached) {
      reviewFeed.reset(cached.items, cached.nextCursor);
      setReviewsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (!selectedTeacherId && data && data.reviewCount === 0) {
      reviewFeed.reset([], null);
      setReviewsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    reviewFeed.reset([], null);
    setReviewsLoading(true);
    let promise = reviewInflightRef.current.get(cacheKey);
    if (!promise) {
      promise = api<PublicReviewPage>(
        `/api/courses/${id}/reviews${teacherQuery ? `?${teacherQuery}` : ""}`,
      );
      reviewInflightRef.current.set(cacheKey, promise);
      promise
        .then((page) => {
          reviewCacheRef.current.set(cacheKey, page);
          reviewInflightRef.current.delete(cacheKey);
        })
        .catch(() => {
          reviewInflightRef.current.delete(cacheKey);
        });
    }
    promise
      .then((page) => {
        if (!cancelled) reviewFeed.reset(page.items, page.nextCursor);
      })
      .catch((e) => {
        if (!cancelled) setReviewsError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setReviewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, id, selectedTeacherId, teacherQuery, reviewFeed.reset]);

  /** 加载更多成功后把完整已加载列表回写进会话缓存，切走再切回时整页恢复
   *  （含未选教师的「全部评价」视图，Issue #212）。 */
  const handleLoadMore = useCallback(async () => {
    const accumulated = await reviewFeed.loadMore();
    if (accumulated) {
      reviewCacheRef.current.set(`${id}:${teacherQuery}`, accumulated);
    }
  }, [reviewFeed.loadMore, id, teacherQuery]);

  if (error) return <EmptyBox role="alert">{error}</EmptyBox>;
  if (!data) return <EmptyBox role="status">加载中…</EmptyBox>;

  const c = data.course;
  const selectedTeacher = (c.teachers ?? []).find(
    (teacher) => teacher.id === selectedTeacherId,
  );
  /** Restore catalog filters; drop prototype module/variant and the
   * course-page teacher selection so back lands on the production catalog. */
  const goBack = () => {
    const sp = new URLSearchParams(location.search);
    sp.delete("module");
    sp.delete("variant");
    sp.delete("teacher");
    const q = sp.toString();
    navigate(q ? `/courses?${q}` : "/courses");
  };
  const comparingSummary =
    Boolean(summaryVariant) && Boolean(CourseDetailSummaryPrototypeLazy);
  const comparingReviews =
    Boolean(reviewsVariant) && Boolean(CourseDetailReviewsPrototypeLazy);
  const comparingTeachingFeed =
    Boolean(teachingFeedVariant) && Boolean(TeachingReviewsFeedPrototypeLazy);
  const comparingRecognition =
    Boolean(recognitionVariant) && Boolean(ReviewRecognitionPrototypeLazy);

  const reviewArea = (
    <>
      {comparingRecognition &&
      recognitionVariant &&
      ReviewRecognitionPrototypeLazy ? (
        <Suspense fallback={<EmptyBox role="status">加载认可原型…</EmptyBox>}>
          <ReviewRecognitionPrototypeLazy
            key={recognitionVariant}
            variant={recognitionVariant}
            model={{ hostLabel: c.name }}
          />
        </Suspense>
      ) : comparingTeachingFeed &&
        teachingFeedVariant &&
        TeachingReviewsFeedPrototypeLazy ? (
        <Suspense fallback={<EmptyBox role="status">加载任课评价原型…</EmptyBox>}>
          <TeachingReviewsFeedPrototypeLazy
            key={teachingFeedVariant}
            variant={teachingFeedVariant}
            model={{
              counterpartMode: "teacher",
              hostLabel: c.name,
              liveReviews: reviewFeed.reviews as unknown as Review[],
              liveRatingCount: reviewFeed.reviews.length,
            }}
          />
        </Suspense>
      ) : comparingReviews &&
        reviewsVariant &&
        CourseDetailReviewsPrototypeLazy ? (
        <Suspense fallback={<EmptyBox role="status">加载投稿原型…</EmptyBox>}>
          <CourseDetailReviewsPrototypeLazy
            key={reviewsVariant}
            variant={reviewsVariant}
            model={{
              reviews: reviewFeed.reviews as unknown as Review[],
              legacyReviews: [],
              courseName: c.name,
            }}
          />
        </Suspense>
      ) : reviewsError && reviewFeed.reviews.length === 0 ? (
        <EmptyBox role="alert">{reviewsError}</EmptyBox>
      ) : reviewsLoading && reviewFeed.reviews.length === 0 ? (
        <EmptyBox role="status">评价加载中…</EmptyBox>
      ) : (
        <PublicReviews
          rows={reviewFeed.reviews}
          identity="teacher"
          total={
            selectedTeacherId
              ? (selectedTeacher?.review_count ?? 0)
              : data.reviewCount
          }
          hasMore={Boolean(reviewFeed.nextCursor)}
          isLoadingMore={reviewFeed.isLoadingMore}
          loadMoreError={reviewFeed.loadMoreError}
          onLoadMore={handleLoadMore}
        />
      )}
    </>
  );

  return (
    <section className="mx-auto w-full max-w-[880px]">
      {comparingSummary && summaryVariant && CourseDetailSummaryPrototypeLazy ? (
        <Suspense fallback={<EmptyBox role="status">加载摘要原型…</EmptyBox>}>
          <CourseDetailSummaryPrototypeLazy
            key={summaryVariant}
            variant={summaryVariant}
            model={{
              course: c,
              reviews: reviewFeed.reviews as unknown as Review[],
              backSearch: location.search,
              onBack: goBack,
            }}
          />
        </Suspense>
      ) : (
        <ProductionSummary
          course={c}
          reviewCount={data.reviewCount}
          onBack={goBack}
        />
      )}

      <section className="mb-6" aria-labelledby="course-teachers-heading">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="course-teachers-heading"
            className="m-0 text-[17px] font-bold leading-snug"
          >
            任课教师
          </h2>
          {c.teachers?.length ? (
            <span className="text-[13px] text-muted">
              {c.teachers.length} 位
            </span>
          ) : null}
        </div>
        {c.teachers?.length ? (
          <p className="mb-2 break-keep wrap-break-word text-[13px] leading-relaxed text-muted">
            选择一位任课教师，查看这位老师在这门课的评价；默认显示全部评价。
          </p>
        ) : null}
        <CourseTeacherTable
          items={c.teachers ?? []}
          courseId={c.id}
          search={location.search}
          selectedId={selectedTeacherId}
        />
      </section>

      <div className="mb-6">{reviewArea}</div>
    </section>
  );
}
