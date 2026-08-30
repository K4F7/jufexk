import { ThumbsDown, ThumbsDownFill, ThumbsUp, ThumbsUpFill } from "@gravity-ui/icons";
import { Alert, Button, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import {
  challengeButtonLabel,
  recognitionButtonLabel,
  recognitionButtonText,
} from "../lib/recognition";
import type {
  EndorsementState,
  PublicReview,
  ReviewComment,
  ReviewStanceState,
} from "../lib/types";

type Pending = "create" | "withdraw" | null;
type StanceSide = "recognition" | "challenge";

export type ReviewRecognitionAppearance = "label" | "icon";

export function useReviewRecognition({
  review,
  ready,
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
  const confirmedChallengeCount = review.challenge_count || 0;
  const confirmedChallenged = !!review.viewer_challenged;
  const [count, setCount] = useState(confirmedCount);
  const [endorsed, setEndorsed] = useState(confirmedEndorsed);
  const [challengeCount, setChallengeCount] = useState(confirmedChallengeCount);
  const [challenged, setChallenged] = useState(confirmedChallenged);
  const [pendingSide, setPendingSide] = useState<StanceSide | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const loginTarget = `${loginPath}?from=${encodeURIComponent(
    location.pathname + location.search,
  )}`;

  useEffect(() => {
    setCount(confirmedCount);
    setEndorsed(confirmedEndorsed);
    setChallengeCount(confirmedChallengeCount);
    setChallenged(confirmedChallenged);
  }, [
    review.id,
    confirmedCount,
    confirmedEndorsed,
    confirmedChallengeCount,
    confirmedChallenged,
  ]);

  const pressSide = async (side: StanceSide) => {
    if (pending || !ready) return;

    const active = side === "recognition" ? endorsed : challenged;
    const action: Exclude<Pending, null> = active ? "withdraw" : "create";
    const snapshot = { count, endorsed, challengeCount, challenged };
    if (side === "recognition") {
      setEndorsed(action === "create");
      setCount(count + (action === "create" ? 1 : -1));
      if (action === "create" && challenged) {
        setChallenged(false);
        setChallengeCount(Math.max(0, challengeCount - 1));
      }
    } else {
      setChallenged(action === "create");
      setChallengeCount(challengeCount + (action === "create" ? 1 : -1));
      if (action === "create" && endorsed) {
        setEndorsed(false);
        setCount(Math.max(0, count - 1));
      }
    }
    setPendingSide(side);
    setPending(action);
    setError(null);

    try {
      const result = await api<ReviewStanceState>(
        `/api/reviews/${review.id}/${side === "recognition" ? "endorsement" : "challenge"}`,
        {
          method: action === "create" ? "PUT" : "DELETE",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      setCount(result.endorsementCount || 0);
      setEndorsed(!!result.viewerEndorsed);
      setChallengeCount(result.challengeCount || 0);
      setChallenged(!!result.viewerChallenged);
    } catch (cause) {
      setCount(snapshot.count);
      setEndorsed(snapshot.endorsed);
      setChallengeCount(snapshot.challengeCount);
      setChallenged(snapshot.challenged);
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthenticated();
      }
      setError(
        side === "recognition"
          ? "认可失败，已恢复服务器确认的计数。请重试。"
          : "质疑失败，已恢复服务器确认的计数。请重试。",
      );
    } finally {
      setPendingSide(null);
      setPending(null);
    }
  };

  return {
    state: { pending: pendingSide === "recognition" ? pending : null, endorsed, count },
    challenge: {
      pending: pendingSide === "challenge" ? pending : null,
      challenged,
      count: challengeCount,
    },
    busy: pending !== null,
    ready,
    error,
    loginTarget,
    press: () => pressSide("recognition"),
    pressChallenge: () => pressSide("challenge"),
  };
}

export function useCommentRecognition({
  reviewId,
  comment,
  preview,
  ready,
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
      setError(null);
      return;
    }

    const action: Exclude<Pending, null> = endorsed ? "withdraw" : "create";
    const snapshot = { count, endorsed };
    setEndorsed(action === "create");
    setCount(count + (action === "create" ? 1 : -1));
    setPending(action);
    setError(null);

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
      }
      setError("认可失败，已恢复服务器确认的计数。请重试。");
    } finally {
      setPending(null);
    }
  };

  return {
    state: { pending, endorsed, count },
    ready,
    error,
    loginTarget,
    press,
  };
}

export function ReviewRecognitionButton({
  appearance = "label",
  noun = "评价",
  state,
  ready,
  busy,
  onPress,
}: {
  appearance?: ReviewRecognitionAppearance;
  noun?: string;
  state: { pending: Pending; endorsed: boolean; count: number };
  ready: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      isPending={state.pending !== null}
      isDisabled={!ready || !!busy}
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

export function ReviewChallengeButton({
  state,
  ready,
  busy,
  onPress,
}: {
  state: { pending: Pending; challenged: boolean; count: number };
  ready: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      isPending={state.pending !== null}
      isDisabled={!ready || !!busy}
      aria-pressed={state.challenged}
      aria-label={challengeButtonLabel(state)}
      className="aria-pressed:bg-accent-soft aria-pressed:text-accent"
      onPress={onPress}
    >
      {({ isPending }) => (
        <>
          {isPending ? (
            <Spinner color="current" size="sm" />
          ) : state.challenged ? (
            <ThumbsDownFill aria-hidden />
          ) : (
            <ThumbsDown aria-hidden />
          )}
          {state.count > 0 ? (
            <span className="tabular">{state.count}</span>
          ) : null}
        </>
      )}
    </Button>
  );
}

export function ReviewRecognitionAlerts({
  error,
}: {
  error: string | null;
  noun?: string;
}) {
  const failedChallenge = error?.startsWith("质疑") ?? false;
  return error ? (
    <Alert className="mt-1.5" role="alert" status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{failedChallenge ? "质疑失败" : "认可失败"}</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
      </Alert.Content>
    </Alert>
  ) : null;
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
        busy={recognition.challenge.pending !== null}
        onPress={() => {
          void recognition.press();
        }}
      />
      {appearance === "icon" ? (
        <ReviewChallengeButton
          state={recognition.challenge}
          ready={recognition.ready}
          busy={recognition.state.pending !== null}
          onPress={() => {
            void recognition.pressChallenge();
          }}
        />
      ) : null}
      <ReviewRecognitionAlerts error={recognition.error} />
    </div>
  );
}
