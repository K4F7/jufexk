/**
 * 课程详情 /courses/:id?teacher= — USTC 评课社区对齐（Issue #402）。
 * 页面始终按 课程×教师 关系展示：未带 teacher 参数时落到点评数最多的关系。
 * 左栏：面包屑 / 课程头（课名（老师）· 课程号 · 星级推荐度 · 四维 ·
 * 元信息网格 · 关注/推荐/不推荐）/ AI 总结 / 点评区。
 *
 * DEV-only: ?module=review-recognition 替换点评区为 #74 原型。
 */
import { Alert, Breadcrumbs, Card, Typography, buttonVariants } from "@heroui/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { AnonymousAvatar } from "../components/AnonymousAvatar";
import { CourseAdminNotice } from "../components/CourseAdminNotice";
import { CourseAiSummary } from "../components/CourseAiSummary";
import {
  CourseReviewSection,
  type CourseReviewSort,
} from "../components/CourseReviewSection";
import {
  DetailErrorAlert,
  DetailPageSkeleton,
} from "../components/DetailFeedback";
import { FourDimLine } from "../components/FourDimLine";
import { RelationSignalControls } from "../components/RelationSignalControls";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { Stars } from "../components/Stars";
import { usePublicReviewPagination } from "../hooks/usePublicReviewPagination";
import { api } from "../lib/api";
import { fourDimLineLabels } from "../lib/dimension-labels";
import { categoryLabel, formatCredits } from "../lib/labels";
import { reviewAnchorId } from "../lib/review-dimensions";
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
  if (!import.meta.env.DEV) return null;
  if (params.get("module") !== "review-recognition") return null;
  const key = (params.get("variant") || "A").toUpperCase();
  if (key === "A" || key === "B" || key === "C") return key;
  return "A";
}

const TEACHER_ID_RE = /^-?(?:0|[1-9]\d*)$/;

function parseTeacherId(search: string): number | null {
  const raw = new URLSearchParams(search).get("teacher");
  if (!raw || !TEACHER_ID_RE.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function decodeHashTarget(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function getOrLoad<T>(
  cache: Map<string, T>,
  inflight: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  let promise = inflight.get(key);
  if (!promise) {
    promise = load()
      .then((value) => {
        cache.set(key, value);
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, promise);
  }
  return promise;
}

/** 右侧栏官方 Card（任课教师 / 其他老师 / 这位老师的其他课）。
 *  列表 Card.Title 用短标题，避免课名/教师名跟页面主标题的
 *  getByRole("heading") 查询撞车。 */
function SidePanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
  );
}

function SideRelationRow({
  href,
  label,
  code,
  rating,
  count,
}: {
  href: string;
  label: string;
  code?: string;
  rating?: number | null;
  count?: number | null;
}) {
  const stats = [
    rating != null ? rating.toFixed(1) : null,
    count ? `(${count})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="min-w-0">
        <RouterAriaLink className="min-w-0 truncate" to={href}>
          {label}
        </RouterAriaLink>
        {code ? (
          <span className="block truncate text-xs text-muted">{code}</span>
        ) : null}
      </span>
      {stats ? (
        <span className="tabular shrink-0 text-xs text-muted">{stats}</span>
      ) : null}
    </li>
  );
}

export function CourseDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
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
  /** 管理动作（屏蔽/删除）后 bump：清空评价会话缓存并重拉第一页。 */
  const [reviewsVersion, setReviewsVersion] = useState(0);

  /** 评价按 课程×教师 展示：URL `teacher` 参数记录选中的任课教师；
   * 未选或选中值不在任课表内时落到点评数最多的关系（Issue #402）。
   * URL 已带教师时先按该 ID 拉评价 / 教师课表，与课程详情并行。
   * 路由 id 已变但仍握着上一门课的 data 时当作未就绪，避免用错教师。 */
  const urlTeacherId = parseTeacherId(location.search);
  const course =
    data?.course != null && id != null && data.course.id === Number(id)
      ? data.course
      : null;
  const teachers = course?.teachers ?? [];
  const selectedTeacher =
    (urlTeacherId != null
      ? teachers.find((teacher) => teacher.id === urlTeacherId)
      : undefined) ??
    teachers[0] ??
    null;
  /** 课程到达后只用校验过的任课教师；加载中可先按 URL 教师并行拉评价。 */
  const effectiveTeacherId = course ? selectedTeacher?.id : urlTeacherId;
  const relationTerms = selectedTeacher?.terms ?? [];
  const effectiveReviewTerm = relationTerms.includes(reviewTerm)
    ? reviewTerm
    : "all";
  let teacherQuery = "";
  if (effectiveTeacherId) {
    const query = new URLSearchParams({
      teacherId: String(effectiveTeacherId),
      sort: reviewSort,
    });
    if (effectiveReviewTerm !== "all") query.set("term", effectiveReviewTerm);
    if (reviewRating !== "all") query.set("rating", reviewRating);
    teacherQuery = query.toString();
  }

  const reviewFeed = usePublicReviewPagination("courses", id, teacherQuery);
  /** Session cache of first pages by teacher scope, so switching teachers
   *  restores the previous list instantly instead of losing it (Issue #202).
   *  In-flight promises are shared too, so StrictMode double-effects and the
   *  course-payload arrival never issue a duplicate request. */
  const reviewCacheRef = useRef(new Map<string, PublicReviewPage>());
  const reviewInflightRef = useRef(new Map<string, Promise<PublicReviewPage>>());
  const teacherCoursesCacheRef = useRef(new Map<string, Course[]>());
  const teacherCoursesInflightRef = useRef(
    new Map<string, Promise<Course[]>>(),
  );
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
    if (!course) return;
    const params = new URLSearchParams(location.search);
    if (!params.has("teacher")) return;
    const relationTeachers = course.teachers ?? [];
    const valid =
      urlTeacherId != null &&
      relationTeachers.some((teacher) => teacher.id === urlTeacherId);
    if (valid) return;
    const next = new URLSearchParams(location.search);
    const fallbackId = relationTeachers[0]?.id;
    if (fallbackId != null) next.set("teacher", String(fallbackId));
    else next.delete("teacher");
    const search = next.toString();
    if (search === params.toString()) return;
    navigate(
      {
        pathname: location.pathname,
        search: search ? `?${search}` : "",
        hash: location.hash,
      },
      { replace: true },
    );
  }, [
    course,
    urlTeacherId,
    location.hash,
    location.pathname,
    location.search,
    navigate,
  ]);

  /** 管理员公告保存后重拉课程详情（只刷新课程载荷，不动评价缓存）。 */
  const reloadCourse = useCallback(async () => {
    try {
      setData(await api<Detail>(`/api/courses/${id}`));
    } catch {
      /* 保留旧数据；下次进入页面会重试 */
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setReviewsError("");
    if (!id || !effectiveTeacherId) {
      reviewFeed.reset([], null);
      setFilteredReviewTotal(0);
      setReviewsLoading(false);
      return;
    }
    const cacheKey = `${id}:${teacherQuery}`;
    // 刚提交的评价立刻公开：绕过会话缓存重拉第一页。
    if (submitted) reviewCacheRef.current.delete(cacheKey);
    const cached = reviewCacheRef.current.get(cacheKey);
    if (cached) {
      reviewFeed.reset(cached.items, cached.nextCursor);
      setFilteredReviewTotal(cached.total ?? cached.items.length);
      setReviewsLoading(false);
      return;
    }
    reviewFeed.reset([], null);
    setReviewsLoading(true);
    getOrLoad(
      reviewCacheRef.current,
      reviewInflightRef.current,
      cacheKey,
      () =>
        api<PublicReviewPage>(`/api/courses/${id}/reviews?${teacherQuery}`),
    )
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
  }, [id, effectiveTeacherId, teacherQuery, reviewFeed.reset, submitted, reviewsVersion]);

  /** 管理动作（屏蔽/解除/删除）后：清空评价会话缓存并 bump 版本重拉。 */
  const handleReviewsChanged = useCallback(() => {
    reviewCacheRef.current.clear();
    setReviewsVersion((v) => v + 1);
  }, []);

  /** 加载更多成功后把完整已加载列表回写进会话缓存，切走再切回时整页恢复。 */
  const handleLoadMore = useCallback(async () => {
    const accumulated = await reviewFeed.loadMore();
    if (accumulated) {
      reviewCacheRef.current.set(`${id}:${teacherQuery}`, accumulated);
    }
  }, [reviewFeed.loadMore, id, teacherQuery]);

  // 右侧栏「这位老师的其他课」：按选中教师拉取其任课课程。
  useEffect(() => {
    if (!effectiveTeacherId) {
      setTeacherCourses(null);
      return;
    }
    const cacheKey = String(effectiveTeacherId);
    const cached = teacherCoursesCacheRef.current.get(cacheKey);
    if (cached) {
      setTeacherCourses(cached);
      return;
    }
    setTeacherCourses(null);
    let cancelled = false;
    getOrLoad(
      teacherCoursesCacheRef.current,
      teacherCoursesInflightRef.current,
      cacheKey,
      () =>
        api<{ courses?: Course[] }>(`/api/teachers/${effectiveTeacherId}`).then(
          (d) => d.courses ?? [],
        ),
    )
      .then((courses) => {
        if (!cancelled) setTeacherCourses(courses);
      })
      .catch(() => {
        if (!cancelled) setTeacherCourses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveTeacherId]);

  // /latest 的「查看全文」深链：评价到达后滚动到对应条目。
  const scrolledHashRef = useRef("");
  const hashChaseDoneRef = useRef("");
  const hashChaseScopeRef = useRef("");
  const hashChaseScope = `${id}:${effectiveTeacherId ?? ""}:${location.hash}`;
  if (hashChaseScopeRef.current !== hashChaseScope) {
    hashChaseScopeRef.current = hashChaseScope;
    scrolledHashRef.current = "";
    hashChaseDoneRef.current = "";
  }
  useLayoutEffect(() => {
    const raw = location.hash.replace(/^#/, "");
    if (!raw || scrolledHashRef.current === raw) return;
    const target = decodeHashTarget(raw);
    const el = document.getElementById(target);
    if (el) {
      scrolledHashRef.current = raw;
      hashChaseDoneRef.current = raw;
      el.scrollIntoView({ block: "start" });
    }
  }, [location.hash, data, reviewFeed.reviews]);

  /** hash 不在已加载列表且还有下一页时继续 loadMore；失败或没有更多则停。 */
  useEffect(() => {
    const raw = location.hash.replace(/^#/, "");
    if (!raw || hashChaseDoneRef.current === raw) return;
    if (scrolledHashRef.current === raw) {
      hashChaseDoneRef.current = raw;
      return;
    }
    if (!course || reviewsLoading || recognitionVariant) return;
    if (reviewsError) {
      hashChaseDoneRef.current = raw;
      return;
    }
    const target = decodeHashTarget(raw);
    if (
      reviewFeed.reviews.some((review) => reviewAnchorId(review.id) === target)
    ) {
      return;
    }
    if (reviewFeed.loadMoreError) {
      hashChaseDoneRef.current = raw;
      return;
    }
    if (!reviewFeed.nextCursor) {
      hashChaseDoneRef.current = raw;
      return;
    }
    if (reviewFeed.isLoadingMore) return;
    void handleLoadMore();
  }, [
    location.hash,
    course,
    reviewsLoading,
    reviewsError,
    recognitionVariant,
    reviewFeed.reviews,
    reviewFeed.nextCursor,
    reviewFeed.isLoadingMore,
    reviewFeed.loadMoreError,
    handleLoadMore,
  ]);

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
    ["学分", formatCredits(course.credits)],
  ];
  const comparingRecognition =
    Boolean(recognitionVariant) && Boolean(ReviewRecognitionPrototypeLazy);

  return (
    <div className="mx-auto grid w-full max-w-[1360px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <nav aria-label="面包屑">
          <Breadcrumbs>
            <Breadcrumbs.Item href={catalogHref}>课程目录</Breadcrumbs.Item>
            <Breadcrumbs.Item>{course.name}</Breadcrumbs.Item>
          </Breadcrumbs>
        </nav>

        {submitted ? (
          <Alert className="mt-3" status="success">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>评价已发布，感谢分享。</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : null}

        <header className="mt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Typography
              className="m-0 min-w-0 text-[calc(22/15*1rem)] font-bold leading-tight text-accent"
              type="h1"
            >
              {course.name}
              {selectedTeacher ? (
                <span className="font-semibold">
                  （{selectedTeacher.name}）
                </span>
              ) : null}
            </Typography>
            <p className="m-0 shrink-0 text-right text-[calc(12/15*1rem)] text-muted">
              课程号：{course.code || "—"}
            </p>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <Stars rating={rating} className="text-[calc(16/15*1rem)]" />
            {rating != null ? (
              <span className="tabular text-[calc(20/15*1rem)] font-semibold leading-none text-accent">
                {rating.toFixed(1)}
              </span>
            ) : null}
            {relationCount > 0 ? (
              <span className="text-[calc(12/15*1rem)] text-muted">
                （{relationCount} 人评价）
              </span>
            ) : (
              <span className="text-[calc(13/15*1rem)] text-muted">暂无评价</span>
            )}
          </div>

          <FourDimLine
            className="mt-2 text-[calc(13/15*1rem)]"
            labels={fourDimLineLabels(selectedTeacher?.dimensionLabels)}
          />
          {relationTerms.length ? (
            <p className="mb-0 mt-2 min-w-0 truncate text-[calc(11/15*1rem)] text-muted">
              学期 {relationTerms.join(" ")}
            </p>
          ) : null}

          <dl className="mb-0 mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-[calc(13/15*1rem)] sm:grid-cols-2">
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

          {/* 课程管理员公告：公开卡片 + 管理员编辑面板。 */}
          <CourseAdminNotice
            courseId={course.id}
            notice={course.admin_notice ?? ""}
            updatedAt={course.admin_notice_updated_at}
            onSaved={reloadCourse}
          />
        </header>

        {relationSummary?.html ? (
          <div className="mt-10">
            <CourseAiSummary summary={relationSummary} />
          </div>
        ) : (
          <section className="mt-10" aria-labelledby="course-ai-summary-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Typography
                className="m-0 text-[calc(20/15*1rem)] font-bold leading-snug text-accent"
                id="course-ai-summary-heading"
                type="h2"
              >
                AI 总结
              </Typography>
              <p className="m-0 text-[calc(12/15*1rem)] text-muted">
                AI 总结为根据点评内容自动生成，仅供参考
              </p>
            </div>
            <Card className="mt-4">
              <Card.Content>
                <p className="m-0 text-sm text-muted">
                  {relationCount > 0
                    ? "AI 总结暂未生成：点评积累后会自动出现在这里。"
                    : "点评还不够，暂时无法生成总结。"}
                </p>
              </Card.Content>
            </Card>
          </section>
        )}

        {comparingRecognition &&
        recognitionVariant &&
        ReviewRecognitionPrototypeLazy ? (
          <Suspense
            fallback={
              <p className="mt-4 text-sm text-muted" role="status">
                加载认可原型…
              </p>
            }
          >
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
            onReviewChanged={handleReviewsChanged}
          />
        )}
      </div>

      <aside className="space-y-3 self-start">
        {selectedTeacher ? (
          <Card aria-label="任课教师">
            <RouterAriaLink
              aria-label={`${selectedTeacher.name}的教师主页`}
              className="block! w-full! rounded-none! no-underline hover:bg-transparent hover:no-underline!"
              to={`/teachers/${selectedTeacher.id}`}
            >
              <Card.Header className="items-center text-center">
                <AnonymousAvatar
                  seed={selectedTeacher.id}
                  size="lg"
                  fallback={selectedTeacher.name.slice(0, 1)}
                />
                <Card.Title className="text-accent">
                  {selectedTeacher.name}
                </Card.Title>
                {selectedTeacher.department ? (
                  <Card.Description>{selectedTeacher.department}</Card.Description>
                ) : null}
              </Card.Header>
            </RouterAriaLink>
          </Card>
        ) : null}

        <SidePanel title="其他老师的这门课">
          {otherTeachers.length === 0 ? (
            <p className="m-0 text-sm text-muted">这门课目前只有这位老师</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {otherTeachers.map((teacher) => (
                <SideRelationRow
                  key={teacher.id}
                  href={relationHref(teacher.id)}
                  label={teacher.name}
                  rating={teacher.rating}
                  count={teacher.review_count}
                />
              ))}
            </ul>
          )}
        </SidePanel>

        {selectedTeacher ? (
          <SidePanel title="这位老师的其他课">
            {teacherCourses == null ? (
              <p className="m-0 text-sm text-muted">加载中…</p>
            ) : teacherOtherCourses.length === 0 ? (
              <p className="m-0 text-sm text-muted">这位老师目前只开这门课</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {teacherOtherCourses.map((item) => (
                  <SideRelationRow
                    key={item.id}
                    href={`/courses/${item.id}?teacher=${effectiveTeacherId}`}
                    label={item.name}
                    code={item.code || undefined}
                    rating={item.rating}
                    count={item.review_count}
                  />
                ))}
              </ul>
            )}
          </SidePanel>
        ) : null}

        <RouterAriaLink
          className={`${buttonVariants({
            fullWidth: true,
            size: "sm",
            variant: "ghost",
          })} justify-center no-underline`}
          to={catalogHref}
        >
          ← 返回课程目录
        </RouterAriaLink>
      </aside>
    </div>
  );
}
