import { Separator } from "@heroui/react";
import type { PublicReview } from "../lib/types";
import { EmptyBox } from "./EmptyBox";

export function PublicReviews({
  rows,
  identity,
}: {
  rows: PublicReview[];
  identity: "teacher" | "course";
}) {
  return (
    <section className="mb-2" aria-labelledby={`${identity}-reviews-heading`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id={`${identity}-reviews-heading`}
          className="m-0 text-[17px] font-bold leading-snug"
        >
          评价
        </h2>
        {rows.length ? (
          <span className="text-[13px] text-muted">{rows.length} 条</span>
        ) : null}
      </div>
      {rows.length ? (
        <div role="list" aria-label="评价列表">
          {rows.map((review, index) => {
            const counterpart =
              identity === "course" ? review.course_name : review.teacher_name;
            return (
              <div key={review.id} role="listitem">
                {index > 0 ? <Separator /> : null}
                <article className="py-4">
                  <p className="m-0 text-sm font-semibold">
                    {counterpart || (identity === "course" ? "课程未标注" : "教师未标注")}
                  </p>
                  <p className="mb-0 mt-1.5 text-sm leading-relaxed">{review.comment}</p>
                </article>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyBox>暂无评价</EmptyBox>
      )}
    </section>
  );
}
