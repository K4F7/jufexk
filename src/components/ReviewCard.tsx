/**
 * Student submission entry — visually frozen: prototype A structure + B dimension chips.
 * Compact left score / right body; metrics as HeroUI Chip soft (white capsule highlight).
 * Issue #61 · docs/ui/foundations.md §详情体验.
 */
import { Chip, Separator } from "@heroui/react";
import type { Review } from "../lib/types";

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

export function ReviewCard({
  review,
  showSeparator = false,
}: {
  review: Review;
  /** When true, draw a Separator above this entry (list glue). */
  showSeparator?: boolean;
}) {
  const items = metricItems(review);
  const teacher = review.teacher_name || "未指定教师";
  const term = review.term || "学期未标注";

  return (
    <>
      {showSeparator ? <Separator /> : null}
      <article
        className="grid gap-3 py-4 sm:grid-cols-[4.5rem_1fr] sm:gap-4"
        aria-label={`学生投稿 ${review.overall}/5 · ${teacher} · ${term}`}
      >
        <div className="tabular text-[26px] font-bold leading-none text-accent">
          {review.overall}
          <small className="text-xs font-normal text-muted">/5</small>
        </div>
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold">
            {teacher}
            <span className="mx-1.5 font-normal text-muted" aria-hidden>
              ·
            </span>
            <span className="font-normal text-muted">{term}</span>
          </p>
          <p className="my-1.5 text-sm leading-relaxed">{bodyText(review)}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {items.map((m) => (
              <Chip key={m.label} size="sm" variant="soft">
                <Chip.Label>
                  {m.label} · {m.value}
                </Chip.Label>
              </Chip>
            ))}
          </div>
        </div>
      </article>
    </>
  );
}
