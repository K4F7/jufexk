export const CURRENT_SCORES = {
  difficulty: 1,
  homework: 2,
  grading: 3,
  gain: 2,
} as const;

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
