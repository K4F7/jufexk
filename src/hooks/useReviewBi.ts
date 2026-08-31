import { useEffect, useRef } from "react";
import { sendBiBeacon } from "../lib/bi-beacon";

export function useReviewBi(input: {
  courseId?: number;
  teacherId?: number | null;
  active: boolean;
}) {
  const courseId = input.courseId;
  const teacherId = input.teacherId;
  const key =
    input.active && courseId && teacherId ? `${courseId}:${teacherId}` : "";
  const started = useRef(0);
  const flushed = useRef(false);

  useEffect(() => {
    if (!key || !courseId || !teacherId) return;
    sendBiBeacon({ type: "review_view", courseId, teacherId });
    started.current = Date.now();
    flushed.current = false;
    const flush = () => {
      if (flushed.current || !started.current) return;
      flushed.current = true;
      sendBiBeacon({
        type: "review_dwell",
        courseId,
        teacherId,
        ms: Date.now() - started.current,
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, courseId, teacherId]);
}
