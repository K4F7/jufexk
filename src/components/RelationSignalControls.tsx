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
import type { RelationSignalState, Teacher } from "../lib/types";
import { RouterAriaLink } from "./RouterAriaLink";

type Pending = "follow" | "recommend" | "not_recommend" | null;

function newIdempotencyKey() {
  return crypto.randomUUID();
}

export function RelationSignalControls({
  courseId,
  teacher,
}: {
  courseId: number;
  teacher: Teacher;
}) {
  const { viewer, ready, clear } = useViewer();
  const location = useLocation();
  const [follow, setFollow] = useState(!!teacher.viewer_followed);
  const [recommend, setRecommend] = useState<"none" | "up" | "down">(
    teacher.viewer_recommended
      ? "up"
      : teacher.viewer_not_recommended
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
    setFollow(!!teacher.viewer_followed);
    setRecommend(
      teacher.viewer_recommended
        ? "up"
        : teacher.viewer_not_recommended
          ? "down"
          : "none",
    );
    setError("");
    setLoginPrompted(false);
  }, [
    teacher.id,
    teacher.viewer_followed,
    teacher.viewer_recommended,
    teacher.viewer_not_recommended,
  ]);

  const mutate = async (
    kind: Exclude<Pending, null>,
    method: "PUT" | "DELETE",
  ) => {
    if (pending || !ready) return;
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

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={follow ? "secondary" : "outline"}
          aria-pressed={follow}
          isPending={pending === "follow"}
          onPress={() => mutate("follow", follow ? "DELETE" : "PUT")}
        >
          {follow ? <HeartFill aria-hidden /> : <Heart aria-hidden />}
          {follow ? "已关注" : "关注"}
        </Button>
        <Button
          size="sm"
          variant={recommend === "up" ? "secondary" : "outline"}
          aria-pressed={recommend === "up"}
          isPending={pending === "recommend"}
          onPress={() =>
            mutate("recommend", recommend === "up" ? "DELETE" : "PUT")
          }
        >
          {recommend === "up" ? (
            <ThumbsUpFill aria-hidden />
          ) : (
            <ThumbsUp aria-hidden />
          )}
          {recommend === "up" ? "已推荐" : "推荐"}
        </Button>
        <Button
          size="sm"
          variant={recommend === "down" ? "secondary" : "outline"}
          aria-pressed={recommend === "down"}
          isPending={pending === "not_recommend"}
          onPress={() =>
            mutate("not_recommend", recommend === "down" ? "DELETE" : "PUT")
          }
        >
          {recommend === "down" ? (
            <ThumbsDownFill aria-hidden />
          ) : (
            <ThumbsDown aria-hidden />
          )}
          {recommend === "down" ? "取消不推荐" : "不推荐"}
        </Button>
      </div>
      {loginPrompted ? (
        <p className="mb-0 mt-2 text-[calc(12/15*1rem)] text-muted">
          登录后才能关注或推荐。
          <RouterAriaLink to={loginTarget} className="ml-1 text-accent">
            去登录
          </RouterAriaLink>
        </p>
      ) : null}
      {error ? (
        <p className="mb-0 mt-2 text-[calc(12/15*1rem)] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
