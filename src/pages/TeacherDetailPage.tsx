/**
 * Teacher detail — icourse two-column IA.
 *
 * Left: 课程（共 N 门） stacked list.
 * Right: identity Card (avatar / name / department / course & review counts).
 *
 * 教师页不展示跨课程评价流；评价只在课程页按任课关系查看。
 *
 * Back restores teacher-catalog URL state (drops prototype params if any).
 * Issue #482 · docs/ui/foundations.md §详情体验.
 */
import { Breadcrumbs, Card, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { AnonymousAvatar } from "../components/AnonymousAvatar";
import {
  DetailErrorAlert,
  DetailPageSkeleton,
} from "../components/DetailFeedback";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { TeacherCourseTable } from "../components/TeacherCourseTable";
import { api } from "../lib/api";
import type { Course, Teacher } from "../lib/types";

type Detail = {
  teacher: Teacher;
  courses: Course[];
  reviewCount: number;
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
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
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
  const courseCount = t.course_count ?? courses.length;

  /** Restore catalog filters; drop prototype module/variant if present. */
  const catalogHref = (() => {
    const sp = new URLSearchParams(location.search);
    sp.delete("module");
    sp.delete("variant");
    const q = sp.toString();
    return q ? `/teachers?${q}` : "/teachers";
  })();

  return (
    <div className="mx-auto grid w-full max-w-[1360px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <nav aria-label="面包屑">
          <Breadcrumbs>
            <Breadcrumbs.Item href={catalogHref}>教师目录</Breadcrumbs.Item>
            <Breadcrumbs.Item>{t.name}</Breadcrumbs.Item>
          </Breadcrumbs>
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
