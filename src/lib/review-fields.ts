export type ReviewFieldDef =
  | { kind: "text"; name: string; label: string; multiline?: boolean }
  | { kind: "score"; name: string; label: string };

export function reviewFieldsForCategory(category: string): ReviewFieldDef[] {
  if (category === "pe") {
    return [
      { kind: "text", name: "attendance", label: "点名" },
      { kind: "text", name: "workload", label: "强度" },
      { kind: "text", name: "assessment", label: "考核方式", multiline: true },
      { kind: "text", name: "grading", label: "给分说明" },
      { kind: "score", name: "gradingScore", label: "给分评价" },
    ];
  }
  if (category === "general") {
    return [
      { kind: "score", name: "interest", label: "内容吸引力" },
      { kind: "score", name: "practicality", label: "实用与收获" },
      { kind: "score", name: "workloadScore", label: "时间投入（5 为投入大）" },
      { kind: "score", name: "fairness", label: "考核公平" },
      { kind: "score", name: "organization", label: "课堂组织" },
      { kind: "text", name: "assessment", label: "考核方式", multiline: true },
    ];
  }
  return [
    { kind: "text", name: "attendance", label: "点名" },
    { kind: "text", name: "grading", label: "给分" },
    { kind: "text", name: "rescue", label: "是否捞人" },
    { kind: "text", name: "teaching", label: "课堂质量", multiline: true },
    { kind: "score", name: "clarity", label: "讲解清晰度" },
    { kind: "score", name: "knowledge", label: "知识收获" },
  ];
}

export function reviewFieldNames(): string[] {
  return [
    "attendance",
    "grading",
    "gradingScore",
    "rescue",
    "teaching",
    "clarity",
    "knowledge",
    "interest",
    "practicality",
    "workload",
    "workloadScore",
    "fairness",
    "organization",
    "assessment",
  ];
}
