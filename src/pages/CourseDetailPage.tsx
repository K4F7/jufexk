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

      <h2 className="mb-2 text-[17px] font-bold">学生怎么说</h2>
      <div>
        {data.reviews?.length ? (
          data.reviews.map((r) => <ReviewCard key={r.id} review={r} />)
        ) : (
          <EmptyBox>暂无评价</EmptyBox>
        )}
      </div>
      <LegacyReviews rows={data.legacyReviews} />
    </section>
  );
}
