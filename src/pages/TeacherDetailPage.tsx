/**
 * Teacher detail — icourse two-column IA.
 *
 * Left: 课程（共 N 门） stacked list.
 * Right: identity Card (avatar / name / department / course, review, scores).
 *
 * 教师页不展示跨课程评价流；评价只在课程页按任课关系查看。
 * Issue #482 · docs/ui/foundations.md §详情体验.
 */
import { Card, Typography } from "@heroui/react";
import { TeacherIdentityName } from "../components/TeacherIdentityName";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { AnonymousAvatar } from "../components/AnonymousAvatar";
import { TeacherHomepageLine } from "../components/OfficialHomepageLink";
import {
  DetailPageSkeleton,
} from "../components/DetailFeedback";
import { previewFilledTeacherDetail, readDevPreviewOrFilled } from "../lib/dev-preview";
import { DetailErrorAlert } from "../components/DetailErrorAlert";
import { TeacherCourseTable } from "../components/TeacherCourseTable";
import { api } from "../lib/api";
import { getCatalogData } from "../lib/catalog-data-cache";
import { formatSidebarScore } from "../lib/labels";
import type { Course, Teacher } from "../lib/types";

type Detail = {
  teacher: Teacher;
  courses: Course[];
  reviewCount: number;
};

function identityStats(
  courseCount: number,
  reviewCount: number,
  rating?: number | null,
) {
  return [
    { label: "任课课程", value: `${courseCount} 门` },
    { label: "得到的评价", value: `${reviewCount} 条` },
    { label: "平均分", value: formatSidebarScore(rating) },
    // 仓库没有 Bayesian / 站点先验等归一化投影；有现成字段前固定为 -。
    { label: "归一化平均分", value: "-" },
  ];
}

function IdentityStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words tabular">{value}</dd>
    </div>
  );
}

function IdentityStatCompact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dd className="m-0 font-medium tabular">{value}</dd>
      <dt className="text-[calc(12/15*1rem)] text-muted">{label}</dt>
    </div>
  );
}

function TeacherIdentityCard({
  teacher,
  courseCount,
  reviewCount,
}: {
  teacher: Teacher;
  courseCount: number;
  reviewCount: number;
}) {
  const stats = identityStats(courseCount, reviewCount, teacher.rating);
  const isLg = useMediaQuery("(min-width: 64rem)");

  return (
    <Card aria-label="教师资料">
      <Card.Header className="flex-row items-center justify-center gap-3 text-left lg:flex-col lg:items-center lg:justify-normal lg:gap-0 lg:text-center">
        <AnonymousAvatar
          seed={teacher.id}
          photoSrc={teacher.avatar_url}
          size="lg"
          className="size-[64px] shrink-0 rounded-full sm:size-[96px]"
          fallback={teacher.name.slice(0, 1)}
        />
        <div className="min-w-0 lg:contents">
          <TeacherIdentityName as="h1">{teacher.name}</TeacherIdentityName>
          <Card.Description className="min-w-0 break-words">
            {teacher.department || "院系未标注"}
          </Card.Description>
          <TeacherHomepageLine officialUrl={teacher.official_homepage_url} />
        </div>
      </Card.Header>
      <Card.Content>
        {isLg ? (
          <dl className="m-0 grid min-w-0 gap-1.5 text-sm">
            {stats.map((item) => (
              <IdentityStat key={item.label} label={item.label} value={item.value} />
            ))}
          </dl>
        ) : (
          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 text-center">
            {stats.map((item) => (
              <IdentityStatCompact
                key={item.label}
                label={item.label}
                value={item.value}
              />
            ))}
          </dl>
        )}
        {teacher.bio ? (
          <p className="mt-3 mb-0 min-w-0 break-words text-sm leading-relaxed text-muted">
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

  const preview = readDevPreviewOrFilled(new URLSearchParams(location.search));

  useEffect(() => {
    if (preview === "error") {
      setData(null);
      setError("教师资料加载失败");
      return;
    }
    if (preview === "empty" || preview === "empty-catalog") {
      const detail = previewFilledTeacherDetail(Number(id) || 1);
      setError("");
      setData({ ...detail, courses: [], reviewCount: 0 });
      return;
    }
    if (preview === "filled") {
      setError("");
      setData(previewFilledTeacherDetail(Number(id) || 1));
      return;
    }
    let cancelled = false;
    setData(null);
    setError("");
    (async () => {
      try {
        const detailUrl = `/api/teachers/${id}`;
        const d = await getCatalogData(detailUrl, () => api<Detail>(detailUrl));
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, preview]);

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

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1360px] grid-cols-1 gap-5 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <section className="mb-4 min-w-0 sm:mb-6" aria-labelledby="teacher-courses-heading">
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

      <aside className="order-first min-w-0 space-y-3 self-start lg:order-none">
        <TeacherIdentityCard
          teacher={t}
          courseCount={courseCount}
          reviewCount={data.reviewCount}
        />
      </aside>
    </div>
  );
}
