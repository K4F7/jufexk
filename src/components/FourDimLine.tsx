import { REVIEW_DIMENSIONS } from "../lib/review-dimensions";

/**
 * 四维主观档位内联行：课程难度 / 作业多少 / 给分好坏 / 收获多少。
 * labels 按 REVIEW_DIMENSIONS 顺序；缺失或 null 时显示「—」。
 */
export function FourDimLine({
  labels,
  className = "",
}: {
  labels?: readonly (string | null)[] | null;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap gap-x-6 gap-y-0.5 text-[calc(12/15*1rem)] text-muted ${className}`}
    >
      {REVIEW_DIMENSIONS.map((dim, index) => (
        <span key={dim.key}>
          {dim.label}：
          <span className="text-foreground">{labels?.[index] ?? "—"}</span>
        </span>
      ))}
    </div>
  );
}
