import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setAdminCsrfToken } from "../lib/api";
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

  const refresh = useCallback(async () => {
    try {
      const d = await api<{ csrfToken: string }>("/api/admin/session");
      setAdminCsrfToken(d.csrfToken);
      setAuthed(true);
    } catch {
      setAdminCsrfToken("");
      setAuthed(false);
    } finally {
      setReady(true);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/api/admin/logout", { method: "POST", body: "{}" });
    } finally {
      setAdminCsrfToken("");
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    if (!viewerReady) return;
    void refresh();
  }, [refresh, viewer.authenticated, viewerReady]);

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
