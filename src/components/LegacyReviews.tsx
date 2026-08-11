/**
 * Historical text materials — visually frozen with module 10 (A list language).
 * Independent block: no overall; does not enter rating / submission counts / sort.
 * Empty copy: 「暂无历史资料」. Issue #61 · docs/ui/foundations.md §详情体验.
 */
import { Chip, Description, Separator } from "@heroui/react";
import type { LegacyReview } from "../lib/types";

export function LegacyReviews({
  rows = [],
  showCourse = false,
}: {
  rows?: LegacyReview[];
  showCourse?: boolean;
}) {
  return (
    <section
      className="mt-6 border-t border-border pt-5"
      aria-labelledby="legacy-reviews-heading"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="legacy-reviews-heading"
          className="m-0 text-[17px] font-bold leading-snug"
        >
          历史文字资料
        </h2>
        {rows.length ? (
          <span className="text-[13px] text-muted">{rows.length} 条</span>
        ) : null}
      </div>
      <Description className="mb-4">
        由腾讯表格等历史资料迁移，经管理员审核后展示；不含 overall，不计入评分、学生投稿数与排序。
      </Description>
      {rows.length ? (
        <div role="list" aria-label="历史文字资料列表">
          {rows.map((r, i) => {
            const title =
              (showCourse ? r.course_name : r.teacher_name) || "教师资料";
            const term = r.term || "";
            return (
              <div key={r.id ?? i} role="listitem">
                {i > 0 ? <Separator variant="secondary" /> : null}
                <article
                  className="grid gap-3 py-4 sm:grid-cols-[4.5rem_1fr] sm:gap-4"
                  aria-label={`历史文字资料 · ${title}${term ? ` · ${term}` : ""}`}
                >
                  <div>
                    <Chip size="sm" variant="secondary">
                      <Chip.Label>历史</Chip.Label>
                    </Chip>
                  </div>
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-semibold">
                      {title}
                      {term ? (
                        <>
                          <span
                            className="mx-1.5 font-normal text-muted"
                            aria-hidden
                          >
                            ·
                          </span>
                          <span className="font-normal text-muted">{term}</span>
                        </>
                      ) : null}
                    </p>
                    <p className="my-1.5 text-sm leading-relaxed">{r.comment}</p>
                    {r.source_label ? (
                      <p className="m-0 text-xs text-muted">{r.source_label}</p>
                    ) : null}
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          role="status"
          className="rounded-lg border border-dashed border-border px-6 py-6 text-center text-sm text-muted"
        >
          暂无历史资料
        </div>
      )}
    </section>
  );
}
