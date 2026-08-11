/**
 * PROTOTYPE — course-detail-summary variants (throwaway; not production-ready).
 *
 * Question: 课程详情顶部摘要如何组织身份元数据与总体评分？
 *
 * 已冻结：Shell C · 目录栈。本模块只改 `/courses/:id` 顶部摘要区；
 * 学生投稿与历史资料保持生产组件，留给模块 10。
 *
 * 官方优先：HeroUI Button / Chip / Link / Surface / Separator。
 * 评分以醒目数字为主（如 4.7 / 5），不用星阵/环图/进度条。
 *
 * A — 标题流 + 分隔元数据：返回 → 课名 → 元数据行 → 评分数字行（最接近当前生产）
 * B — 左身份 / 右评分：主列身份，右侧 Surface 大号评分块
 * C — 评分优先摘要条：顶部 Surface 横条先评分，下接身份与元数据
 *
 * Mounted via CourseDetailPage when ?module=course-detail-summary&variant=A|B|C (DEV only).
 */
import { Button, Chip, Link, Separator, Surface } from "@heroui/react";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { categoryLabel, scoreText } from "../lib/labels";
import type { Course, Review, Teacher } from "../lib/types";

export type CourseDetailSummaryVariantKey = "A" | "B" | "C";

const KEYS: CourseDetailSummaryVariantKey[] = ["A", "B", "C"];

export function isCourseDetailSummaryVariantKey(
  key: string,
): key is CourseDetailSummaryVariantKey {
  return (KEYS as string[]).includes(key);
}

export type CourseDetailSummaryModel = {
  course: Course & { teachers: Teacher[] };
  /** Approved student reviews — used to derive avg + count when API omits aggregates */
  reviews: Review[];
  /** Catalog query string to restore on back, e.g. `?q=…&page=2` or empty */
  backSearch: string;
  onBack: () => void;
};

const VARIANT_HINT: Record<
  CourseDetailSummaryVariantKey,
  { title: string; lookFor: string }
> = {
  A: {
    title: "A — 标题流 + 分隔元数据",
    lookFor:
      "单列：返回 → Chip+课名 → 课号·院系·教师链接 → 底部分隔后大号 4.7/5 + 投稿数",
  },
  B: {
    title: "B — 左身份 / 右评分",
    lookFor:
      "两列：左身份与教师链接；右 Surface 竖排大号评分，评分是视觉锚点",
  },
  C: {
    title: "C — 评分优先摘要条",
    lookFor:
      "顶条 Surface 先放评分与投稿；其下才是课名与元数据（评分先于身份）",
  },
};

function deriveStats(reviews: Review[]): {
  rating: number | null;
  reviewCount: number;
} {
  const count = reviews.length;
  if (count === 0) return { rating: null, reviewCount: 0 };
  const sum = reviews.reduce((acc, r) => acc + Number(r.overall || 0), 0);
  return {
    rating: Math.round((sum / count) * 10) / 10,
    reviewCount: count,
  };
}

function formatOverall(rating: number | null): string {
  if (rating === null || rating === undefined || Number(rating) === 0) {
    return "—";
  }
  return scoreText(rating);
}

function TeacherLinks({ teachers }: { teachers: Teacher[] }) {
  if (!teachers?.length) {
    return <span className="text-muted">教师待补充</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {teachers.map((t, i) => (
        <span key={t.id} className="inline-flex items-center gap-x-1.5">
          {i > 0 ? <span className="text-muted">·</span> : null}
          <Link
            href={`/teachers/${t.id}`}
            className="text-sm"
            render={(domProps) => (
              <RouterLink
                {...(domProps as object)}
                to={`/teachers/${t.id}`}
                className={
                  typeof domProps.className === "string"
                    ? domProps.className
                    : undefined
                }
              />
            )}
          >
            {t.name}
          </Link>
        </span>
      ))}
    </span>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="mb-1 px-0" onPress={onBack}>
      ← 返回目录
    </Button>
  );
}

function ScoreBlock({
  rating,
  reviewCount,
  size = "lg",
  align = "start",
}: {
  rating: number | null;
  reviewCount: number;
  size?: "lg" | "xl";
  align?: "start" | "center" | "end";
}) {
  const numberClass =
    size === "xl"
      ? "text-5xl font-bold leading-none tabular text-accent"
      : "text-4xl font-bold leading-none tabular text-accent";
  const alignClass =
    align === "center"
      ? "items-center text-center"
      : align === "end"
        ? "items-end text-right"
        : "items-start text-left";

  return (
    <div className={`flex flex-col gap-1 ${alignClass}`}>
      <div className="flex items-baseline gap-1.5">
        <span className={numberClass}>{formatOverall(rating)}</span>
        <span className="text-sm font-medium text-muted">/ 5</span>
      </div>
      <p className="m-0 text-sm text-muted">
        {reviewCount > 0 ? (
          <>
            <span className="tabular font-semibold text-foreground">
              {reviewCount}
            </span>{" "}
            条学生投稿
          </>
        ) : (
          "暂无学生投稿"
        )}
      </p>
    </div>
  );
}

function PrototypeBanner({
  variant,
}: {
  variant: CourseDetailSummaryVariantKey;
}) {
  const hint = VARIANT_HINT[variant];
  return (
    <div
      className="mb-3 rounded-lg border border-dashed border-accent/40 bg-accent-soft/40 px-3 py-2 text-xs text-muted"
      role="note"
    >
      <strong className="text-foreground">{hint.title}</strong>
      <span className="mx-1.5 text-border">·</span>
      看：{hint.lookFor}
    </div>
  );
}

/** A — stacked title stream + meta + score under separator */
function VariantA({
  course,
  rating,
  reviewCount,
  onBack,
}: {
  course: Course & { teachers: Teacher[] };
  rating: number | null;
  reviewCount: number;
  onBack: () => void;
}) {
  return (
    <header className="mb-4 border-b border-border pb-4" aria-label="课程摘要">
      <BackButton onBack={onBack} />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Chip size="sm" variant="soft">
          <Chip.Label>{categoryLabel(course.category)}</Chip.Label>
        </Chip>
      </div>
      <h1 className="mb-1 mt-2 text-[26px] font-bold leading-tight tracking-tight">
        {course.name}
      </h1>
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
        <span className="tabular">{course.code || "课号未标注"}</span>
        <span aria-hidden>·</span>
        <span>{course.department || "院系未标注"}</span>
        <span aria-hidden>·</span>
        <TeacherLinks teachers={course.teachers} />
      </p>
      <Separator className="my-3" />
      <ScoreBlock rating={rating} reviewCount={reviewCount} size="lg" />
    </header>
  );
}

/** B — left identity, right score Surface */
function VariantB({
  course,
  rating,
  reviewCount,
  onBack,
}: {
  course: Course & { teachers: Teacher[] };
  rating: number | null;
  reviewCount: number;
  onBack: () => void;
}) {
  return (
    <header className="mb-4" aria-label="课程摘要">
      <BackButton onBack={onBack} />
      <div className="mt-1 grid gap-4 border-b border-border pb-4 md:grid-cols-[1fr_auto] md:items-stretch">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="soft">
              <Chip.Label>{categoryLabel(course.category)}</Chip.Label>
            </Chip>
            <span className="tabular text-xs text-muted">
              {course.code || "课号未标注"}
            </span>
          </div>
          <h1 className="mb-2 mt-2 text-[26px] font-bold leading-tight tracking-tight">
            {course.name}
          </h1>
          <dl className="m-0 grid gap-1.5 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="shrink-0 text-muted">院系</dt>
              <dd className="m-0 text-foreground">
                {course.department || "未标注"}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="shrink-0 text-muted">任课教师</dt>
              <dd className="m-0">
                <TeacherLinks teachers={course.teachers} />
              </dd>
            </div>
          </dl>
        </div>
        <Surface
          className="flex min-w-[9.5rem] flex-col justify-center rounded-2xl border border-border px-5 py-4 md:self-start"
          variant="secondary"
        >
          <ScoreBlock
            rating={rating}
            reviewCount={reviewCount}
            size="xl"
            align="center"
          />
        </Surface>
      </div>
    </header>
  );
}

/** C — score-first summary strip, then identity */
function VariantC({
  course,
  rating,
  reviewCount,
  onBack,
}: {
  course: Course & { teachers: Teacher[] };
  rating: number | null;
  reviewCount: number;
  onBack: () => void;
}) {
  return (
    <header className="mb-4" aria-label="课程摘要">
      <BackButton onBack={onBack} />
      <Surface
        className="mt-1 rounded-2xl border border-border px-4 py-3 sm:px-5 sm:py-4"
        variant="secondary"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ScoreBlock rating={rating} reviewCount={reviewCount} size="xl" />
          <Chip size="sm" variant="soft">
            <Chip.Label>{categoryLabel(course.category)}</Chip.Label>
          </Chip>
        </div>
      </Surface>
      <div className="mt-3 border-b border-border pb-4">
        <h1 className="m-0 text-[26px] font-bold leading-tight tracking-tight">
          {course.name}
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
          <span className="tabular">{course.code || "课号未标注"}</span>
          <span aria-hidden>·</span>
          <span>{course.department || "院系未标注"}</span>
        </p>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-muted">任课教师</span>
          <TeacherLinks teachers={course.teachers} />
        </p>
      </div>
    </header>
  );
}

/**
 * Live host for course-detail-summary A/B/C.
 * Renders only the summary header; caller keeps reviews / legacy below.
 */
export function CourseDetailSummaryPrototype({
  variant,
  model,
}: {
  variant: CourseDetailSummaryVariantKey;
  model: CourseDetailSummaryModel;
}) {
  const { rating, reviewCount } = deriveStats(model.reviews);
  const course = model.course;

  let body: ReactNode;
  switch (variant) {
    case "A":
      body = (
        <VariantA
          course={course}
          rating={rating}
          reviewCount={reviewCount}
          onBack={model.onBack}
        />
      );
      break;
    case "B":
      body = (
        <VariantB
          course={course}
          rating={rating}
          reviewCount={reviewCount}
          onBack={model.onBack}
        />
      );
      break;
    case "C":
      body = (
        <VariantC
          course={course}
          rating={rating}
          reviewCount={reviewCount}
          onBack={model.onBack}
        />
      );
      break;
  }

  return (
    <div data-prototype="course-detail-summary" data-variant={variant}>
      <PrototypeBanner variant={variant} />
      {body}
      {/* Surface full state for prototype skill: visible after every switch */}
      <p className="sr-only" aria-live="polite">
        变体 {variant} · 评分 {formatOverall(rating)} / 5 · 投稿 {reviewCount} ·
        课程 {course.name}
      </p>
    </div>
  );
}

