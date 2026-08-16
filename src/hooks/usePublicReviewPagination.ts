import { useCallback, useState } from "react";
import { api } from "../lib/api";
import type { PublicReview, PublicReviewPage } from "../lib/types";

export function usePublicReviewPagination(
  subject: "courses" | "teachers",
  id: string | undefined,
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
      const page = await api<PublicReviewPage>(
        `/api/${subject}/${id}/reviews?cursor=${encodeURIComponent(nextCursor)}`,
      );
      setReviews((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadMoreError((error as Error).message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [id, isLoadingMore, nextCursor, subject]);

  return {
    reviews,
    nextCursor,
    isLoadingMore,
    loadMoreError,
    loadMore,
    reset,
  };
}
