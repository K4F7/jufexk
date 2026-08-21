export const CURRENT_SCORES = {
  difficulty: 1,
  homework: 2,
  grading: 3,
  gain: 2,
} as const;

/** Shared v2 copy: four three-tier questions with Chinese labels and options. */
export const TIER3_QUESTIONS = [
  {
    id: "difficulty",
    label: "课程难度",
    prompt: "课程难度",
    scale: "简单 / 中等 / 困难",
    options: [
      { value: 1, label: "简单" },
      { value: 2, label: "中等" },
      { value: 3, label: "困难" },
    ],
  },
  {
    id: "homework",
    label: "作业多少",
    prompt: "作业多少",
    scale: "不多 / 中等 / 超多",
    options: [
      { value: 1, label: "不多" },
      { value: 2, label: "中等" },
      { value: 3, label: "超多" },
    ],
  },
  {
    id: "grading",
    label: "给分好坏",
    prompt: "给分好坏",
    scale: "超好 / 一般 / 杀手",
    options: [
      { value: 1, label: "超好" },
      { value: 2, label: "一般" },
      { value: 3, label: "杀手" },
    ],
  },
  {
    id: "gain",
    label: "收获多少",
    prompt: "收获多少",
    scale: "很多 / 一般 / 没有",
    options: [
      { value: 1, label: "很多" },
      { value: 2, label: "一般" },
      { value: 3, label: "没有" },
    ],
  },
] as const;

export const TIER3_IDS = TIER3_QUESTIONS.map((question) => question.id);

export const CURRENT_SCORES_JSON = JSON.stringify({
  difficulty: 1,
  gain: 2,
  grading: 3,
  homework: 2,
});

export const REQUIRED_NOTE = "这是一条足够十个字的补充说明";

export const V1_OFFLINE_SCORES = {
  teaching: 4,
  attendance: 3,
  grading: 5,
  workload: 2,
} as const;

export const V1_MOOC_SCORES = {
  teaching: 4,
  grading: 5,
  workload: 2,
} as const;
