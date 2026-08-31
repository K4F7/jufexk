import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { api, setCsrfToken } from "../lib/api";
import { clearCatalogDataCache } from "../lib/catalog-data-cache";
import {
  previewDevViewerSession,
  readDevIdentity,
} from "../lib/dev-preview";

/**
 * Shared ordinary-user viewer state (issue #139 / ADR-0016).
 * Bootstraps from `/api/user/session`. Login / MFA / email verify may apply
 * the same payload shape in memory — no email, sub or users.id, never
 * localStorage.
 */
export type ViewerSession = {
  authenticated: boolean;
  csrfToken?: string;
  loginPath: string;
  logoutPath: string;
  /** Public handle such as 匿名用户#000001 — never email or student id. */
  handle?: string;
  avatar_key?: number;
};

const GUEST: ViewerSession = {
  authenticated: false,
  loginPath: "/login",
  logoutPath: "/logout",
};

type ViewerContextValue = {
  viewer: ViewerSession;
  ready: boolean;
  refresh: () => Promise<void>;
  applySession: (next: Partial<ViewerSession>) => void;
  clear: () => void;
};

const ViewerContext = createContext<ViewerContextValue | null>(null);

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const identity = readDevIdentity(searchParams);
  const [viewer, setViewer] = useState<ViewerSession>(GUEST);
  const [ready, setReady] = useState(false);
  const previousAuth = useRef<boolean | null>(null);
  const sessionEpoch = useRef(0);
  const refreshGeneration = useRef(0);

  const apply = useCallback((next: Partial<ViewerSession>) => {
    sessionEpoch.current += 1;
    setCsrfToken(next.csrfToken || "");
    const authenticated = !!next.authenticated;
    if (previousAuth.current !== null && previousAuth.current !== authenticated) {
      clearCatalogDataCache();
    }
    previousAuth.current = authenticated;
    setViewer({
      authenticated,
      csrfToken: next.csrfToken,
      loginPath: next.loginPath || GUEST.loginPath,
      logoutPath: next.logoutPath || GUEST.logoutPath,
      handle: authenticated ? next.handle : undefined,
      avatar_key: authenticated ? next.avatar_key : undefined,
    });
  }, []);

  const refresh = useCallback(async () => {
    const requestGeneration = ++refreshGeneration.current;
    const requestEpoch = sessionEpoch.current;
    try {
      const next = await api<Partial<ViewerSession>>("/api/user/session");
      if (
        refreshGeneration.current === requestGeneration &&
        sessionEpoch.current === requestEpoch
      ) {
        apply(next);
      }
    } catch {
      if (
        refreshGeneration.current === requestGeneration &&
        sessionEpoch.current === requestEpoch
      ) {
        apply(GUEST);
      }
    } finally {
      setReady(true);
    }
  }, [apply]);

  const clear = useCallback(() => {
    apply(GUEST);
    setReady(true);
  }, [apply]);

  useEffect(() => {
    if (identity === "guest") {
      apply(GUEST);
      setReady(true);
      return;
    }
    if (identity === "user" || identity === "admin") {
      apply(previewDevViewerSession());
      setReady(true);
      return;
    }
    // Session state is bootstrapped once. Route changes must not overwrite an
    // explicitly applied login session with a stale guest response.
    if (ready) return;

    let cancelled = false;
    const load = () => {
      if (!cancelled) void refresh();
    };

    // Header shows a guest login link immediately; this probe only swaps in
    // the account menu if the visitor is already signed in.
    load();
    return () => {
      cancelled = true;
    };
  }, [apply, identity, ready, refresh]);

  const value = useMemo<ViewerContextValue>(
    () => ({ viewer, ready, refresh, applySession: apply, clear }),
    [viewer, ready, refresh, apply, clear],
  );

  return (
    <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
  );
}

export function useViewer() {
  const value = useContext(ViewerContext);
  if (!value) throw new Error("useViewer must be used inside ViewerProvider");
  return value;
}
