import { Chip } from "@heroui/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  Review,
  Teacher,
} from "../lib/types";

type Detail = {
  course: Course & { teachers: Teacher[] };
  reviews: PublicReview[];
  reviewCount: number;
  nextReviewCursor: string | null;
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
  const reviewFeed = usePublicReviewPagination("courses", id);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    reviewFeed.reset([], null);
    (async () => {
      try {
        const d = await api<Detail>(`/api/courses/${id}`);
        if (!cancelled) {
          setData(d);
          reviewFeed.reset(d.reviews, d.nextReviewCursor);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reviewFeed.reset]);

  if (error) return <EmptyBox role="alert">{error}</EmptyBox>;
  if (!data) return <EmptyBox role="status">加载中…</EmptyBox>;

  const c = data.course;
  /** Restore catalog filters; drop prototype module/variant so back lands on production catalog. */
  const goBack = () => {
    const sp = new URLSearchParams(location.search);
    sp.delete("module");
    sp.delete("variant");
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

  return (
    <section className="mx-auto w-full max-w-[880px]">
      {comparingSummary && summaryVariant && CourseDetailSummaryPrototypeLazy ? (
        <Suspense fallback={<EmptyBox role="status">加载摘要原型…</EmptyBox>}>
          <CourseDetailSummaryPrototypeLazy
            key={summaryVariant}
            variant={summaryVariant}
            model={{
              course: c,
              reviews: (data.reviews ?? []) as unknown as Review[],
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
        <CourseTeacherTable items={c.teachers ?? []} />
      </section>

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
              liveReviews: (data.reviews ?? []) as unknown as Review[],
              liveRatingCount: data.reviews?.length ?? 0,
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
              reviews: (data.reviews ?? []) as unknown as Review[],
              legacyReviews: [],
              courseName: c.name,
            }}
          />
        </Suspense>
      ) : (
        <>
          <PublicReviews
            rows={reviewFeed.reviews}
            identity="teacher"
            total={data.reviewCount}
            hasMore={Boolean(reviewFeed.nextCursor)}
            isLoadingMore={reviewFeed.isLoadingMore}
            loadMoreError={reviewFeed.loadMoreError}
            onLoadMore={reviewFeed.loadMore}
          />
        </>
      )}
    </section>
  );
}
