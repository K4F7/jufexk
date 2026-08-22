/**
 * Abandoned AuthBridge status contract. Campus login is CAS password proxy
 * on `/login`. This helper never builds an AuthBridge URL.
 */
export type CampusAuthStatus = {
  enabled: boolean;
  reason?: string;
  appId?: string;
  authBridgeBaseUrl?: string;
  callbackPath?: string;
};

export function campusAuthUrl(
  _status: CampusAuthStatus,
  _from: string,
  _origin: string,
): string {
  return "";
}
