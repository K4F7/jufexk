export const LATEST_PAGE_SIZE = 20;
export const LATEST_API_PAGE_SIZE = 10;
export const INITIAL_MOBILE_REVIEW_COUNT = 6;

export function latestLoadingSkeletonCount() {
  return window.matchMedia("(max-width: 639px)").matches
    ? INITIAL_MOBILE_REVIEW_COUNT
    : LATEST_PAGE_SIZE;
}
