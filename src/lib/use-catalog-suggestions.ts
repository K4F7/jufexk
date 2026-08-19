import { useEffect, useState } from "react";
import {
  CATALOG_SUGGEST_DELAY,
  shouldFetchCatalogSuggestions,
} from "./catalog-search-suggest";

export function useCatalogSuggestions<T>(
  draft: string,
  load: (query: string, signal: AbortSignal) => Promise<T[]>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!shouldFetchCatalogSuggestions(draft)) {
      setItems([]);
      setReady(false);
      setFailed(false);
      return;
    }

    const controller = new AbortController();
    setItems([]);
    setReady(false);
    const timer = window.setTimeout(() => {
      load(draft.trim(), controller.signal)
        .then((next) => {
          setItems(next);
          setFailed(false);
          setReady(true);
        })
        .catch((error: { name?: string }) => {
          if (error?.name === "AbortError") return;
          setItems([]);
          setFailed(true);
          setReady(false);
        });
    }, CATALOG_SUGGEST_DELAY);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft, load]);

  return { items, ready, failed };
}
