/**
 * Teacher detail — icourse two-column IA.
 *
 * Left: 课程（共 N 门） stacked list + 评价文字流.
 * Right: identity Card (avatar / name / department / course & review counts).
 *
 * DEV-only: ?module=teaching-reviews-feed replaces the review section with #71 prototype.
 *
 * Back restores teacher-catalog URL state (drops prototype params if any).
 * Issue #482 · docs/ui/foundations.md §详情体验.
 */
import { Card, Typography } from "@heroui/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { AnonymousAvatar } from "../components/AnonymousAvatar";
import {
  DetailErrorAlert,
  DetailPageSkeleton,
} from "../components/DetailFeedback";
import { EmptyBox } from "../components/EmptyBox";
import { PublicReviews } from "../components/PublicReviews";
import { RouterAriaLink } from "../components/RouterAriaLink";
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

function TeacherIdentityCard({
  teacher,
  courseCount,
  reviewCount,
}: {
  teacher: Teacher;
  courseCount: number;
  reviewCount: number;
}) {
  return (
    <Card aria-label="教师资料">
      <Card.Header className="items-center text-center">
        <AnonymousAvatar
          seed={teacher.id}
          size="lg"
          fallback={teacher.name.slice(0, 1)}
        />
        <Typography
          className="m-0 text-[calc(18/15*1rem)] font-bold leading-tight"
          type="h1"
        >
          {teacher.name}
        </Typography>
        <Card.Description>
          {teacher.department || "院系未标注"}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <dl className="m-0 grid gap-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">任课课程</dt>
            <dd className="m-0 tabular">{courseCount} 门</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">公开评价</dt>
            <dd className="m-0 tabular">{reviewCount} 条</dd>
          </div>
        </dl>
        {teacher.bio ? (
          <p className="mt-3 mb-0 text-sm leading-relaxed text-muted">
            {teacher.bio}
          </p>
        ) : null}
      </Card.Content>
    </Card>
  );
}

export function TeacherDetailPage() {
  const { id } = useParams();
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
      <section className="mx-auto w-full max-w-[1360px]">
        <DetailErrorAlert title="教师资料加载失败" message={error} />
      </section>
    );
  }
  if (!data) {
    return (
      <section className="mx-auto w-full max-w-[1360px]">
        <DetailPageSkeleton label="教师资料加载中…" kind="teacher" />
      </section>
    );
  }

  const t = data.teacher;
  const courses = data.courses ?? [];
  const reviews = reviewFeed.reviews;
  const courseCount = t.course_count ?? courses.length;

  /** Restore catalog filters; drop prototype module/variant if present. */
  const catalogHref = (() => {
    const sp = new URLSearchParams(location.search);
    sp.delete("module");
    sp.delete("variant");
    const q = sp.toString();
    return q ? `/teachers?${q}` : "/teachers";
  })();

  const comparingTeachingFeed =
    Boolean(teachingFeedVariant) && Boolean(TeachingReviewsFeedPrototypeLazy);

  return (
    <div className="mx-auto grid w-full max-w-[1360px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <nav aria-label="面包屑" className="text-[calc(12/15*1rem)] text-muted">
          <RouterAriaLink className="text-muted" to={catalogHref}>
            教师目录
          </RouterAriaLink>
          <span className="mx-1.5">/</span>
          {t.name}
        </nav>

        <section className="mt-3 mb-6" aria-labelledby="teacher-courses-heading">
          <Typography
            className="m-0 text-[calc(18/15*1rem)] font-bold leading-snug"
            id="teacher-courses-heading"
            type="h2"
          >
            课程（共 {courseCount} 门）
          </Typography>
          <TeacherCourseTable items={courses} teacherId={t.id} />
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
      </div>

      <aside className="space-y-3 self-start">
        <TeacherIdentityCard
          teacher={t}
          courseCount={courseCount}
          reviewCount={data.reviewCount}
        />
        <RouterAriaLink
          className="block text-center text-[calc(12/15*1rem)] text-muted no-underline"
          to={catalogHref}
        >
          ← 返回教师目录
        </RouterAriaLink>
      </aside>
    </div>
  );
}
