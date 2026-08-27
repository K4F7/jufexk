import { useCallback, useState } from "react";
import {
  readReviewAdminChromeVisible,
  resolveReviewAdminChromeVisible,
  reviewAdminSessionStorage,
  writeReviewAdminChromeVisible,
} from "../lib/review-admin-chrome";

export function useReviewAdminChrome(preview: string | null) {
  const [storedOn, setStoredOn] = useState(() =>
    readReviewAdminChromeVisible(reviewAdminSessionStorage()),
  );

  const setVisible = useCallback((next: boolean) => {
    setStoredOn(next);
    writeReviewAdminChromeVisible(reviewAdminSessionStorage(), next);
  }, []);

  return {
    visible: resolveReviewAdminChromeVisible({ storedOn, preview }),
    setVisible,
  };
}
