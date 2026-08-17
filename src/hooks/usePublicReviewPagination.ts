import { useCallback, useState } from "react";
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

  const reset = useCallback((items: PublicReview[], cursor: string | null) => {
    setReviews(items);
    setNextCursor(cursor);
    setLoadMoreError("");
  }, []);

  const loadMore = useCallback(async () => {
    if (!id || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError("");
    try {
      const query = `${extraQuery ? `${extraQuery}&` : ""}cursor=${encodeURIComponent(nextCursor)}`;
      const page = await api<PublicReviewPage>(
        `/api/${subject}/${id}/reviews?${query}`,
      );
      setReviews((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadMoreError((error as Error).message);
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
