import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { CampusAuthStatus } from "../lib/campus-auth";

/**
 * Whether campus auth (AuthBridge, ADR-0016) is live, per `/api/auth/campus`.
 * `null` while unknown so callers can hold back entries instead of flashing
 * a clickable control that then gets withdrawn. Fail-closed: any fetch error
 * reports `false`. Fetched once per app lifetime and shared by the shell nav
 * and the account control (Issues #204/#277); when the whitelist opens, every
 * gated entry restores automatically without a code change.
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
