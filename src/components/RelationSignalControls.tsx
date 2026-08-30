import {
  Heart,
  HeartFill,
  ThumbsDown,
  ThumbsDownFill,
  ThumbsUp,
  ThumbsUpFill,
} from "@gravity-ui/icons";
import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useViewer } from "../hooks/useViewer";
import { ApiError, api } from "../lib/api";
import { invalidateCatalogData } from "../lib/catalog-data-cache";
import type { RelationSignalState, Teacher } from "../lib/types";
import { RouterAriaLink } from "./RouterAriaLink";

type Pending = "follow" | "recommend" | "not_recommend" | null;

function newIdempotencyKey() {
  return crypto.randomUUID();
}

export type RelationSignals = {
  follow: boolean;
  recommend: "none" | "up" | "down";
  pending: Pending;
  error: string;
  loginPrompted: boolean;
  loginTarget: string;
  mutate: (
    kind: Exclude<Pending, null>,
    method: "PUT" | "DELETE",
  ) => Promise<void>;
};

export function useRelationSignals(
  courseId: number,
  teacher: Teacher | null,
): RelationSignals {
  const { viewer, ready, clear } = useViewer();
  const location = useLocation();
  const [follow, setFollow] = useState(!!teacher?.viewer_followed);
  const [recommend, setRecommend] = useState<"none" | "up" | "down">(
    teacher?.viewer_recommended
      ? "up"
      : teacher?.viewer_not_recommended
        ? "down"
        : "none",
  );
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState("");
  const [loginPrompted, setLoginPrompted] = useState(false);
  const loginTarget = `${viewer.loginPath}?from=${encodeURIComponent(
    location.pathname + location.search,
  )}`;

  useEffect(() => {
    setFollow(!!teacher?.viewer_followed);
    setRecommend(
      teacher?.viewer_recommended
        ? "up"
        : teacher?.viewer_not_recommended
          ? "down"
          : "none",
    );
    setError("");
    setLoginPrompted(false);
  }, [
    teacher?.id,
    teacher?.viewer_followed,
    teacher?.viewer_recommended,
    teacher?.viewer_not_recommended,
  ]);

  const mutate = async (
    kind: Exclude<Pending, null>,
    method: "PUT" | "DELETE",
  ) => {
    if (pending || !ready || !teacher) return;
    if (!viewer.authenticated) {
      setLoginPrompted(true);
      return;
    }
    const snapshot = { follow, recommend };
    if (kind === "follow") setFollow(method === "PUT");
    if (kind === "recommend") setRecommend(method === "PUT" ? "up" : "none");
    if (kind === "not_recommend")
      setRecommend(method === "PUT" ? "down" : "none");
    setPending(kind);
    setError("");
    setLoginPrompted(false);
    const path =
      kind === "follow"
        ? "follow"
        : kind === "recommend"
          ? "recommend"
          : "not-recommend";
    try {
      const result = await api<RelationSignalState>(
        `/api/courses/${courseId}/teachers/${teacher.id}/${path}`,
        {
          method,
          headers: { "Idempotency-Key": newIdempotencyKey() },
        },
      );
      setFollow(result.viewerFollowed);
      setRecommend(
        result.viewerRecommended
          ? "up"
          : result.viewerNotRecommended
            ? "down"
            : "none",
      );
      invalidateCatalogData(`/api/courses/${courseId}`);
    } catch (cause) {
      setFollow(snapshot.follow);
      setRecommend(snapshot.recommend);
      if (cause instanceof ApiError && cause.status === 401) {
        clear();
        setLoginPrompted(true);
      } else {
        setError("操作失败，请重试。");
      }
    } finally {
      setPending(null);
    }
  };

  return {
    follow,
    recommend,
    pending,
    error,
    loginPrompted,
    loginTarget,
    mutate,
  };
}

/** Compact follow for the course title row: sm outline, never full-width. */
export function RelationFollowButton({
  signals,
}: {
  signals: RelationSignals;
}) {
  return (
    <Button
      className="shrink-0"
      size="sm"
      variant={signals.follow ? "secondary" : "outline"}
      aria-pressed={signals.follow}
      isPending={signals.pending === "follow"}
      onPress={() =>
        void signals.mutate("follow", signals.follow ? "DELETE" : "PUT")
      }
    >
      {signals.follow ? <HeartFill aria-hidden /> : <Heart aria-hidden />}
      {signals.follow ? "已关注" : "关注"}
    </Button>
  );
}

export function RelationSignalControls({
  signals,
}: {
  signals: RelationSignals;
}) {
  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Button
          fullWidth
          className="max-sm:min-h-11 sm:w-auto"
          size="sm"
          variant={signals.recommend === "up" ? "secondary" : "outline"}
          aria-pressed={signals.recommend === "up"}
          isPending={signals.pending === "recommend"}
          onPress={() =>
            void signals.mutate(
              "recommend",
              signals.recommend === "up" ? "DELETE" : "PUT",
            )
          }
        >
          {signals.recommend === "up" ? (
            <ThumbsUpFill aria-hidden />
          ) : (
            <ThumbsUp aria-hidden />
          )}
          {signals.recommend === "up" ? "已推荐" : "推荐"}
        </Button>
        <Button
          fullWidth
          className="max-sm:min-h-11 sm:w-auto"
          size="sm"
          variant={signals.recommend === "down" ? "secondary" : "outline"}
          aria-pressed={signals.recommend === "down"}
          isPending={signals.pending === "not_recommend"}
          onPress={() =>
            void signals.mutate(
              "not_recommend",
              signals.recommend === "down" ? "DELETE" : "PUT",
            )
          }
        >
          {signals.recommend === "down" ? (
            <ThumbsDownFill aria-hidden />
          ) : (
            <ThumbsDown aria-hidden />
          )}
          {signals.recommend === "down" ? "取消不推荐" : "不推荐"}
        </Button>
      </div>
      {signals.loginPrompted ? (
        <p className="mb-0 mt-2 text-[calc(12/15*1rem)] text-muted">
          登录后才能关注或推荐。
          <RouterAriaLink to={signals.loginTarget} className="ml-1 text-accent">
            去登录
          </RouterAriaLink>
        </p>
      ) : null}
      {signals.error ? (
        <p className="mb-0 mt-2 text-[calc(12/15*1rem)] text-danger" role="alert">
          {signals.error}
        </p>
      ) : null}
    </div>
  );
}
