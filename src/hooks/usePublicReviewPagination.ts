import { useCallback, useRef, useState } from "react";
import { api } from "../lib/api";
import type { PublicReview, PublicReviewPage } from "../lib/types";

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
  /** Always-current reviews so loadMore accumulates without a stale closure
   *  and can report the full loaded list back to callers (Issue #212). */
  const reviewsRef = useRef(reviews);

  const reset = useCallback((items: PublicReview[], cursor: string | null) => {
    reviewsRef.current = items;
    setReviews(items);
    setNextCursor(cursor);
    setLoadMoreError("");
  }, []);

  /** Returns the full accumulated page on success, null on failure/skip. */
  const loadMore = useCallback(async (): Promise<PublicReviewPage | null> => {
    if (!id || !nextCursor || isLoadingMore) return null;
    setIsLoadingMore(true);
    setLoadMoreError("");
    try {
      const query = `${extraQuery ? `${extraQuery}&` : ""}cursor=${encodeURIComponent(nextCursor)}`;
      const page = await api<PublicReviewPage>(
        `/api/${subject}/${id}/reviews?${query}`,
      );
      const accumulated = {
        items: [...reviewsRef.current, ...page.items],
        nextCursor: page.nextCursor,
        total: page.total,
      };
      reviewsRef.current = accumulated.items;
      setReviews(accumulated.items);
      setNextCursor(page.nextCursor);
      return accumulated;
    } catch (error) {
      setLoadMoreError((error as Error).message);
      return null;
    } finally {
      setIsLoadingMore(false);
    }
  }, [id, isLoadingMore, nextCursor, subject, extraQuery]);

  return {
    reviews,
    nextCursor,
    isLoadingMore,
    loadMoreError,
    loadMore,
    reset,
  };
}
