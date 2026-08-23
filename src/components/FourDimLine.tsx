import { REVIEW_DIMENSIONS } from "../lib/review-dimensions";

/**
 * 四维主观档位内联行：课程难度 / 作业多少 / 给分好坏 / 收获多少。
 * labels 按 REVIEW_DIMENSIONS 顺序；缺失或 null 时显示「—」。
 * #373 的公开流投影只下发评价条目级标签（点评条目改渲染档位 Chip），
 * 课程行与课程页头部没有关系级分布数据，继续用本组件占位。
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
      className={`flex flex-wrap gap-x-6 gap-y-0.5 text-[12px] text-muted ${className}`}
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
