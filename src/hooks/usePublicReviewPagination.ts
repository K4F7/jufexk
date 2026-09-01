import { useCallback, useRef, useState } from "react";
import { api } from "../lib/api";
import type { PublicReview, PublicReviewPage } from "../lib/types";

export function mergePublicReviewPages(
  existing: PublicReview[],
  incoming: PublicReview[],
): PublicReview[] {
  const seen = new Set(existing.map((review) => review.id));
  return [...existing, ...incoming.filter((review) => !seen.has(review.id))];
}

export function usePublicReviewPagination(
  subject: "courses" | "teachers",
  id: string | undefined,
  /** Extra query for scoped feeds, e.g. "teacherId=9" on course pages. */
  extraQuery = "",
) {
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  /** Always-current reviews / cursor / inflight flag so loadMore stays a
   *  stable callback and still accumulates without a stale closure
   *  (Issue #212). */
  const reviewsRef = useRef(reviews);
  const nextCursorRef = useRef(nextCursor);
  const isLoadingMoreRef = useRef(isLoadingMore);
  reviewsRef.current = reviews;
  nextCursorRef.current = nextCursor;
  isLoadingMoreRef.current = isLoadingMore;

  const reset = useCallback((items: PublicReview[], cursor: string | null) => {
    reviewsRef.current = items;
    nextCursorRef.current = cursor;
    setReviews(items);
    setNextCursor(cursor);
    setLoadMoreError("");
  }, []);

  /** Returns the full accumulated page on success, null on failure/skip. */
  const loadMore = useCallback(async (): Promise<PublicReviewPage | null> => {
    const cursor = nextCursorRef.current;
    if (!id || !cursor || isLoadingMoreRef.current) return null;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError("");
    try {
      const query = `${extraQuery ? `${extraQuery}&` : ""}cursor=${encodeURIComponent(cursor)}`;
      const page = await api<PublicReviewPage>(
        `/api/${subject}/${encodeURIComponent(id)}/reviews?${query}`,
      );
      const accumulated = {
        items: mergePublicReviewPages(reviewsRef.current, page.items),
        nextCursor: page.nextCursor,
        total: page.total,
      };
      reviewsRef.current = accumulated.items;
      nextCursorRef.current = accumulated.nextCursor;
      setReviews(accumulated.items);
      setNextCursor(page.nextCursor);
      return accumulated;
    } catch (error) {
      setLoadMoreError((error as Error).message);
      return null;
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [id, subject, extraQuery]);

  return {
    reviews,
    nextCursor,
    isLoadingMore,
    loadMoreError,
    loadMore,
    reset,
  };
}
