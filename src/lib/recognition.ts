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
