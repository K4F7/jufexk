import { Button, Table } from "@heroui/react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { EmptyBox } from "../components/EmptyBox";
import { LegacyReviews } from "../components/LegacyReviews";
import { api } from "../lib/api";
import { scoreText } from "../lib/labels";
import type { Course, LegacyReview, Teacher } from "../lib/types";

type Detail = {
  teacher: Teacher;
  courses: Course[];
  legacyReviews?: LegacyReview[];
};

export function TeacherDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
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

  return (
    <section>
      <Button
        variant="ghost"
        className="mb-2 px-0"
        onPress={() => navigate(`/teachers${location.search}`)}
      >
        ← 返回
      </Button>
      <div className="mb-4 border-b border-border pb-4 pt-2">
        <h1 className="mb-1 mt-0 text-[26px] font-bold">{t.name}</h1>
        <p className="m-0 text-muted">
          {t.title || "职称未标注"} · {t.department}
        </p>
        {t.bio ? <p className="mt-2 text-muted">{t.bio}</p> : null}
      </div>
      <Table className="dense-table">
        <Table.ScrollContainer>
          <Table.Content aria-label="任课课程" className="min-w-[560px]">
            <Table.Header>
              <Table.Column isRowHeader>课号</Table.Column>
              <Table.Column>课程</Table.Column>
              <Table.Column>评分</Table.Column>
              <Table.Column>评价数</Table.Column>
            </Table.Header>
            <Table.Body
              items={data.courses || []}
              renderEmptyState={() => (
                <div className="py-8 text-center text-muted" role="status">
                  暂无任课课程
                </div>
              )}
            >
              {(course) => (
                <Table.Row
                  id={String(course.id)}
                  key={course.id}
                  href={`/courses/${course.id}`}
                  className="cursor-pointer"
                >
                  <Table.Cell>
                    <span className="tabular text-[13px] text-muted">
                      {course.code}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-semibold">{course.name}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="tabular font-semibold text-accent">
                      {scoreText(course.rating)}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="tabular font-semibold text-accent">
                      {course.review_count}
                    </span>
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <LegacyReviews rows={data.legacyReviews} showCourse />
    </section>
  );
}
