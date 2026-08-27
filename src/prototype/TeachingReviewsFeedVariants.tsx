/**
 * PROTOTYPE — teaching-reviews-feed (throwaway; not production-ready).
 *
 * Question (issue #71 / module 12, 承接 #68): 课程与教师详情上，共享的匿名
 * 「任课评价」文字流应如何呈现条目结构、counterpart 身份与统计摘要？
 *
 * 单强提案（规格已收口）：Separator 紧凑列表 · 无逐维度 Chip · 无维度均分 ·
 * 仅有补充说明入流 · 课程页强调教师 / 教师页强调课程 · 文案「任课评价」·
 * 无作者身份。维度均分等待 #66；历史资料 #69；认可 #70。
 *
 * A — 匿名文字流：身份真链接 · 总体评分 · 正文 · 发布时间
 *
 * Mounted via CourseDetailPage / TeacherDetailPage when
 * ?module=teaching-reviews-feed&variant=A (DEV only).
 */
import { Link, Separator } from "@heroui/react";
import { useMemo, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { Review } from "../lib/types";

export type TeachingReviewsFeedVariantKey = "A";

const KEYS: TeachingReviewsFeedVariantKey[] = ["A"];

export function isTeachingReviewsFeedVariantKey(
  key: string,
): key is TeachingReviewsFeedVariantKey {
  return (KEYS as string[]).includes(key);
}

/** Shared feed entry — one course-teacher review projection. */
export type TeachingReviewsFeedEntry = {
  id: number;
  note: string;
  /** ISO-ish timestamp or null; never invent a date. */
  publishedAt: string | null;
  /**
   * Available overall score (display contract from #66; not redefined here).
   * Shown as 总体评分 when present; never fabricated.
   */
  score: number | null;
  teacherId: number | null;
  teacherName: string | null;
  courseId: number | null;
  courseName: string | null;
};

export type TeachingReviewsFeedModel = {
  /** Course page → teacher links; teacher page → course links. */
  counterpartMode: "teacher" | "course";
  /** Host entity label for a11y / state dump */
  hostLabel: string;
  /** Optional live reviews — used when demo source is "api". */
  liveReviews?: Review[];
  /** Live total approved ratings when known (includes rating-only). */
  liveRatingCount?: number;
};

const VARIANT_HINT: Record<
  TeachingReviewsFeedVariantKey,
  { title: string; lookFor: string }
> = {
  A: {
    title: "A — 匿名任课评价文字流",
    lookFor:
      "标题「任课评价」· 共 N 份评分 / M 条有补充说明 · 身份真链接 · 总体评分 · 发布时间 · 无逐维度 Chip · 无维度均分 · 无作者",
  },
};

type DemoSource = "demo" | "api";

/**
 * DEMO — wipe after visual freeze (#71).
 * Covers: long note, long teacher/course names, missing
 * publishedAt, null identity, rating-only excluded from feed.
 */
const DEMO_ENTRIES: TeachingReviewsFeedEntry[] = [
  {
    id: -101,
    note: "例题扎实，作业量适中。课堂节奏清晰，适合有一定会计基础的同学。期末复习提纲会提前发，开卷但题量大。",
    publishedAt: "2025-06-18T10:20:00Z",
    score: 4.6,
    teacherId: 1,
    teacherName: "林晓雯",
    courseId: 1,
    courseName: "中级财务会计",
  },
  {
    id: -102,
    note: "节奏偏快，建议提前预习。点名不固定；小组报告占比高。给分中等偏上，想刷 GPA 的同学要做好时间管理。",
    publishedAt: "2025-01-09T08:00:00Z",
    score: 4,
    teacherId: 2,
    teacherName: "陈启明·金融学院货币金融学教研室（演示用超长姓名）",
    courseId: 2,
    courseName: "货币金融学",
  },
  {
    id: -103,
    note: "这是一条刻意写得很长的补充说明，用来检查折行与扫描密度：课堂案例多、板书清晰，但作业反馈偏慢；考核以闭卷为主，题型覆盖面广，复习时建议按章节做历年题。选课前如果已经修过相关先修课，会轻松很多；反之则需要额外补基础。整体体验是「收获大、投入也不小」。",
    publishedAt: "2024-07-02T14:30:00Z",
    score: 5,
    teacherId: 3,
    teacherName: "王若舟",
    courseId: 3,
    courseName:
      "微观经济学（含实验模块 · 跨学院双学位选修 · 演示超长课程名）",
  },
  {
    id: -104,
    note: "旧数据：只有文字说明；发布时间仍诚实显示。",
    publishedAt: "2022-12-01T00:00:00Z",
    score: 3,
    teacherId: 4,
    teacherName: "赵敏",
    courseId: 4,
    courseName: "法理学",
  },
  {
    id: -105,
    note: "发布时间未知时的诚实回退。评分可用；counterpart 身份也缺失时不伪造链接。",
    publishedAt: null,
    score: 4,
    teacherId: null,
    teacherName: null,
    courseId: null,
    courseName: null,
  },
  {
    id: -106,
    note: "体育课：强度适中，考核以出勤与技能测试为主。",
    publishedAt: "2025-03-20T11:00:00Z",
    score: 4.5,
    teacherId: 6,
    teacherName: "周慧",
    courseId: 10,
    courseName: "羽毛球",
  },
  {
    id: -107,
    note: "无总体评分时只展示身份与正文，不编造分数。",
    publishedAt: "2023-01-15T09:00:00Z",
    score: null,
    teacherId: 7,
    teacherName: "何清",
    courseId: 11,
    courseName: "高等数学 A",
  },
];

/** Rating-only approved reviews (must not appear in the text feed). */
const DEMO_RATING_ONLY_COUNT = 7;
const DEMO_TOTAL_RATINGS = DEMO_ENTRIES.length + DEMO_RATING_ONLY_COUNT;

function mergeStopPropagation(
  onClick?: (e: React.MouseEvent) => void,
): (e: React.MouseEvent) => void {
  return (e) => {
    e.stopPropagation();
    onClick?.(e);
  };
}

function RouterAriaLink({
  to,
  href,
  className,
  children,
}: {
  to: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      render={(domProps) => (
        <RouterLink
          {...(domProps as object)}
          to={to}
          className={
            typeof domProps.className === "string"
              ? domProps.className
              : undefined
          }
          onClick={mergeStopPropagation(
            (domProps as { onClick?: (ev: React.MouseEvent) => void }).onClick,
          )}
        />
      )}
    >
      {children}
    </Link>
  );
}

function formatPublishedAt(iso: string | null): string {
  if (!iso) return "发布时间未标注";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "发布时间未标注";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatScore(score: number | null): string | null {
  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    return null;
  }
  const n = Number(score);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function noteText(r: Review): string {
  return (r.comment || "").trim();
}

/**
 * Map live Review rows → feed entries.
 * Rating-only (empty note) are dropped. Dimension averages are out of MVP
 * scope for this freeze gate (#71 / #66).
 */
function mapLiveReviews(reviews: Review[]): TeachingReviewsFeedEntry[] {
  return (reviews ?? [])
    .filter((r) => noteText(r).length > 0)
    .map((r) => ({
      id: r.id,
      note: noteText(r),
      publishedAt:
        typeof (r as { created_at?: string }).created_at === "string"
          ? ((r as { created_at?: string }).created_at as string)
          : null,
      score:
        r.overall === null || r.overall === undefined
          ? null
          : Number(r.overall),
      teacherId: r.teacher_id ?? null,
      teacherName: r.teacher_name?.trim() ? r.teacher_name : null,
      courseId: r.course_id ?? null,
      courseName: r.course_name?.trim() ? r.course_name : null,
    }))
    .sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      if (tb !== ta) return tb - ta;
      return b.id - a.id;
    });
}

function PrototypeBanner({
  variant,
  source,
  onSource,
  counterpartMode,
  ratingCount,
  noteCount,
}: {
  variant: TeachingReviewsFeedVariantKey;
  source: DemoSource;
  onSource: (s: DemoSource) => void;
  counterpartMode: "teacher" | "course";
  ratingCount: number;
  noteCount: number;
}) {
  const hint = VARIANT_HINT[variant];
  return (
    <div
      className="mb-4 rounded-lg border border-dashed border-accent/40 bg-accent-soft/40 px-3 py-2 text-xs text-muted"
      role="note"
    >
      <div>
        <strong className="text-foreground">{hint.title}</strong>
        <span className="mx-1.5 text-border">·</span>
        看：{hint.lookFor}
      </div>
      <div className="mt-1.5 text-[11px] text-muted">
        身份方向：
        <strong className="text-foreground">
          {counterpartMode === "teacher"
            ? "课程页 → 条目强调教师链接"
            : "教师页 → 条目强调课程链接"}
        </strong>
        <span className="mx-1.5 text-border">·</span>
        统计：共 {ratingCount} 份评分 · {noteCount} 条有补充说明
        {source === "demo" ? (
          <>
            <span className="mx-1.5 text-border">·</span>
            <span className="text-warning">
              DEMO 含 {DEMO_RATING_ONLY_COUNT} 条 rating-only（不入流）
            </span>
          </>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted">数据源</span>
        {(
          [
            { key: "demo", label: "DEMO 边界样例" },
            { key: "api", label: "当前页 API" },
          ] as const
        ).map((o) => (
          <button
            key={o.key}
            type="button"
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              source === o.key
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface text-foreground"
            }`}
            onClick={() => onSource(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionHeading({
  ratingCount,
  noteCount,
}: {
  ratingCount: number;
  noteCount: number;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2
        id="teaching-reviews-heading"
        className="m-0 text-[17px] font-bold leading-snug"
      >
        任课评价
      </h2>
      <p className="m-0 text-[13px] text-muted" aria-live="polite">
        共{" "}
        <span className="tabular font-semibold text-foreground">
          {ratingCount}
        </span>{" "}
        份评分，其中{" "}
        <span className="tabular font-semibold text-foreground">
          {noteCount}
        </span>{" "}
        条有补充说明
      </p>
    </div>
  );
}

function EmptyFeed() {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-6 py-6 text-center text-sm text-muted"
    >
      暂无补充说明
    </div>
  );
}

function CounterpartIdentity({
  entry,
  mode,
}: {
  entry: TeachingReviewsFeedEntry;
  mode: "teacher" | "course";
}) {
  if (mode === "teacher") {
    const name = entry.teacherName || "教师未标注";
    if (entry.teacherId) {
      const to = `/teachers/${entry.teacherId}`;
      return (
        <RouterAriaLink
          to={to}
          href={to}
          className="font-semibold text-foreground underline-offset-4 hover:underline"
        >
          {name}
        </RouterAriaLink>
      );
    }
    return <span className="font-semibold text-foreground">{name}</span>;
  }

  const name = entry.courseName || "课程未标注";
  if (entry.courseId) {
    const to = `/courses/${entry.courseId}`;
    return (
      <RouterAriaLink
        to={to}
        href={to}
        className="font-semibold text-foreground underline-offset-4 hover:underline"
      >
        {name}
      </RouterAriaLink>
    );
  }
  return <span className="font-semibold text-foreground">{name}</span>;
}

function FeedEntry({
  entry,
  mode,
  showSeparator,
}: {
  entry: TeachingReviewsFeedEntry;
  mode: "teacher" | "course";
  showSeparator: boolean;
}) {
  const scoreLabel = formatScore(entry.score);
  const published = formatPublishedAt(entry.publishedAt);
  const identityName =
    mode === "teacher"
      ? entry.teacherName || "教师未标注"
      : entry.courseName || "课程未标注";

  const ariaParts = [
    "任课评价",
    identityName,
    scoreLabel ? `总体评分 ${scoreLabel}` : null,
    published,
  ].filter(Boolean);

  return (
    <>
      {showSeparator ? <Separator /> : null}
      <article className="py-4" aria-label={ariaParts.join(" · ")}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <CounterpartIdentity entry={entry} mode={mode} />
          {scoreLabel ? (
            <>
              <span className="text-muted" aria-hidden>
                ·
              </span>
              <span className="tabular font-semibold text-accent">
                {scoreLabel}
                <span className="text-xs font-normal text-muted">/5</span>
              </span>
            </>
          ) : null}
        </div>
        <p className="my-2 text-sm leading-relaxed text-foreground">
          {entry.note}
        </p>
        <p className="m-0 text-xs text-muted">
          <time
            dateTime={entry.publishedAt || undefined}
            aria-label={`发布时间 ${published}`}
          >
            {published}
          </time>
        </p>
      </article>
    </>
  );
}

function VariantA({
  entries,
  mode,
  ratingCount,
}: {
  entries: TeachingReviewsFeedEntry[];
  mode: "teacher" | "course";
  ratingCount: number;
}) {
  const noteCount = entries.length;
  return (
    <section aria-labelledby="teaching-reviews-heading">
      <SectionHeading ratingCount={ratingCount} noteCount={noteCount} />
      {entries.length ? (
        <div role="list" aria-label="任课评价列表">
          {entries.map((e, i) => (
            <div key={e.id} role="listitem">
              <FeedEntry entry={e} mode={mode} showSeparator={i > 0} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyFeed />
      )}
    </section>
  );
}

/**
 * Live host for teaching-reviews-feed.
 * Renders only the 任课评价 section; caller keeps summary / other sections.
 */
export function TeachingReviewsFeedPrototype({
  variant,
  model,
}: {
  variant: TeachingReviewsFeedVariantKey;
  model: TeachingReviewsFeedModel;
}) {
  const [source, setSource] = useState<DemoSource>("demo");

  const { entries, ratingCount } = useMemo(() => {
    if (source === "api") {
      const live = mapLiveReviews(model.liveReviews ?? []);
      const total =
        model.liveRatingCount ??
        (model.liveReviews?.length ?? live.length);
      return { entries: live, ratingCount: total };
    }
    return {
      entries: DEMO_ENTRIES,
      ratingCount: DEMO_TOTAL_RATINGS,
    };
  }, [source, model.liveReviews, model.liveRatingCount]);

  return (
    <div
      data-prototype="teaching-reviews-feed"
      data-variant={variant}
      data-counterpart={model.counterpartMode}
    >
      <PrototypeBanner
        variant={variant}
        source={source}
        onSource={setSource}
        counterpartMode={model.counterpartMode}
        ratingCount={ratingCount}
        noteCount={entries.length}
      />
      {variant === "A" ? (
        <VariantA
          entries={entries}
          mode={model.counterpartMode}
          ratingCount={ratingCount}
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        变体 {variant} ·{" "}
        {model.counterpartMode === "teacher" ? "课程页" : "教师页"} · 评分{" "}
        {ratingCount} · 补充说明 {entries.length} · 数据源 {source} · 宿主{" "}
        {model.hostLabel}
      </p>
    </div>
  );
}
