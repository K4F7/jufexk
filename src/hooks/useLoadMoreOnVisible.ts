import { useEffect, useRef } from "react";

/**
 * Observe a sentinel and call `loadMore` when it nears the viewport.
 * Disconnects while loading so a still-visible sentinel can fire again
 * after success; stays off when `enabled` is false (e.g. after an error).
 */
export function useLoadMoreOnVisible({
  enabled,
  isLoading,
  loadMore,
}: {
  enabled: boolean;
  isLoading: boolean;
  loadMore: () => void | Promise<unknown>;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    if (!enabled || isLoading) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRef.current();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, isLoading]);

  return sentinelRef;
}
