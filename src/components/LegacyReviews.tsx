import type { LegacyReview } from "../lib/types";

export function LegacyReviews({
  rows = [],
  showCourse = false,
}: {
  rows?: LegacyReview[];
  showCourse?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <section className="mt-6 border-t border-border pt-5">
      <h2 className="m-0 mb-1 text-[17px] font-bold">历史文字资料</h2>
      <p className="mb-4 mt-0 text-muted">
        由腾讯表格历史资料迁移，经管理员审核后展示；不包含推算评分，也不计入课程或教师评分。
      </p>
      <div className="space-y-0">
        {rows.map((r, i) => (
          <article
            key={r.id ?? i}
            className="grid gap-4 border-b border-border py-4 sm:grid-cols-[64px_1fr]"
          >
            <div className="h-fit border border-muted px-2 py-1 text-center text-[11px] font-bold tracking-wider text-muted">
              历史
            </div>
            <div>
              <b className="text-sm">
                {(showCourse ? r.course_name : r.teacher_name) || "教师资料"}
                {r.term ? ` · ${r.term}` : ""}
              </b>
              <p className="my-1.5">{r.comment}</p>
              {r.source_label ? (
                <small className="text-muted">{r.source_label}</small>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
