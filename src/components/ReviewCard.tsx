import type { Review } from "../lib/types";

function metric(name: string, value: unknown) {
  return (
    <div key={name}>
      <dt className="text-[11px] font-bold text-muted">{name}</dt>
      <dd className="m-0 text-sm">{String(value || "未提及")}</dd>
    </div>
  );
}

function metrics(r: Review) {
  if (r.category === "general") {
    return (
      <>
        {metric("内容吸引力", r.interest && `${r.interest}/5`)}
        {metric("实用与收获", r.practicality && `${r.practicality}/5`)}
        {metric("时间投入", r.workload_score && `${r.workload_score}/5`)}
        {metric("考核公平", r.fairness && `${r.fairness}/5`)}
        {metric("课堂组织", r.organization && `${r.organization}/5`)}
      </>
    );
  }
  return (
    <>
      {metric("点名", r.attendance)}
      {metric(
        "给分",
        r.grading_score ? `${r.grading_score}/5 ${r.grading || ""}` : r.grading,
      )}
      {metric("是否捞人", r.rescue)}
      {metric("强度", r.workload)}
      {metric("考核", r.assessment)}
      {metric("课堂质量", r.teaching)}
      {metric("清晰度", r.clarity && `${r.clarity}/5`)}
      {metric("知识收获", r.knowledge && `${r.knowledge}/5`)}
    </>
  );
}

export function ReviewCard({ review }: { review: Review }) {
  return (
    <article className="grid gap-4 border-b border-border py-4 sm:grid-cols-[64px_1fr]">
      <div className="tabular text-[26px] font-bold text-accent">
        {review.overall}
        <small className="text-xs font-normal text-muted">/5</small>
      </div>
      <div>
        <b className="text-sm">
          {review.teacher_name || "未指定教师"} · {review.term || "学期未标注"}
        </b>
        <p className="my-1.5">{review.comment || review.teaching || "无补充内容"}</p>
        <dl className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {metrics(review)}
        </dl>
      </div>
    </article>
  );
}
