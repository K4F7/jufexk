import { Button, Chip } from "@heroui/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { EmptyBox } from "../components/EmptyBox";
import { LegacyReviews } from "../components/LegacyReviews";
import { ReviewCard } from "../components/ReviewCard";
import { api } from "../lib/api";
import { categoryLabel } from "../lib/labels";
import type { Course, LegacyReview, Review, Teacher } from "../lib/types";

type Detail = {
  course: Course & { teachers: Teacher[] };
  reviews: Review[];
  legacyReviews?: LegacyReview[];
};

/** DEV-only: live course-detail-summary A/B/C compare. */
const CourseDetailSummaryPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/CourseDetailSummaryVariants").then((m) => ({
        default: m.CourseDetailSummaryPrototype,
      })),
    )
  : null;

/** DEV-only: live course-detail-reviews A/B/C compare (module 10). */
const CourseDetailReviewsPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/CourseDetailReviewsVariants").then((m) => ({
        default: m.CourseDetailReviewsPrototype,
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

/** Production summary header (pre-freeze baseline). */
function ProductionSummary({
  course,
  onBack,
}: {
  course: Course & { teachers: Teacher[] };
  onBack: () => void;
}) {
  return (
    <>
      <Button variant="ghost" className="mb-2 px-0" onPress={onBack}>
        ← 返回
      </Button>
      <div className="mb-4 border-b border-border pb-4 pt-2">
        <Chip size="sm" variant="soft">
          <Chip.Label>{categoryLabel(course.category)}</Chip.Label>
        </Chip>
        <h1 className="mb-1 mt-2 text-[26px] font-bold leading-tight">{course.name}</h1>
        <p className="m-0 text-muted">
          {course.code} · {course.department} ·{" "}
          {course.teachers?.length
            ? course.teachers.map((t, i) => (
                <span key={t.id}>
                  {i > 0 ? " " : null}
                  <Link
                    to={`/teachers/${t.id}`}
                    className="text-muted underline underline-offset-4 hover:text-foreground"
                  >
                    {t.name}
                  </Link>
                </span>
              ))
            : "教师待补充"}
        </p>
      </div>
    </>
  );
}

export function CourseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const summaryVariant = useCourseDetailSummaryPrototypeVariant();
  const reviewsVariant = useCourseDetailReviewsPrototypeVariant();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
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

  return (
    <section>
      {comparingSummary && summaryVariant && CourseDetailSummaryPrototypeLazy ? (
        <Suspense fallback={<EmptyBox role="status">加载摘要原型…</EmptyBox>}>
          <CourseDetailSummaryPrototypeLazy
            key={summaryVariant}
            variant={summaryVariant}
            model={{
              course: c,
              reviews: data.reviews ?? [],
              backSearch: location.search,
              onBack: goBack,
            }}
          />
        </Suspense>
      ) : (
        <ProductionSummary course={c} onBack={goBack} />
      )}

      {comparingReviews && reviewsVariant && CourseDetailReviewsPrototypeLazy ? (
        <Suspense fallback={<EmptyBox role="status">加载投稿原型…</EmptyBox>}>
          <CourseDetailReviewsPrototypeLazy
            key={reviewsVariant}
            variant={reviewsVariant}
            model={{
              reviews: data.reviews ?? [],
              legacyReviews: data.legacyReviews ?? [],
              courseName: c.name,
            }}
          />
        </Suspense>
      ) : (
        <>
          <section
            className="mb-2"
            aria-labelledby="course-submissions-heading"
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2
                id="course-submissions-heading"
                className="m-0 text-[17px] font-bold leading-snug"
              >
                学生投稿
              </h2>
              {data.reviews?.length ? (
                <span className="text-[13px] text-muted">
                  {data.reviews.length} 条
                </span>
              ) : null}
            </div>
            {data.reviews?.length ? (
              <div role="list" aria-label="学生投稿列表">
                {data.reviews.map((r, i) => (
                  <div key={r.id} role="listitem">
                    <ReviewCard review={r} showSeparator={i > 0} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyBox>暂无投稿</EmptyBox>
            )}
          </section>
          <LegacyReviews rows={data.legacyReviews} />
        </>
      )}
    </section>
  );
}
