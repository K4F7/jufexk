/**
 * 课程目录行（Issue #402，对齐 icourse 三行条目）：一行一条课程×教师。
 * 课程名（老师）→ 星级 + 评价样本 → 四维档位。
 * 关系级评分 / 点评数与四维档期的后端投影属 #410：未下发前星级一律灰星，
 * 课程无任何公开文字评价时显示「暂无评价」，否则显示「评分统计接入中」，
 * 四维固定占位「—」。整行是真实链接（键盘 / 新标签安全），并携带目录
 * 查询串以便详情页返回时恢复。
 */
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
  return (
    <RouterAriaLink
      to={href}
      className="block border-b border-separator py-3 no-underline last:border-b-0 hover:bg-surface-secondary/60"
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
        <Stars rating={null} className="text-[15px]" />
        <span className="text-[12px] text-muted">
          {relation.course_review_count > 0 ? "评分统计接入中" : "暂无评价"}
        </span>
      </span>
      <FourDimLine className="mt-1.5" labels={null} />
    </RouterAriaLink>
  );
}
