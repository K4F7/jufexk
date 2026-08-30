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

  const refresh = useCallback(async () => {
    try {
      const d = await api<{ csrfToken: string }>("/api/admin/session");
      setAdminCsrfToken(d.csrfToken);
      setAuthed((previous) => {
        if (!previous) clearCatalogDataCache();
        return true;
      });
    } catch {
      setAdminCsrfToken("");
      setAuthed((previous) => {
        if (previous) clearCatalogDataCache();
        return false;
      });
    } finally {
      setReady(true);
    }
  }, []);

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
    if (lastViewerAuth.current === viewer.authenticated && ready) return;
    lastViewerAuth.current = viewer.authenticated;
    void refresh();
  }, [ready, refresh, viewer.authenticated, viewerReady]);

  const value = useMemo<AdminSessionContextValue>(
    () => ({ authed, ready, logout, refresh }),
    [authed, ready, logout, refresh],
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
