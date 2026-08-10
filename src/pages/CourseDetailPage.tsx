import { Button, Chip } from "@heroui/react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
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

export function CourseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
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
  return (
    <section>
      <Button
        variant="ghost"
        className="mb-2 px-0"
        onPress={() => navigate(`/courses${location.search}`)}
      >
        ← 返回
      </Button>
      <div className="mb-4 border-b border-border pb-4 pt-2">
        <Chip size="sm" variant="soft">
          <Chip.Label>{categoryLabel(c.category)}</Chip.Label>
        </Chip>
        <h1 className="mb-1 mt-2 text-[26px] font-bold leading-tight">{c.name}</h1>
        <p className="m-0 text-muted">
          {c.code} · {c.department} ·{" "}
          {c.teachers?.length
            ? c.teachers.map((t, i) => (
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
