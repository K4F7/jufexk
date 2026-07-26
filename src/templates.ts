const score = (name: string, label: string) =>
  `<label>${label}<select name="${name}"><option value="">未评价</option>${[5, 4, 3, 2, 1].map((value) => `<option>${value}</option>`).join("")}</select></label>`;

export function reviewFieldsMarkup(category: string): string {
  if (category === "pe") {
    return `<div class="two"><label>点名<input name="attendance"></label><label>强度<input name="workload"></label></div><label>考核方式<textarea name="assessment"></textarea></label><div class="two"><label>给分说明<input name="grading"></label>${score("gradingScore", "给分评价")}</div>`;
  }
  if (category === "general") {
    return `<p class="form-note">请评价这门公共选修课本身的体验。</p><div class="two">${score("interest", "内容吸引力")}${score("practicality", "实用与收获")}</div><div class="two">${score("workloadScore", "时间投入（5 为投入大）")}${score("fairness", "考核公平")}</div>${score("organization", "课堂组织")}<label>考核方式<textarea name="assessment"></textarea></label>`;
  }
  return `<div class="two"><label>点名<input name="attendance"></label><label>给分<input name="grading"></label></div><label>是否捞人<input name="rescue"></label><label>课堂质量<textarea name="teaching"></textarea></label><div class="two">${score("clarity", "讲解清晰度")}${score("knowledge", "知识收获")}</div>`;
}
