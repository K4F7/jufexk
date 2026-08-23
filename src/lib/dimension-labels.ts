import { REVIEW_DIMENSIONS } from "./review-dimensions";
import type { PublicReviewDimensionLabel } from "./types";

/** Map relation/review dimensionLabels onto FourDimLine's ordered slots. */
export function fourDimLineLabels(
  labels?: readonly PublicReviewDimensionLabel[] | null,
): Array<string | null> | null {
  if (!labels?.length) return null;
  return REVIEW_DIMENSIONS.map(
    (dim) => labels.find((item) => item.id === dim.key)?.option ?? null,
  );
}
