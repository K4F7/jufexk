/**
 * 课程详情 /courses/:id?teacher= — USTC 评课社区对齐（Issue #402）。
 * 页面始终按 课程×教师 关系展示：未带 teacher 参数时落到点评数最多的关系。
 * 左栏：面包屑 / 课程头（课名（老师）· 课程号 · 星级推荐度 · 四维 ·
 * 元信息网格 · 关注/推荐/不推荐）/ AI 总结 / 点评区。
 *
 * DEV-only: ?module=review-recognition 替换点评区为 #74 原型。
 */
import { Typography } from "@heroui/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { AnonymousAvatar } from "../components/AnonymousAvatar";
import { CourseAiSummary } from "../components/CourseAiSummary";
import {
  CourseReviewSection,
  type CourseReviewSort,
} from "../components/CourseReviewSection";
import {
  DetailErrorAlert,
  DetailPageSkeleton,
} from "../components/DetailFeedback";
import { EmptyBox } from "../components/EmptyBox";
import { FourDimLine } from "../components/FourDimLine";
import { RelationSignalControls } from "../components/RelationSignalControls";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { Stars } from "../components/Stars";
import { usePublicReviewPagination } from "../hooks/usePublicReviewPagination";
import { api } from "../lib/api";
import { fourDimLineLabels } from "../lib/dimension-labels";
import { categoryLabel } from "../lib/labels";
import type {
  Course,
  PublicReviewPage,
  RelationSummary,
  Teacher,
} from "../lib/types";

type Detail = {
  course: Course & { teachers: Teacher[] };
  reviewCount: number;
  /** 任课关系 AI 总结（#401），按教师 ID 索引；空总结不下发。 */
  summaries?: Record<string, RelationSummary>;
};

/** DEV-only: 认可交互状态 (module 13 / #74 承接 #70). */
const ReviewRecognitionPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/ReviewRecognitionVariants").then((m) => ({
        default: m.ReviewRecognitionPrototype,
      })),
    )
  : null;

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

/** 右侧栏 dashed 面板（其他老师的这门课 / 这位老师的其他课）。
 *  标题不用 heading：面板标题含课名/教师名，会跟页面主标题的
 *  getByRole("heading") 查询撞车。 */
function SidePanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-dashed border-border bg-surface-secondary/60 px-3 py-2.5">
      <p className="m-0 text-[13px] font-bold text-foreground">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SideRelationRow({
  href,
  label,
  rating,
  count,
}: {
  href: string;
  label: string;
  rating?: number | null;
  count?: number | null;
}) {
  return (
    <div className="flex items-baseline gap-2 py-1.5 text-[13px]">
      <RouterAriaLink
        to={href}
        className="min-w-0 shrink truncate text-accent no-underline"
      >
        {label}
      </RouterAriaLink>
      {rating != null ? (
        <span className="tabular shrink-0 font-medium text-accent">
          {rating.toFixed(1)}
        </span>
      ) : null}
      {count ? (
        <span className="tabular shrink-0 text-[12px] text-muted">
          ({count})
        </span>
      ) : null}
    </div>
  );
}

export function CourseDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const recognitionVariant = useReviewRecognitionPrototypeVariant();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [reviewsError, setReviewsError] = useState("");
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewSort, setReviewSort] = useState<CourseReviewSort>("recognized");
  const [reviewTerm, setReviewTerm] = useState("all");
  const [reviewRating, setReviewRating] = useState("all");
  const [filteredReviewTotal, setFilteredReviewTotal] = useState(0);
  const [teacherCourses, setTeacherCourses] = useState<Course[] | null>(null);

  /** 评价按 课程×教师 展示：URL `teacher` 参数记录选中的任课教师；
   * 未选或选中值不在任课表内时落到点评数最多的关系（Issue #402）。 */
  const selectedTeacherId = useMemo(() => {
    const raw = new URLSearchParams(location.search).get("teacher");
    if (!raw || !/^-?(?:0|[1-9]\d*)$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }, [location.search]);

  const course = data?.course ?? null;
  const teachers = course?.teachers ?? [];
  const selectedTeacher =
    teachers.find((teacher) => teacher.id === selectedTeacherId) ??
    teachers[0] ??
    null;
  const effectiveTeacherId = selectedTeacher?.id ?? null;
  const relationTerms = selectedTeacher?.terms ?? [];
  const effectiveReviewTerm = relationTerms.includes(reviewTerm)
    ? reviewTerm
    : "all";
  const teacherQuery = useMemo(() => {
    if (!effectiveTeacherId) return "";
    const query = new URLSearchParams({
      teacherId: String(effectiveTeacherId),
      sort: reviewSort,
    });
    if (effectiveReviewTerm !== "all") query.set("term", effectiveReviewTerm);
    if (reviewRating !== "all") query.set("rating", reviewRating);
    return query.toString();
  }, [effectiveTeacherId, effectiveReviewTerm, reviewRating, reviewSort]);

  const reviewFeed = usePublicReviewPagination("courses", id, teacherQuery);
  /** Session cache of first pages by teacher scope, so switching teachers
   *  restores the previous list instantly instead of losing it (Issue #202).
   *  In-flight promises are shared too, so StrictMode double-effects and the
   *  course-payload arrival never issue a duplicate request. */
  const reviewCacheRef = useRef(new Map<string, PublicReviewPage>());
  const reviewInflightRef = useRef(new Map<string, Promise<PublicReviewPage>>());
  const submitted = Boolean(
    (location.state as { submitted?: boolean } | null)?.submitted,
  );

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
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

  useEffect(() => {
    let cancelled = false;
    setReviewsError("");
    if (!course || !effectiveTeacherId) {
      reviewFeed.reset([], null);
      setFilteredReviewTotal(0);
      setReviewsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const cacheKey = `${id}:${teacherQuery}`;
    // 刚提交的评价立刻公开：绕过会话缓存重拉第一页。
    if (submitted) reviewCacheRef.current.delete(cacheKey);
    const cached = reviewCacheRef.current.get(cacheKey);
    if (cached) {
      reviewFeed.reset(cached.items, cached.nextCursor);
      setFilteredReviewTotal(cached.total ?? cached.items.length);
      setReviewsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    reviewFeed.reset([], null);
    setReviewsLoading(true);
    let promise = reviewInflightRef.current.get(cacheKey);
    if (!promise) {
      promise = api<PublicReviewPage>(
        `/api/courses/${id}/reviews?${teacherQuery}`,
      );
      reviewInflightRef.current.set(cacheKey, promise);
      promise
        .then((page) => {
          reviewCacheRef.current.set(cacheKey, page);
          reviewInflightRef.current.delete(cacheKey);
        })
        .catch(() => {
          reviewInflightRef.current.delete(cacheKey);
        });
    }
    promise
      .then((page) => {
        if (!cancelled) {
          reviewFeed.reset(page.items, page.nextCursor);
          setFilteredReviewTotal(page.total ?? page.items.length);
        }
      })
      .catch((e) => {
        if (!cancelled) setReviewsError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setReviewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, course, effectiveTeacherId, teacherQuery, reviewFeed.reset, submitted]);

  /** 加载更多成功后把完整已加载列表回写进会话缓存，切走再切回时整页恢复。 */
  const handleLoadMore = useCallback(async () => {
    const accumulated = await reviewFeed.loadMore();
    if (accumulated) {
      reviewCacheRef.current.set(`${id}:${teacherQuery}`, accumulated);
    }
  }, [reviewFeed.loadMore, id, teacherQuery]);

  // 右侧栏「这位老师的其他课」：按选中教师拉取其任课课程。
  useEffect(() => {
    setTeacherCourses(null);
    if (!effectiveTeacherId) return;
    let cancelled = false;
    api<{ courses?: Course[] }>(`/api/teachers/${effectiveTeacherId}`)
      .then((d) => {
        if (!cancelled) setTeacherCourses(d.courses ?? []);
      })
      .catch(() => {
        if (!cancelled) setTeacherCourses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveTeacherId]);

  // /latest 的「>>更多」深链：评价到达后滚动到对应条目。
  const scrolledHashRef = useRef("");
  useEffect(() => {
    scrolledHashRef.current = "";
  }, [id]);
  useLayoutEffect(() => {
    const raw = location.hash.replace(/^#/, "");
    if (!raw || scrolledHashRef.current === raw) return;
    let target = raw;
    try {
      target = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    const el = document.getElementById(target);
    if (el) {
      scrolledHashRef.current = raw;
      el.scrollIntoView({ block: "start" });
    }
  }, [location.hash, data, reviewFeed.reviews]);

  if (error) {
    return (
      <section className="mx-auto w-full max-w-[1360px]">
        <DetailErrorAlert title="课程加载失败" message={error} />
      </section>
    );
  }
  if (!data || !course) {
    return (
      <section className="mx-auto w-full max-w-[1360px]">
        <DetailPageSkeleton label="课程加载中…" kind="course-reviews" />
      </section>
    );
  }

  const rating = selectedTeacher?.rating ?? null;
  const relationCount = selectedTeacher?.review_count ?? 0;
  const otherTeachers = teachers.filter(
    (teacher) => teacher.id !== effectiveTeacherId,
  );
  const teacherOtherCourses = (teacherCourses ?? []).filter(
    (item) => item.id !== course.id,
  );
  /** 当前关系已有总结时展示真实 AI 总结（#401）；未生成时保留占位块。 */
  const relationSummary =
    effectiveTeacherId && data.summaries
      ? data.summaries[String(effectiveTeacherId)]
      : undefined;
  /** 返回目录时恢复目录查询状态（去掉详情页自有的 teacher/原型参数）。 */
  const catalogHref = (() => {
    const sp = new URLSearchParams(location.search);
    sp.delete("module");
    sp.delete("variant");
    sp.delete("teacher");
    const q = sp.toString();
    return q ? `/courses?${q}` : "/courses";
  })();
  const relationHref = (teacherId: number) => {
    const sp = new URLSearchParams(location.search);
    sp.set("teacher", String(teacherId));
    return `/courses/${course.id}?${sp.toString()}`;
  };
  const metaRows: Array<[string, string]> = [
    ["选课类别", course.enrollment_category || "—"],
    ["教学类型", course.teaching_type || "—"],
    ["课程类别", categoryLabel(course.category)],
    ["开课单位", course.department || "—"],
    ["课程层次", course.course_level || "—"],
    ["学分", course.credits != null ? String(course.credits) : "—"],
  ];
  const comparingRecognition =
    Boolean(recognitionVariant) && Boolean(ReviewRecognitionPrototypeLazy);

  return (
    <div className="mx-auto grid w-full max-w-[1360px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <nav aria-label="面包屑" className="text-[12px] text-muted">
          <RouterAriaLink to={catalogHref} className="text-muted">
            课程目录
          </RouterAriaLink>
          <span className="mx-1.5">/</span>
          {course.name}
        </nav>

        {submitted ? (
          <p
            className="mt-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-[13px] text-success"
            role="status"
          >
            评价已发布，感谢分享。
          </p>
        ) : null}

        <header className="mt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Typography
              className="m-0 min-w-0 text-[22px] font-bold leading-tight text-accent"
              type="h1"
            >
              {course.name}
              {selectedTeacher ? (
                <span className="font-semibold">
                  （{selectedTeacher.name}）
                </span>
              ) : null}
            </Typography>
            <p className="m-0 shrink-0 text-right text-[12px] text-muted">
              课程号：{course.code || "—"}
            </p>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <Stars rating={rating} className="text-[16px]" />
            {rating != null ? (
              <span className="tabular text-[20px] font-semibold leading-none text-accent">
                {rating.toFixed(1)}
              </span>
            ) : null}
            {relationCount > 0 ? (
              <span className="text-[12px] text-muted">
                （{relationCount} 人评价）
              </span>
            ) : (
              <span className="text-[13px] text-muted">暂无评价</span>
            )}
          </div>

          <FourDimLine
            className="mt-2 text-[13px]"
            labels={fourDimLineLabels(selectedTeacher?.dimensionLabels)}
          />
          {relationTerms.length ? (
            <p className="mb-0 mt-2 min-w-0 truncate text-[11px] text-muted">
              学期 {relationTerms.join(" ")}
            </p>
          ) : null}

          <dl className="mb-0 mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
            {metaRows.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="shrink-0 text-muted">{label}：</dt>
                <dd className="m-0 text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          {selectedTeacher ? (
            <RelationSignalControls
              courseId={course.id}
              teacher={selectedTeacher}
            />
          ) : null}
        </header>

        {relationSummary?.html ? (
          <div className="mt-10">
            <CourseAiSummary summary={relationSummary} />
          </div>
        ) : (
          <section className="mt-10" aria-labelledby="course-ai-summary-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Typography
                className="m-0 text-[20px] font-bold leading-snug text-accent"
                id="course-ai-summary-heading"
                type="h2"
              >
                AI 总结
              </Typography>
              <p className="m-0 text-[12px] text-muted">
                AI 总结为根据点评内容自动生成，仅供参考
              </p>
            </div>
            <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-secondary/60 px-4 py-4 text-[13px] text-muted">
              {relationCount > 0
                ? "AI 总结暂未生成：点评积累后会自动出现在这里。"
                : "点评还不够，暂时无法生成总结。"}
            </div>
          </section>
        )}

        {comparingRecognition &&
        recognitionVariant &&
        ReviewRecognitionPrototypeLazy ? (
          <Suspense fallback={<EmptyBox role="status">加载认可原型…</EmptyBox>}>
            <ReviewRecognitionPrototypeLazy
              key={recognitionVariant}
              variant={recognitionVariant}
              model={{ hostLabel: course.name }}
            />
          </Suspense>
        ) : (
          <CourseReviewSection
            courseId={course.id}
            teacherId={effectiveTeacherId}
            terms={relationTerms}
            sort={reviewSort}
            term={effectiveReviewTerm}
            rating={reviewRating}
            onSortChange={setReviewSort}
            onTermChange={setReviewTerm}
            onRatingChange={setReviewRating}
            reviews={reviewFeed.reviews}
            total={filteredReviewTotal}
            loading={reviewsLoading}
            error={reviewsError}
            hasMore={Boolean(reviewFeed.nextCursor)}
            isLoadingMore={reviewFeed.isLoadingMore}
            loadMoreError={reviewFeed.loadMoreError}
            onLoadMore={handleLoadMore}
          />
        )}
      </div>

      <aside className="space-y-3 self-start">
        {selectedTeacher ? (
          <section
            aria-label="任课教师"
            className="border border-dashed border-border bg-surface-secondary/60 px-3 py-3"
          >
            <div className="flex flex-col items-center text-center">
              <AnonymousAvatar
                seed={selectedTeacher.id}
                size="lg"
                fallback={selectedTeacher.name.slice(0, 1)}
              />
              <p className="m-0 mt-2 text-[16px] font-bold text-accent">
                {selectedTeacher.name}
              </p>
            </div>
          </section>
        ) : null}

        <SidePanel title={`其他老师的「${course.name}」课`}>
          {otherTeachers.length === 0 ? (
            <p className="m-0 py-1.5 text-[12px] text-muted">
              这门课目前只有这位老师
            </p>
          ) : (
            otherTeachers.map((teacher) => (
              <SideRelationRow
                key={teacher.id}
                href={relationHref(teacher.id)}
                label={teacher.name}
                rating={teacher.rating}
                count={teacher.review_count}
              />
            ))
          )}
        </SidePanel>

        {selectedTeacher ? (
          <SidePanel title={`${selectedTeacher.name}老师的其他课`}>
            {teacherCourses == null ? (
              <p className="m-0 py-1.5 text-[12px] text-muted">加载中…</p>
            ) : teacherOtherCourses.length === 0 ? (
              <p className="m-0 py-1.5 text-[12px] text-muted">
                这位老师目前只开这门课
              </p>
            ) : (
              teacherOtherCourses.map((item) => (
                <SideRelationRow
                  key={item.id}
                  href={`/courses/${item.id}?teacher=${effectiveTeacherId}`}
                  label={item.name}
                  rating={item.rating}
                  count={item.review_count}
                />
              ))
            )}
          </SidePanel>
        ) : null}

        <RouterAriaLink
          to={catalogHref}
          className="block text-center text-[12px] text-muted no-underline"
        >
          ← 返回课程目录
        </RouterAriaLink>
      </aside>
    </div>
  );
}
