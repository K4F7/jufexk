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

/** v3 追加的公共核第五题：考勤松紧（三档，仅线下适用，#371 锁定文案）。 */
export const ATTENDANCE_QUESTION = {
  id: "attendance",
  label: "考勤松紧",
  prompt: "考勤松紧",
  scale: "宽松 / 一般 / 严苛",
  options: [
    { value: 1, label: "宽松" },
    { value: 2, label: "一般" },
    { value: 3, label: "严苛" },
  ],
} as const;

/** Shared v3 copy: the v2 four three-tier questions plus 考勤松紧. */
export const V3_QUESTIONS = [...TIER3_QUESTIONS, ATTENDANCE_QUESTION] as const;

export const V3_IDS = V3_QUESTIONS.map((question) => question.id);

/** Latest-version scores for an offline course: v3, attendance included. */
export const V3_OFFLINE_SCORES = {
  ...CURRENT_SCORES,
  attendance: 2,
} as const;

export const CURRENT_SCORES_JSON = JSON.stringify({
  difficulty: 1,
  gain: 2,
  grading: 3,
  homework: 2,
});

export const V3_OFFLINE_SCORES_JSON = JSON.stringify({
  attendance: 2,
  difficulty: 1,
  gain: 2,
  grading: 3,
  homework: 2,
});

export const REQUIRED_NOTE = "这是一条足够十个字的补充说明";

/** 一句话总结本课（#444）：新投稿必填，测试默认携带。 */
export const REQUIRED_HEADLINE = "一句话总结：值得选";

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
