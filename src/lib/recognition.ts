import type { PublicReview } from "./types";

export function isEndorsableReview(review: PublicReview) {
  if (typeof review.endorsable === "boolean") return review.endorsable;
  return (
    typeof review.id === "string" &&
    /^(?:review:\d+|historical:[A-Za-z0-9._-]+|legacy:\d+)$/.test(review.id)
  );
}

export function recognitionButtonText(input: {
  pending: "create" | "withdraw" | null;
  endorsed: boolean;
}) {
  if (input.pending === "create") return "认可中…";
  if (input.pending === "withdraw") return "撤回中…";
  return input.endorsed ? "已认可" : "认可";
}

export function recognitionButtonLabel(input: {
  pending: "create" | "withdraw" | null;
  endorsed: boolean;
  count: number;
  /** 评价或回复；默认评价，保持原 aria-label。 */
  noun?: string;
}) {
  const noun = input.noun ?? "评价";
  if (input.pending === "create") {
    return `正在建立认可，当前 ${input.count} 人认可`;
  }
  if (input.pending === "withdraw") {
    return `正在撤回认可，当前 ${input.count} 人认可`;
  }
  if (input.endorsed) {
    return `已认可，按下可撤回我的认可，当前 ${input.count} 人认可`;
  }
  return input.count > 0
    ? `认可这条${noun}，当前 ${input.count} 人认可`
    : `认可这条${noun}，还没有人认可`;
}

export function challengeButtonLabel(input: {
  pending: "create" | "withdraw" | null;
  challenged: boolean;
  count: number;
}) {
  if (input.pending === "create") {
    return `正在建立质疑，当前 ${input.count} 人质疑`;
  }
  if (input.pending === "withdraw") {
    return `正在撤回质疑，当前 ${input.count} 人质疑`;
  }
  if (input.challenged) {
    return `已质疑，按下可撤回我的质疑，当前 ${input.count} 人质疑`;
  }
  return input.count > 0
    ? `质疑这条评价，当前 ${input.count} 人质疑`
    : `质疑这条评价，还没有人质疑`;
}

/** 质疑至少 3 票且多于认可时，对所有人收起整张卡片。 */
export const REVIEW_FOLD_CHALLENGE_MIN = 3;

export type ReviewFoldKind = "none" | "public";

function meetsPublicFoldThreshold(input: {
  endorsementCount: number;
  challengeCount: number;
}) {
  return (
    input.challengeCount >= REVIEW_FOLD_CHALLENGE_MIN &&
    input.challengeCount > input.endorsementCount
  );
}

/** 只按公开阈值折叠；浏览者自己质疑不单独收起。 */
export function reviewFoldKind(input: {
  endorsementCount: number;
  challengeCount: number;
}): ReviewFoldKind {
  return meetsPublicFoldThreshold(input) ? "public" : "none";
}

export function isReviewFolded(input: {
  endorsementCount: number;
  challengeCount: number;
}) {
  return reviewFoldKind(input) !== "none";
}

export const REVIEW_FOLD_LABEL = "该评价因不受欢迎被折叠";
export const REVIEW_PUBLIC_FOLD_EXPAND_LABEL = "看看";
