export const LATEST_PAGE_SIZE = 20;
export const LATEST_API_PAGE_SIZE = 10;
export const INITIAL_MOBILE_REVIEW_COUNT = 6;

/** Centered readable column; do not full-bleed across the 1520px shell. */
export const LATEST_FEED_COLUMN_CLASS = "mx-auto w-full max-w-[720px]";

/**
 * Keep the desktop footer below the first viewport while /latest is still
 * a short loading shell or a short first batch. Loaded cards stay hugging.
 */
export const LATEST_FEED_VIEWPORT_RESERVE_CLASS = "min-h-[100dvh]";

/** Shared chrome for loaded latest rows. No min-height — cards hug content. */
export const LATEST_REVIEW_ROW_CLASS =
  "min-w-0 border-b border-separator py-3 last:border-b-0 sm:py-5";

/**
 * First-paint / unrevealed-slot reservation only.
 * 12rem (192px) covers a typical 2–4 line review + header + 「查看全文」
 * after the one-line header, instead of the old 22rem (352px) void.
 */
export const LATEST_REVIEW_RESERVED_MIN_CLASS = "min-h-[12rem] sm:min-h-40";

export const LATEST_REVIEW_RESERVED_ROW_CLASS = `${LATEST_REVIEW_ROW_CLASS} ${LATEST_REVIEW_RESERVED_MIN_CLASS}`;

export function latestLoadingSkeletonCount() {
  return window.matchMedia("(max-width: 639px)").matches
    ? INITIAL_MOBILE_REVIEW_COUNT
    : LATEST_PAGE_SIZE;
}

/** Keep a 20-row shell until the feed itself is taller than the first page. */
export function latestReservedSpacerCount(
  itemCount: number,
  renderedItemCount: number,
) {
  const reservedRows = Math.max(itemCount, LATEST_PAGE_SIZE);
  const visibleRows = Math.min(itemCount, renderedItemCount);
  return Math.max(0, reservedRows - visibleRows);
}

/** Reserve a viewport of height during first-page load or a short first batch. */
export function latestFeedNeedsViewportReserve(
  loading: boolean,
  itemCount: number,
  renderedItemCount: number,
) {
  if (itemCount === 0) return loading;
  return latestReservedSpacerCount(itemCount, renderedItemCount) > 0;
}

export function latestFeedColumnClass(reserveViewport: boolean) {
  return reserveViewport
    ? `${LATEST_FEED_COLUMN_CLASS} ${LATEST_FEED_VIEWPORT_RESERVE_CLASS}`
    : LATEST_FEED_COLUMN_CLASS;
}
