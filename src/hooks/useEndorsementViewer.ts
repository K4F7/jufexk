import { useCallback, useEffect, useState } from "react";
import { api, setCsrfToken } from "../lib/api";
import type { EndorsementViewer } from "../lib/types";

const FALLBACK: EndorsementViewer = {
  authenticated: false,
  loginPath: "/login",
  logoutPath: "/logout",
};

export function useEndorsementViewer() {
  const [viewer, setViewer] = useState<EndorsementViewer>(FALLBACK);
  const [ready, setReady] = useState(false);

  const apply = useCallback((next: EndorsementViewer) => {
    setCsrfToken(next.csrfToken || "");
    setViewer({
      authenticated: next.authenticated,
      csrfToken: next.csrfToken,
      loginPath: next.loginPath || FALLBACK.loginPath,
      logoutPath: next.logoutPath || FALLBACK.logoutPath,
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api<EndorsementViewer>("/api/endorsements/viewer"));
    } catch {
      apply(FALLBACK);
    } finally {
      setReady(true);
    }
  }, [apply]);

  const clear = useCallback(() => {
    apply(FALLBACK);
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { viewer, ready, refresh, clear };
}
