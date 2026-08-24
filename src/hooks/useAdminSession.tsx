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

/**
 * 管理员会话状态（与普通用户 ViewerProvider 完全分离）。
 * 口令登录拿 HttpOnly jufexk_admin Cookie + CSRF；CSRF 只存内存，
 * 由 api() 按 /api/admin/* 路径单独携带，不碰普通用户令牌。
 */
type AdminSessionContextValue = {
  /** 管理员会话有效（已登录且未过期）。 */
  authed: boolean;
  /** 首次会话探测完成。 */
  ready: boolean;
  /** 口令登录；失败抛 ApiError（message 可直接展示）。 */
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(
  null,
);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
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

  const login = useCallback(async (password: string) => {
    const d = await api<{ csrfToken: string }>("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setAdminCsrfToken(d.csrfToken);
    setAuthed(true);
    setReady(true);
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
    void refresh();
  }, [refresh]);

  const value = useMemo<AdminSessionContextValue>(
    () => ({ authed, ready, login, logout, refresh }),
    [authed, ready, login, logout, refresh],
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
