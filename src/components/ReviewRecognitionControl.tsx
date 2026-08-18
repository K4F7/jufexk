import { Alert, Button, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import {
  recognitionButtonLabel,
  recognitionButtonText,
} from "../lib/recognition";
import type { EndorsementState, PublicReview } from "../lib/types";
import { RouterAriaLink } from "./RouterAriaLink";

type Pending = "create" | "withdraw" | null;

export function ReviewRecognitionControl({
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
  // Let the login page offer a way back to the page that sent the user there.
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

  const state = { pending, endorsed, count };

  return (
    <div className="mt-2">
      <Button
        size="sm"
        variant="ghost"
        isPending={pending !== null}
        isDisabled={!ready}
        aria-pressed={endorsed}
        aria-label={recognitionButtonLabel(state)}
        className="aria-pressed:bg-accent-soft aria-pressed:text-accent"
        onPress={() => {
          void press();
        }}
      >
        {({ isPending }) => (
          <>
            {isPending ? <Spinner color="current" size="sm" /> : null}
            {recognitionButtonText(state)}
            {state.count > 0 ? (
              <span className="tabular">· {state.count}</span>
            ) : null}
          </>
        )}
      </Button>
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
          后才能认可评价。
        </p>
      ) : null}
    </div>
  );
}
