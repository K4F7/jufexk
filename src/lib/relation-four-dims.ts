import { REVIEW_DIMENSIONS } from "./review-dimensions";
import {
  publicDimensionLabels,
  type PublicDimensionLabel,
} from "./review-schemes";

export type FourDimSnapshot = {
  schemeKey?: unknown;
  schemeVersion?: unknown;
  scores?: unknown;
};

/**
 * 关系级四维代表档位（#410）：只聚合带新四维快照的公开评价
 * （#373：旧 1–5 快照不译成新三档）。每维取众数；并列时取该维
 * 定义顺序里更靠前的档位。没有任何新四维快照时返回 null，前端显示「—」。
 */
export function aggregateRelationDimensionLabels(
  snapshots: readonly FourDimSnapshot[],
): PublicDimensionLabel[] | null {
  const counts = new Map<string, Map<string, number>>();
  const meta = new Map<string, { label: string; optionOrder: string[] }>();

  for (const snapshot of snapshots) {
    const labels = publicDimensionLabels(snapshot);
    if (!labels) continue;
    for (const item of labels) {
      if (!meta.has(item.id)) {
        meta.set(item.id, { label: item.label, optionOrder: [] });
      }
      const entry = meta.get(item.id);
      if (entry && !entry.optionOrder.includes(item.option)) {
        entry.optionOrder.push(item.option);
      }
      const options = counts.get(item.id) ?? new Map<string, number>();
      options.set(item.option, (options.get(item.option) ?? 0) + 1);
      counts.set(item.id, options);
    }
  }

  if (!counts.size) return null;

  const labels: PublicDimensionLabel[] = [];
  for (const dim of REVIEW_DIMENSIONS) {
    const options = counts.get(dim.key);
    const info = meta.get(dim.key);
    if (!options || !info) continue;
    let winner: string | null = null;
    let winnerCount = 0;
    for (const option of info.optionOrder) {
      const n = options.get(option) ?? 0;
      if (n > winnerCount) {
        winner = option;
        winnerCount = n;
      }
    }
    if (winner) {
      labels.push({ id: dim.key, label: info.label, option: winner });
    }
  }
  return labels.length ? labels : null;
}

export function relationDimensionKey(courseId: number, teacherId: number | null) {
  return `${courseId}:${teacherId ?? "none"}`;
}
