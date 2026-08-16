/**
 * Teacher detail — adapted from frozen course-detail language (no separate A/B/C).
 *
 * Layout (single-page vertical):
 * 1. Compact summary B: left identity (name / title / dept / bio) · right score Surface
 * 2. Courses taught — TeacherCourseTable (course-domain dense fold)
 * 3. Related student submissions — ReviewCard identity=course (module 10 freeze)
 * 4. Historical materials — LegacyReviews showCourse (module 10 freeze)
 *
 * DEV-only: ?module=teaching-reviews-feed replaces section 3 with #71 prototype.
 *
 * Back restores teacher-catalog URL state (drops prototype params if any).
 * Issue #62 · module 11 · docs/ui/foundations.md §详情体验.
 */
import { Button } from "@heroui/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { EmptyBox } from "../components/EmptyBox";
import { PublicReviews } from "../components/PublicReviews";
import { TeacherCourseTable } from "../components/TeacherCourseTable";
import { api } from "../lib/api";
import type { Course, PublicReview, Review, Teacher } from "../lib/types";

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
};

function TeacherSummary({
  teacher,
  courseCount,
  onBack,
}: {
  teacher: Teacher;
  courseCount: number;
  onBack: () => void;
}) {
  return (
    <header className="mb-4" aria-label="教师摘要">
      <Button variant="ghost" size="sm" className="mb-1 px-0" onPress={onBack}>
        ← 返回教师目录
      </Button>
      <div className="mt-1 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="mb-2 mt-0 text-[26px] font-bold leading-tight tracking-tight">
            {teacher.name}
          </h1>
          <dl className="m-0 grid gap-1.5 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="shrink-0 text-muted">职称</dt>
              <dd className="m-0 text-foreground">
                {teacher.title || "职称未标注"}
              </dd>
            </div>
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
        </div>
      </div>
    </header>
  );
}

export function TeacherDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const teachingFeedVariant = useTeachingReviewsFeedPrototypeVariant();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api<Detail>(`/api/teachers/${id}`);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <EmptyBox role="alert">{error}</EmptyBox>;
  if (!data) return <EmptyBox role="status">加载中…</EmptyBox>;

  const t = data.teacher;
  const courses = data.courses ?? [];
  const reviews = data.reviews ?? [];
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
    <section>
      <TeacherSummary teacher={t} courseCount={courseCount} onBack={goBack} />

      <section className="mb-6" aria-labelledby="teacher-courses-heading">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="teacher-courses-heading"
            className="m-0 text-[17px] font-bold leading-snug"
          >
            任课课程
          </h2>
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
        <PublicReviews rows={reviews} identity="course" />
      )}
    </section>
  );
}
