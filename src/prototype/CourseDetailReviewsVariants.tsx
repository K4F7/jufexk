/**
 * PROTOTYPE — course-detail-reviews variants (throwaway; not production-ready).
 *
 * Question: 课程详情页上，学生投稿列表与历史文字资料应如何分区、如何呈现条目？
 *
 * 已冻结：Shell C · 目录栈 · 课程详情摘要意向 B。本模块只改投稿 + 历史资料区；
 * 顶部摘要保持生产组件（页级可砍，不在此比较）。
 *
 * 领域硬约束（CONTEXT / foundations）：
 * - 投稿绑定课程+任课教师，含 overall，参与评分/投稿数
 * - 历史文字资料独立区块：无 overall，不参与评分/投稿数/排序
 * - 空态文案区分「暂无投稿」与「暂无历史资料」
 * - 投稿条目直接展开：评分、教师、正文、评价维度
 *
 * 官方优先：Chip / Separator / Surface / Card / Alert / Description。
 *
 * A — 紧凑分隔列表：左评分 / 右正文；条目间 Separator；历史独立区 + 「历史」Chip
 * B — Card 条目栈：每条投稿一张 Card；维度用 soft Chip；历史 secondary Surface + Alert 说明
 * C — 维度优先 + 归档区：维度网格在前、评分作 accent Chip；历史为更弱的归档列表（Alert + 纯文字）
 *
 * 胜出（视觉冻结）：**A 结构 + B 维度 soft Chip**；生产后经 #68/#90 改为 PublicReviews 统一匿名文字流，ReviewCard / LegacyReviews 于 #115 移除。
 * 本文件保留完整 A/B/C 对照；VariantA 维度已改为 soft Chip 以贴近冻结组合。
 *
 * Mounted via CourseDetailPage when ?module=course-detail-reviews&variant=A|B|C (DEV only).
 * 本地无 approved legacy 时注入 DEMO 历史资料，便于并排判断；真实 API 有数据则优先用真实数据。
 */
import {
  Alert,
  Card,
  Chip,
  Description,
  Separator,
  Surface,
} from "@heroui/react";
import { useMemo, useState, type ReactNode } from "react";
import type { LegacyReview, Review } from "../lib/types";

export type CourseDetailReviewsVariantKey = "A" | "B" | "C";

const KEYS: CourseDetailReviewsVariantKey[] = ["A", "B", "C"];

export function isCourseDetailReviewsVariantKey(
  key: string,
): key is CourseDetailReviewsVariantKey {
  return (KEYS as string[]).includes(key);
}

export type CourseDetailReviewsModel = {
  reviews: Review[];
  legacyReviews: LegacyReview[];
  /** Course name for a11y / state dump */
  courseName: string;
};

const VARIANT_HINT: Record<
  CourseDetailReviewsVariantKey,
  { title: string; lookFor: string }
> = {
  A: {
    title: "A — 紧凑分隔列表（冻结主体）",
    lookFor:
      "左大号评分 · 右教师/正文；维度 soft Chip 白胶囊（吸收 B）；条目 Separator；历史独立区 + 历史 Chip",
  },
  B: {
    title: "B — Card 条目栈",
    lookFor:
      "每条投稿一张 Card；维度 soft Chip 行；历史 secondary Surface + Alert 免计分说明",
  },
  C: {
    title: "C — 维度优先 + 归档区",
    lookFor:
      "维度网格先于正文；overall 为 accent Chip；历史是更弱的归档列表（无评分感布局）",
  },
};

/** DEMO — wipe when real approved legacy exists in local D1 */
const DEMO_LEGACY: LegacyReview[] = [
  {
    id: -1,
    teacher_name: "张可",
    comment:
      "上课节奏偏快，作业以小组报告为主。期末开卷，复习提纲会提前发。",
    source_label: "腾讯文档 · 历史选课表（演示）",
  },
  {
    id: -2,
    teacher_name: "万钟",
    comment:
      "点名不固定，课堂案例多。给分中等偏上，适合想了解会计实务的同学。",
    source_label: "腾讯文档 · 历史选课表（演示）",
  },
];

type EmptyDemo = "none" | "submissions" | "legacy" | "both";

type MetricItem = { label: string; value: string };

function metricItems(r: Review): MetricItem[] {
  if (r.category === "general") {
    return [
      { label: "内容吸引力", value: r.interest ? `${r.interest}/5` : "未提及" },
      {
        label: "实用与收获",
        value: r.practicality ? `${r.practicality}/5` : "未提及",
      },
      {
        label: "时间投入",
        value: r.workload_score ? `${r.workload_score}/5` : "未提及",
      },
      { label: "考核公平", value: r.fairness ? `${r.fairness}/5` : "未提及" },
      {
        label: "课堂组织",
        value: r.organization ? `${r.organization}/5` : "未提及",
      },
    ];
  }
  return [
    { label: "点名", value: String(r.attendance || "未提及") },
    {
      label: "给分",
      value: r.grading_score
        ? `${r.grading_score}/5 ${r.grading || ""}`.trim()
        : String(r.grading || "未提及"),
    },
    { label: "是否捞人", value: String(r.rescue || "未提及") },
    { label: "强度", value: String(r.workload || "未提及") },
    { label: "考核", value: String(r.assessment || "未提及") },
    { label: "课堂质量", value: String(r.teaching || "未提及") },
    { label: "清晰度", value: r.clarity ? `${r.clarity}/5` : "未提及" },
    { label: "知识收获", value: r.knowledge ? `${r.knowledge}/5` : "未提及" },
  ];
}

function bodyText(r: Review): string {
  return r.comment || r.teaching || "无补充内容";
}

function PrototypeBanner({
  variant,
  emptyDemo,
  onEmptyDemo,
  usingDemoLegacy,
}: {
  variant: CourseDetailReviewsVariantKey;
  emptyDemo: EmptyDemo;
  onEmptyDemo: (v: EmptyDemo) => void;
  usingDemoLegacy: boolean;
}) {
  const hint = VARIANT_HINT[variant];
  const options: { key: EmptyDemo; label: string }[] = [
    { key: "none", label: "有数据" },
    { key: "submissions", label: "投稿空" },
    { key: "legacy", label: "历史空" },
    { key: "both", label: "全空" },
  ];

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
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted">空态演示</span>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              emptyDemo === o.key
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface text-foreground"
            }`}
            onClick={() => onEmptyDemo(o.key)}
          >
            {o.label}
          </button>
        ))}
        {usingDemoLegacy ? (
          <span className="text-[11px] text-warning">
            历史区使用 DEMO 资料（本地 D1 无 approved legacy）
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  meta,
  id,
}: {
  title: string;
  meta?: ReactNode;
  id: string;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="m-0 text-[17px] font-bold leading-snug">
        {title}
      </h2>
      {meta ? <span className="text-[13px] text-muted">{meta}</span> : null}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-6 py-6 text-center text-sm text-muted"
    >
      {children}
    </div>
  );
}

function LegacyDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Description className="mb-3">
        历史文字资料不计入评分与投稿数，仅供参考。
      </Description>
    );
  }
  return (
    <Alert status="warning" className="mb-3">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>不参与评分统计</Alert.Title>
        <Alert.Description>
          由腾讯表格等历史资料迁移，经管理员审核后展示；不含 overall，不计入课程或教师评分、投稿数与排序。
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/* ─── Shared metric renderers ─────────────────────────────────────── */

function MetricsDl({ items }: { items: MetricItem[] }) {
  return (
    <dl className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {items.map((m) => (
        <div key={m.label}>
          <dt className="text-[11px] font-bold text-muted">{m.label}</dt>
          <dd className="m-0 text-sm">{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MetricsChips({ items }: { items: MetricItem[] }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {items.map((m) => (
        <Chip key={m.label} size="sm" variant="soft">
          <Chip.Label>
            {m.label} · {m.value}
          </Chip.Label>
        </Chip>
      ))}
    </div>
  );
}

/* ─── Variant A — compact list + separators ───────────────────────── */

function SubmissionA({ review }: { review: Review }) {
  const items = metricItems(review);
  return (
    <article
      className="grid gap-3 py-4 sm:grid-cols-[4.5rem_1fr] sm:gap-4"
      aria-label={`学生投稿 ${review.overall}/5 · ${review.teacher_name || "未指定教师"}`}
    >
      <div className="tabular text-[26px] font-bold leading-none text-accent">
        {review.overall}
        <small className="text-xs font-normal text-muted">/5</small>
      </div>
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold">
          {review.teacher_name || "未指定教师"}
        </p>
        <p className="my-1.5 text-sm leading-relaxed">{bodyText(review)}</p>
        {/* Frozen combo: A layout + B soft Chip metrics */}
        <MetricsChips items={items} />
      </div>
    </article>
  );
}

function LegacyItemA({ row }: { row: LegacyReview }) {
  return (
    <article
      className="grid gap-3 py-4 sm:grid-cols-[4.5rem_1fr] sm:gap-4"
      aria-label={`历史文字资料 · ${row.teacher_name || "教师资料"}`}
    >
      <div>
        <Chip size="sm" variant="secondary">
          <Chip.Label>历史</Chip.Label>
        </Chip>
      </div>
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold">
          {row.teacher_name || "教师资料"}
        </p>
        <p className="my-1.5 text-sm leading-relaxed">{row.comment}</p>
        {row.source_label ? (
          <p className="m-0 text-xs text-muted">{row.source_label}</p>
        ) : null}
      </div>
    </article>
  );
}

function VariantA({
  reviews,
  legacy,
}: {
  reviews: Review[];
  legacy: LegacyReview[];
}) {
  return (
    <div className="grid gap-8">
      <section aria-labelledby="proto-submissions-heading">
        <SectionTitle
          id="proto-submissions-heading"
          title="学生投稿"
          meta={reviews.length ? `${reviews.length} 条` : undefined}
        />
        {reviews.length ? (
          <div role="list" aria-label="学生投稿列表">
            {reviews.map((r, i) => (
              <div key={r.id} role="listitem">
                {i > 0 ? <Separator /> : null}
                <SubmissionA review={r} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>暂无投稿</EmptyState>
        )}
      </section>

      <section aria-labelledby="proto-legacy-heading">
        <Separator className="mb-5" />
        <SectionTitle
          id="proto-legacy-heading"
          title="历史文字资料"
          meta={legacy.length ? `${legacy.length} 条` : undefined}
        />
        <LegacyDisclaimer compact />
        {legacy.length ? (
          <div role="list" aria-label="历史文字资料列表">
            {legacy.map((row, i) => (
              <div key={row.id ?? `legacy-${i}`} role="listitem">
                {i > 0 ? <Separator variant="secondary" /> : null}
                <LegacyItemA row={row} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>暂无历史资料</EmptyState>
        )}
      </section>
    </div>
  );
}

/* ─── Variant B — Card stack ──────────────────────────────────────── */

function SubmissionB({ review }: { review: Review }) {
  const items = metricItems(review);
  return (
    <Card
      className="w-full"
      aria-label={`学生投稿 ${review.overall}/5 · ${review.teacher_name || "未指定教师"}`}
    >
      <Card.Header className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <Card.Title className="text-base">
            {review.teacher_name || "未指定教师"}
          </Card.Title>
        </div>
        <div className="shrink-0 text-right">
          <span className="tabular text-3xl font-bold leading-none text-accent">
            {review.overall}
          </span>
          <span className="text-sm text-muted"> / 5</span>
        </div>
      </Card.Header>
      <Card.Content>
        <p className="m-0 text-sm leading-relaxed">{bodyText(review)}</p>
        <MetricsChips items={items} />
      </Card.Content>
    </Card>
  );
}

function LegacyItemB({ row }: { row: LegacyReview }) {
  return (
    <article
      className="border-b border-border py-3 last:border-b-0"
      aria-label={`历史文字资料 · ${row.teacher_name || "教师资料"}`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Chip size="sm" variant="secondary">
          <Chip.Label>历史</Chip.Label>
        </Chip>
        <span className="text-sm font-semibold">
          {row.teacher_name || "教师资料"}
        </span>
      </div>
      <p className="m-0 text-sm leading-relaxed">{row.comment}</p>
      {row.source_label ? (
        <p className="mt-1.5 m-0 text-xs text-muted">{row.source_label}</p>
      ) : null}
    </article>
  );
}

function VariantB({
  reviews,
  legacy,
}: {
  reviews: Review[];
  legacy: LegacyReview[];
}) {
  return (
    <div className="grid gap-8">
      <section aria-labelledby="proto-submissions-heading">
        <SectionTitle
          id="proto-submissions-heading"
          title="学生投稿"
          meta={reviews.length ? `${reviews.length} 条` : undefined}
        />
        {reviews.length ? (
          <div
            role="list"
            aria-label="学生投稿列表"
            className="grid gap-3"
          >
            {reviews.map((r) => (
              <div key={r.id} role="listitem">
                <SubmissionB review={r} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>暂无投稿</EmptyState>
        )}
      </section>

      <section aria-labelledby="proto-legacy-heading">
        <SectionTitle
          id="proto-legacy-heading"
          title="历史文字资料"
          meta={legacy.length ? `${legacy.length} 条` : undefined}
        />
        <Surface
          variant="secondary"
          className="rounded-2xl border border-border p-4"
        >
          <LegacyDisclaimer />
          {legacy.length ? (
            <div role="list" aria-label="历史文字资料列表">
              {legacy.map((row, i) => (
                <div key={row.id ?? `legacy-${i}`} role="listitem">
                  <LegacyItemB row={row} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>暂无历史资料</EmptyState>
          )}
        </Surface>
      </section>
    </div>
  );
}

/* ─── Variant C — metrics-first + archive zone ────────────────────── */

function SubmissionC({ review }: { review: Review }) {
  const items = metricItems(review);
  return (
    <article
      className="py-4"
      aria-label={`学生投稿 ${review.overall}/5 · ${review.teacher_name || "未指定教师"}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Chip size="sm" color="accent" variant="soft">
          <Chip.Label className="tabular">
            overall {review.overall}/5
          </Chip.Label>
        </Chip>
        <span className="text-sm font-semibold">
          {review.teacher_name || "未指定教师"}
        </span>
      </div>
      <MetricsDl items={items} />
      <p className="mt-3 mb-0 text-sm leading-relaxed text-muted">
        {bodyText(review)}
      </p>
    </article>
  );
}

function LegacyItemC({ row }: { row: LegacyReview }) {
  return (
    <article
      className="py-3"
      aria-label={`历史文字资料 · ${row.teacher_name || "教师资料"}`}
    >
      <p className="m-0 text-xs font-medium uppercase tracking-wide text-muted">
        归档
        {row.teacher_name ? ` · ${row.teacher_name}` : ""}
      </p>
      <p className="mt-1 mb-0 text-sm leading-relaxed">{row.comment}</p>
      {row.source_label ? (
        <p className="mt-1 m-0 text-xs text-muted">{row.source_label}</p>
      ) : null}
    </article>
  );
}

function VariantC({
  reviews,
  legacy,
}: {
  reviews: Review[];
  legacy: LegacyReview[];
}) {
  return (
    <div className="grid gap-8">
      <section aria-labelledby="proto-submissions-heading">
        <SectionTitle
          id="proto-submissions-heading"
          title="学生投稿"
          meta={reviews.length ? `${reviews.length} 条` : undefined}
        />
        {reviews.length ? (
          <div role="list" aria-label="学生投稿列表">
            {reviews.map((r, i) => (
              <div key={r.id} role="listitem">
                {i > 0 ? <Separator /> : null}
                <SubmissionC review={r} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>暂无投稿</EmptyState>
        )}
      </section>

      <section
        aria-labelledby="proto-legacy-heading"
        className="rounded-xl border border-dashed border-border bg-surface/40 px-4 py-4"
      >
        <SectionTitle
          id="proto-legacy-heading"
          title="历史文字资料"
          meta={legacy.length ? `${legacy.length} 条归档` : undefined}
        />
        <LegacyDisclaimer />
        {legacy.length ? (
          <div role="list" aria-label="历史文字资料列表">
            {legacy.map((row, i) => (
              <div key={row.id ?? `legacy-${i}`} role="listitem">
                {i > 0 ? <Separator variant="tertiary" /> : null}
                <LegacyItemC row={row} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>暂无历史资料</EmptyState>
        )}
      </section>
    </div>
  );
}

/* ─── Host ────────────────────────────────────────────────────────── */

/**
 * Live host for course-detail-reviews A/B/C.
 * Renders only the submissions + legacy sections; caller keeps summary above.
 */
export function CourseDetailReviewsPrototype({
  variant,
  model,
}: {
  variant: CourseDetailReviewsVariantKey;
  model: CourseDetailReviewsModel;
}) {
  const [emptyDemo, setEmptyDemo] = useState<EmptyDemo>("none");

  const apiLegacy = model.legacyReviews ?? [];
  const usingDemoLegacy = apiLegacy.length === 0;
  const sourceLegacy = usingDemoLegacy ? DEMO_LEGACY : apiLegacy;

  const reviews = useMemo(() => {
    if (emptyDemo === "submissions" || emptyDemo === "both") return [];
    return model.reviews ?? [];
  }, [emptyDemo, model.reviews]);

  const legacy = useMemo(() => {
    if (emptyDemo === "legacy" || emptyDemo === "both") return [];
    return sourceLegacy;
  }, [emptyDemo, sourceLegacy]);

  let body: ReactNode;
  switch (variant) {
    case "A":
      body = <VariantA reviews={reviews} legacy={legacy} />;
      break;
    case "B":
      body = <VariantB reviews={reviews} legacy={legacy} />;
      break;
    case "C":
      body = <VariantC reviews={reviews} legacy={legacy} />;
      break;
  }

  return (
    <div data-prototype="course-detail-reviews" data-variant={variant}>
      <PrototypeBanner
        variant={variant}
        emptyDemo={emptyDemo}
        onEmptyDemo={setEmptyDemo}
        usingDemoLegacy={usingDemoLegacy}
      />
      {body}
      <p className="sr-only" aria-live="polite">
        变体 {variant} · 投稿 {reviews.length} · 历史 {legacy.length}
        {usingDemoLegacy ? " · 历史为 DEMO" : ""} · 课程 {model.courseName}
        · 空态 {emptyDemo}
      </p>
    </div>
  );
}
