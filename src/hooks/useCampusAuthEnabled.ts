import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { CampusAuthStatus } from "../lib/campus-auth";

/**
 * AuthBridge campus JWT is abandoned. This hook stays fail-closed so leftover
 * callers never treat `/api/auth/campus` as a live login. Ordinary users sign
 * in on `/login` via CAS password proxy.
 */
let campusEnabledCache: Promise<boolean> | null = null;

function loadCampusEnabled(): Promise<boolean> {
  if (!campusEnabledCache) {
    campusEnabledCache = api<CampusAuthStatus>("/api/auth/campus")
      .then((status) => Boolean(status.enabled))
      .catch(() => false);
  }
  return campusEnabledCache;
}

export function useCampusAuthEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCampusEnabled().then((next) => {
      if (!cancelled) setEnabled(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}
