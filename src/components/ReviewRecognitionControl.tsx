import { ThumbsUp, ThumbsUpFill } from "@gravity-ui/icons";
import { Alert, Button, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import {
  recognitionButtonLabel,
  recognitionButtonText,
} from "../lib/recognition";
import type { EndorsementState, PublicReview, ReviewComment } from "../lib/types";
import { RouterAriaLink } from "./RouterAriaLink";

type Pending = "create" | "withdraw" | null;

export type ReviewRecognitionAppearance = "label" | "icon";

export function useReviewRecognition({
  review,
  ready,
  authenticated,
  loginPath,
  onUnauthenticated,
}: {
  review: PublicReview;
  ready: boolean;
  authenticated: boolean;
  loginPath: string;
  onUnauthenticated: () => void;
}) {
  const confirmedCount = review.endorsement_count || 0;
  const confirmedEndorsed = !!review.viewer_endorsed;
  const [count, setCount] = useState(confirmedCount);
  const [endorsed, setEndorsed] = useState(confirmedEndorsed);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginPrompted, setLoginPrompted] = useState(false);
  const location = useLocation();
  const loginTarget = `${loginPath}?from=${encodeURIComponent(
    location.pathname + location.search,
  )}`;

  useEffect(() => {
    setCount(confirmedCount);
    setEndorsed(confirmedEndorsed);
  }, [review.id, confirmedCount, confirmedEndorsed]);

  const press = async () => {
    if (pending || !ready) return;
    if (!authenticated) {
      setLoginPrompted(true);
      return;
    }

    const action: Exclude<Pending, null> = endorsed ? "withdraw" : "create";
    const snapshot = { count, endorsed };
    setEndorsed(action === "create");
    setCount(count + (action === "create" ? 1 : -1));
    setPending(action);
    setError(null);
    setLoginPrompted(false);

    try {
      const result = await api<EndorsementState>(
        `/api/reviews/${review.id}/endorsement`,
        {
          method: action === "create" ? "PUT" : "DELETE",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      setCount(result.endorsementCount);
      setEndorsed(result.viewerEndorsed);
    } catch (cause) {
      setCount(snapshot.count);
      setEndorsed(snapshot.endorsed);
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthenticated();
        setLoginPrompted(true);
        setError(null);
      } else {
        setError("认可失败，已恢复服务器确认的计数。请重试。");
      }
    } finally {
      setPending(null);
    }
  };

  return {
    state: { pending, endorsed, count },
    ready,
    error,
    loginPrompted,
    loginTarget,
    press,
  };
}

export function useCommentRecognition({
  reviewId,
  comment,
  preview,
  ready,
  authenticated,
  loginPath,
  onUnauthenticated,
}: {
  reviewId: string | number;
  comment: ReviewComment;
  preview: boolean;
  ready: boolean;
  authenticated: boolean;
  loginPath: string;
  onUnauthenticated: () => void;
}) {
  const confirmedCount = comment.endorsementCount || 0;
  const confirmedEndorsed = !!comment.viewerEndorsed;
  const [count, setCount] = useState(confirmedCount);
  const [endorsed, setEndorsed] = useState(confirmedEndorsed);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginPrompted, setLoginPrompted] = useState(false);
  const location = useLocation();
  const loginTarget = `${loginPath}?from=${encodeURIComponent(
    location.pathname + location.search,
  )}`;

  useEffect(() => {
    setCount(confirmedCount);
    setEndorsed(confirmedEndorsed);
  }, [comment.id, confirmedCount, confirmedEndorsed]);

  const press = async () => {
    if (pending || !ready) return;
    if (preview) {
      const action: Exclude<Pending, null> = endorsed ? "withdraw" : "create";
      setEndorsed(action === "create");
      setCount(count + (action === "create" ? 1 : -1));
      setLoginPrompted(false);
      setError(null);
      return;
    }
    if (!authenticated) {
      setLoginPrompted(true);
      return;
    }

    const action: Exclude<Pending, null> = endorsed ? "withdraw" : "create";
    const snapshot = { count, endorsed };
    setEndorsed(action === "create");
    setCount(count + (action === "create" ? 1 : -1));
    setPending(action);
    setError(null);
    setLoginPrompted(false);

    try {
      const result = await api<EndorsementState>(
        `/api/reviews/${reviewId}/comments/${comment.id}/endorsement`,
        {
          method: action === "create" ? "PUT" : "DELETE",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      setCount(result.endorsementCount);
      setEndorsed(result.viewerEndorsed);
    } catch (cause) {
      setCount(snapshot.count);
      setEndorsed(snapshot.endorsed);
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthenticated();
        setLoginPrompted(true);
        setError(null);
      } else {
        setError("认可失败，已恢复服务器确认的计数。请重试。");
      }
    } finally {
      setPending(null);
    }
  };

  return {
    state: { pending, endorsed, count },
    ready,
    error,
    loginPrompted,
    loginTarget,
    press,
  };
}

export function ReviewRecognitionButton({
  appearance = "label",
  noun = "评价",
  state,
  ready,
  onPress,
}: {
  appearance?: ReviewRecognitionAppearance;
  noun?: string;
  state: { pending: Pending; endorsed: boolean; count: number };
  ready: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      isPending={state.pending !== null}
      isDisabled={!ready}
      aria-pressed={state.endorsed}
      aria-label={recognitionButtonLabel({ ...state, noun })}
      className="aria-pressed:bg-accent-soft aria-pressed:text-accent"
      onPress={onPress}
    >
      {({ isPending }) =>
        appearance === "icon" ? (
          <>
            {isPending ? (
              <Spinner color="current" size="sm" />
            ) : state.endorsed ? (
              <ThumbsUpFill aria-hidden />
            ) : (
              <ThumbsUp aria-hidden />
            )}
            {state.count > 0 ? (
              <span className="tabular">{state.count}</span>
            ) : null}
          </>
        ) : (
          <>
            {isPending ? <Spinner color="current" size="sm" /> : null}
            {recognitionButtonText(state)}
            {state.count > 0 ? (
              <span className="tabular">· {state.count}</span>
            ) : null}
          </>
        )
      }
    </Button>
  );
}

export function ReviewRecognitionAlerts({
  error,
  loginPrompted,
  loginTarget,
  noun = "评价",
}: {
  error: string | null;
  loginPrompted: boolean;
  loginTarget: string;
  noun?: string;
}) {
  return (
    <>
      {error ? (
        <Alert className="mt-1.5" role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>认可失败</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {loginPrompted ? (
        <p role="status" className="mb-0 mt-1.5 text-xs text-muted">
          <RouterAriaLink to={loginTarget}>使用普通用户登录</RouterAriaLink>
          后才能认可{noun}。
        </p>
      ) : null}
    </>
  );
}

export function ReviewRecognitionControl({
  review,
  ready,
  authenticated,
  loginPath,
  onUnauthenticated,
  appearance = "label",
  className,
}: {
  review: PublicReview;
  ready: boolean;
  authenticated: boolean;
  loginPath: string;
  onUnauthenticated: () => void;
  appearance?: ReviewRecognitionAppearance;
  className?: string;
}) {
  const recognition = useReviewRecognition({
    review,
    ready,
    authenticated,
    loginPath,
    onUnauthenticated,
  });

  return (
    <div className={className ?? (appearance === "icon" ? undefined : "mt-2")}>
      <ReviewRecognitionButton
        appearance={appearance}
        state={recognition.state}
        ready={recognition.ready}
        onPress={() => {
          void recognition.press();
        }}
      />
      <ReviewRecognitionAlerts
        error={recognition.error}
        loginPrompted={recognition.loginPrompted}
        loginTarget={recognition.loginTarget}
      />
    </div>
  );
}
