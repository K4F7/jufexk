/**
 * 课程目录行：一行一条课程×教师。
 * 课程名（老师）→ 星级 + 评价样本 → 四维档位。
 * HeroUI `.link` 默认是 inline-flex + w-fit + rounded-xl，会缩成一枚
 * 按钮；目录行用 w-full! / rounded-none! 拉齐内容区全宽。
 */
import { fourDimLineLabels } from "../lib/dimension-labels";
import type { CourseRelation } from "../lib/types";
import { FourDimLine } from "./FourDimLine";
import { RouterAriaLink } from "./RouterAriaLink";
import { Stars } from "./Stars";

export function relationDetailHref(
  relation: Pick<CourseRelation, "course_id" | "teacher_id">,
  search = "",
): string {
  const sp = new URLSearchParams(search);
  if (relation.teacher_id != null) {
    sp.set("teacher", String(relation.teacher_id));
  } else {
    sp.delete("teacher");
  }
  const q = sp.toString();
  return `/courses/${relation.course_id}${q ? `?${q}` : ""}`;
}

export function CourseRelationRow({
  relation,
  search = "",
}: {
  relation: CourseRelation;
  /** 当前目录查询串（location.search，可含前导 ?），随链接带入详情页。 */
  search?: string;
}) {
  const href = relationDetailHref(relation, search);
  const rating = relation.rating ?? null;
  const reviewCount = relation.review_count ?? relation.course_review_count ?? 0;
  return (
    <RouterAriaLink
      to={href}
      className="block! w-full! rounded-none! border-b border-separator py-3 no-underline last:border-b-0 hover:bg-surface-secondary/60 hover:no-underline! [content-visibility:auto] [contain-intrinsic-size:auto_5.5rem]"
    >
      <span className="block text-[15px] font-medium text-accent">
        {relation.name}
        {relation.teacher_name ? (
          <span className="font-normal">（{relation.teacher_name}）</span>
        ) : (
          <span className="text-[12px] font-normal text-muted">
            {" "}
            教师待补充
          </span>
        )}
      </span>
      <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <Stars rating={rating} className="text-[15px]" />
        {rating != null ? (
          <span className="tabular text-[15px] font-semibold text-accent">
            {rating.toFixed(1)}
          </span>
        ) : null}
        <span className="text-[12px] text-muted">
          {reviewCount > 0
            ? rating != null
              ? `（${reviewCount} 人评价）`
              : `${reviewCount} 条评价`
            : "暂无评价"}
        </span>
      </span>
      <FourDimLine
        className="mt-1.5"
        labels={fourDimLineLabels(relation.dimensionLabels)}
      />
    </RouterAriaLink>
  );
}
