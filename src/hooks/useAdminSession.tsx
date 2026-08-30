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
import { api, setAdminCsrfToken } from "../lib/api";
import { clearCatalogDataCache } from "../lib/catalog-data-cache";
import { useViewer } from "./useViewer";

/**
 * 管理员会话状态（与普通用户 ViewerProvider 分离）。
 * 已绑定学号的校园登录访问 /api/admin/session 时签发独立 admin cookie；
 * CSRF 只存内存，由 api() 按 /api/admin/* 路径单独携带。
 */
type AdminSessionContextValue = {
  /** 管理员会话有效（已登录且未过期）。 */
  authed: boolean;
  /** 首次会话探测完成。 */
  ready: boolean;
  logout: () => Promise<void>;
  /** Probe the admin session only when a surface needs admin capabilities. */
  ensure: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(
  null,
);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const { viewer, ready: viewerReady } = useViewer();
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const lastViewerAuth = useRef<boolean | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const generation = useRef(0);

  const probe = useCallback(async (requestGeneration: number) => {
    try {
      const d = await api<{ csrfToken: string }>("/api/admin/session");
      if (generation.current !== requestGeneration) return;
      setAdminCsrfToken(d.csrfToken);
      setAuthed((previous) => {
        if (!previous) clearCatalogDataCache();
        return true;
      });
    } catch {
      if (generation.current !== requestGeneration) return;
      setAdminCsrfToken("");
      setAuthed((previous) => {
        if (previous) clearCatalogDataCache();
        return false;
      });
    } finally {
      if (generation.current === requestGeneration) setReady(true);
    }
  }, []);

  const ensure = useCallback(async () => {
    if (!viewerReady) return;
    if (!viewer.authenticated) {
      setReady(true);
      return;
    }
    if (ready && !inFlight.current) return;
    if (inFlight.current) return inFlight.current;
    const requestGeneration = generation.current;
    const request = probe(requestGeneration);
    inFlight.current = request;
    try {
      await request;
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, [probe, ready, viewer.authenticated, viewerReady]);

  const refresh = useCallback(async () => {
    setReady(false);
    generation.current += 1;
    inFlight.current = null;
    if (!viewerReady || !viewer.authenticated) {
      setAdminCsrfToken("");
      setAuthed(false);
      setReady(true);
      return;
    }
    const requestGeneration = generation.current;
    const request = probe(requestGeneration);
    inFlight.current = request;
    try {
      await request;
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, [probe, viewer.authenticated, viewerReady]);

  const logout = useCallback(async () => {
    try {
      await api("/api/admin/logout", { method: "POST", body: "{}" });
    } finally {
      setAdminCsrfToken("");
      setAuthed((previous) => {
        if (previous) clearCatalogDataCache();
        return false;
      });
    }
  }, []);

  useEffect(() => {
    if (!viewerReady) return;
    if (lastViewerAuth.current === viewer.authenticated) return;
    // On the first ready render, a child surface may call ensure() from its
    // effect before this provider effect runs. Do not invalidate that initial
    // probe; only rotate the generation when an already-initialized viewer
    // changes authentication state.
    const hadViewerState = lastViewerAuth.current !== null;
    lastViewerAuth.current = viewer.authenticated;
    if (hadViewerState) {
      generation.current += 1;
      inFlight.current = null;
    }
    setAdminCsrfToken("");
    setAuthed(false);
    setReady(!viewer.authenticated);
  }, [viewer.authenticated, viewerReady]);

  const value = useMemo<AdminSessionContextValue>(
    () => ({ authed, ready, logout, ensure, refresh }),
    [authed, ready, logout, ensure, refresh],
  );

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  const value = useContext(AdminSessionContext);
  if (!value)
    throw new Error("useAdminSession must be used inside AdminSessionProvider");
  return value;
}
