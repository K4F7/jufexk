import { Typography } from "@heroui/react";
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
      className={`flex flex-wrap gap-x-6 gap-y-0.5 text-[calc(12/15*1rem)] text-muted max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3 max-sm:gap-y-1.5 ${className}`}
    >
      {REVIEW_DIMENSIONS.map((dim, index) => (
        <Typography
          key={dim.key}
          className="m-0 min-w-0 text-[length:inherit] max-sm:leading-normal"
          color="muted"
          type="body-xs"
        >
          {dim.label}：
          <span className="text-foreground">{labels?.[index] ?? "—"}</span>
        </Typography>
      ))}
    </div>
  );
}
