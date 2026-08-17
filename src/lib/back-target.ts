const DEFAULT_BACK_TARGET = "/courses";

/**
 * The return target must stay on this site: absolute URLs, protocol-relative
 * URLs and a loop back onto the auth pages themselves all fall back to the
 * catalog.
 */
export function backTargetFrom(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return DEFAULT_BACK_TARGET;
  }
  const path = raw.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  if (path === "/login" || path === "/logout") return DEFAULT_BACK_TARGET;
  return raw;
}
