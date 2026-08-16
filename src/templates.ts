import { escapeHtml } from "./html";

const score = (name: string, label: string) =>
  `<label>${label}<select name="${name}"><option value="">未评价</option>${[5, 4, 3, 2, 1].map((value) => `<option>${value}</option>`).join("")}</select></label>`;

export function reviewFieldsMarkup(category: string): string {
  if (category === "sports") {
    return `<div class="two"><label>点名<input name="attendance"></label><label>强度<input name="workload"></label></div><label>考核方式<textarea name="assessment"></textarea></label><div class="two"><label>给分说明<input name="grading"></label>${score("gradingScore", "给分评价")}</div>`;
  }
  return `<p class="form-note">请评价这门课程的课堂与考核体验。</p><div class="two">${score("clarity", "讲解清晰度")}${score("knowledge", "知识收获")}</div><div class="two">${score("workloadScore", "时间投入（5 为投入大）")}${score("fairness", "考核公平")}</div><label>考核方式<textarea name="assessment"></textarea></label><label>课堂体验<textarea name="teaching"></textarea></label>`;
}

type TeacherCourseRow = {
  id: number;
  code: string;
  name: string;
  rating: number | null;
  review_count: number;
};

export function teacherCourseRowMarkup(course: TeacherCourseRow): string {
  return `<tr data-course="${course.id}"><td class="code num">${escapeHtml(course.code)}</td><td class="name">${escapeHtml(course.name)}</td><td class="num">${course.rating ? escapeHtml(course.rating) : "—"}</td><td class="num">${escapeHtml(course.review_count)}</td></tr>`;
}
