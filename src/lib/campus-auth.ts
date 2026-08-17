/**
 * Client side of the campus AuthBridge status contract (ADR-0016).
 * While the school whitelist keeps the callback closed the status reports
 * enabled:false and no login URL can be built; once live, appId and
 * authBridgeBaseUrl are present and the login page opens the AuthBridge
 * login in a new tab, pointing its callback back at this origin.
 */
export type CampusAuthStatus = {
  enabled: boolean;
  reason?: string;
  appId?: string;
  authBridgeBaseUrl?: string;
  callbackPath?: string;
};

export function campusAuthUrl(
  status: CampusAuthStatus,
  from: string,
  origin: string,
): string {
  if (!status.enabled || !status.authBridgeBaseUrl || !status.appId) return "";
  const base = status.authBridgeBaseUrl.endsWith("/")
    ? status.authBridgeBaseUrl
    : `${status.authBridgeBaseUrl}/`;
  const callback = new URL(status.callbackPath || "/api/auth/callback", origin);
  callback.searchParams.set("from", from);
  const url = new URL("login", base);
  url.searchParams.set("appid", status.appId);
  url.searchParams.set("mode", "callback");
  url.searchParams.set("callback", callback.toString());
  return url.toString();
}
