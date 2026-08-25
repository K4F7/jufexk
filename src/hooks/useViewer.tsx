import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setCsrfToken } from "../lib/api";

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
  const [viewer, setViewer] = useState<ViewerSession>(GUEST);
  const [ready, setReady] = useState(false);

  const apply = useCallback((next: Partial<ViewerSession>) => {
    setCsrfToken(next.csrfToken || "");
    const authenticated = !!next.authenticated;
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
    try {
      apply(await api<Partial<ViewerSession>>("/api/user/session"));
    } catch {
      apply(GUEST);
    } finally {
      setReady(true);
    }
  }, [apply]);

  const clear = useCallback(() => {
    apply(GUEST);
    setReady(true);
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
