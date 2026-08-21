/**
 * Teacher detail — single-page vertical IA (frozen, module 11).
 *
 * 1. 摘要 B: left identity (name / dept / course count / bio) · right review-count Surface
 * 2. 任课课程 — TeacherCourseTable (course-domain dense fold, per-relation rating)
 * 3. 评价 — PublicReviews unified text stream (counterpart=course)
 *
 * DEV-only: ?module=teaching-reviews-feed replaces section 3 with #71 prototype.
 *
 * Back restores teacher-catalog URL state (drops prototype params if any).
 * Issue #62 · module 11 · docs/ui/foundations.md §详情体验.
 */
import { Typography } from "@heroui/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  DetailErrorAlert,
  DetailPageSkeleton,
} from "../components/DetailFeedback";
import { DetailSummary } from "../components/DetailSummary";
import { EmptyBox } from "../components/EmptyBox";
import { PublicReviews } from "../components/PublicReviews";
import { TeacherCourseTable } from "../components/TeacherCourseTable";
import { usePublicReviewPagination } from "../hooks/usePublicReviewPagination";
import { api } from "../lib/api";
import type {
  Course,
  PublicReview,
  Review,
  Teacher,
} from "../lib/types";

/** DEV-only: 任课评价文字流 (module 12 / #71 承接 #68). */
const TeachingReviewsFeedPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/TeachingReviewsFeedVariants").then((m) => ({
        default: m.TeachingReviewsFeedPrototype,
      })),
    )
  : null;

function useTeachingReviewsFeedPrototypeVariant(): "A" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "teaching-reviews-feed") return null;
    return "A";
  }, [params]);
}

type Detail = {
  teacher: Teacher;
  courses: Course[];
  reviews?: PublicReview[];
  reviewCount: number;
  nextReviewCursor: string | null;
};

function TeacherSummary({
  teacher,
  courseCount,
  reviewCount,
  onBack,
}: {
  teacher: Teacher;
  courseCount: number;
  reviewCount: number;
  onBack: () => void;
}) {
  return (
    <DetailSummary
      backLabel="返回教师目录"
      onBack={onBack}
      reviewCount={reviewCount}
      ariaLabel="教师摘要"
    >
      <Typography
        className="mb-2 mt-0 text-[26px] font-bold leading-tight tracking-tight"
        type="h1"
      >
        {teacher.name}
      </Typography>
      <dl className="m-0 grid gap-1.5 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="shrink-0 text-muted">院系</dt>
          <dd className="m-0 text-foreground">
            {teacher.department || "院系未标注"}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="shrink-0 text-muted">任课课程</dt>
          <dd className="m-0 tabular text-foreground">{courseCount} 门</dd>
        </div>
      </dl>
      {teacher.bio ? (
        <p className="mt-3 mb-0 text-sm leading-relaxed text-muted">
          {teacher.bio}
        </p>
      ) : null}
    </DetailSummary>
  );
}

export function TeacherDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const teachingFeedVariant = useTeachingReviewsFeedPrototypeVariant();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const reviewFeed = usePublicReviewPagination("teachers", id);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    reviewFeed.reset([], null);
    (async () => {
      try {
        const d = await api<Detail>(`/api/teachers/${id}`);
        if (!cancelled) {
          setData(d);
          reviewFeed.reset(d.reviews ?? [], d.nextReviewCursor);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reviewFeed.reset]);

  if (error) {
    return (
      <section className="mx-auto w-full max-w-[880px]">
        <DetailErrorAlert title="教师资料加载失败" message={error} />
      </section>
    );
  }
  if (!data) {
    return (
      <section className="mx-auto w-full max-w-[880px]">
        <DetailPageSkeleton label="教师资料加载中…" />
      </section>
    );
  }

  const t = data.teacher;
  const courses = data.courses ?? [];
  const reviews = reviewFeed.reviews;
  const courseCount = t.course_count ?? courses.length;

  /** Restore catalog filters; drop prototype module/variant if present. */
  const goBack = () => {
    const sp = new URLSearchParams(location.search);
    sp.delete("module");
    sp.delete("variant");
    const q = sp.toString();
    navigate(q ? `/teachers?${q}` : "/teachers");
  };

  const comparingTeachingFeed =
    Boolean(teachingFeedVariant) && Boolean(TeachingReviewsFeedPrototypeLazy);

  return (
    <section className="mx-auto w-full max-w-[880px]">
      <TeacherSummary
        teacher={t}
        courseCount={courseCount}
        reviewCount={data.reviewCount}
        onBack={goBack}
      />

      <section className="mb-6" aria-labelledby="teacher-courses-heading">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <Typography
            className="m-0 text-[17px] font-bold leading-snug"
            id="teacher-courses-heading"
            type="h2"
          >
            任课课程
          </Typography>
          {courses.length ? (
            <span className="text-[13px] text-muted">{courses.length} 门</span>
          ) : null}
        </div>
        <TeacherCourseTable items={courses} />
      </section>

      {comparingTeachingFeed &&
      teachingFeedVariant &&
      TeachingReviewsFeedPrototypeLazy ? (
        <Suspense fallback={<EmptyBox role="status">加载任课评价原型…</EmptyBox>}>
          <TeachingReviewsFeedPrototypeLazy
            key={teachingFeedVariant}
            variant={teachingFeedVariant}
            model={{
              counterpartMode: "course",
              hostLabel: t.name,
              liveReviews: reviews as unknown as Review[],
              liveRatingCount: reviews.length,
            }}
          />
        </Suspense>
      ) : (
        <PublicReviews
          rows={reviews}
          counterpart="course"
          total={data.reviewCount}
          hasMore={Boolean(reviewFeed.nextCursor)}
          isLoadingMore={reviewFeed.isLoadingMore}
          loadMoreError={reviewFeed.loadMoreError}
          onLoadMore={reviewFeed.loadMore}
        />
      )}
    </section>
  );
}
