/**
 * 四维主观档位（课程难度/作业多少/给分好坏/收获多少）的展示元数据与
 * 评价锚点。公开流的真实档位标签由 #373 的后端投影提供；在投影落地前，
 * 课程行、课程页头部与点评条目的四维一律显示占位「—」。
 */
export const REVIEW_DIMENSIONS = [
  { key: "difficulty", label: "课程难度" },
  { key: "homework", label: "作业多少" },
  { key: "grading", label: "给分好坏" },
  { key: "gain", label: "收获多少" },
] as const;

/**
 * 评价条目的锚点 id：/latest 的「查看全文」跳到课程页对应评价。
 * 公开 id 形如 review:1 / historical:x / legacy:2，折叠成 HTML id 安全形式。
 */
export function reviewAnchorId(id: string | number): string {
  return String(id).replace(/[:#~]/g, "-");
}

/** Course-page permalink path for 分享 / 复制链接. */
export function reviewSharePath(review: {
  id: string | number;
  course_id: number;
  teacher_id: number;
}): string {
  return `/courses/${review.course_id}?teacher=${review.teacher_id}#${reviewAnchorId(review.id)}`;
}
