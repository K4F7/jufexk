import {
  CAS_USER_AGENT,
  extractCasServiceTicket,
  type CasSsoCookie,
  type CasSsoGrant,
} from "./jxufe-cas";
import { responseSetCookieLines } from "./set-cookie";

export const EHALL_ORIGIN = "http://ehall.jxufe.edu.cn";
export const EHALL_HOME_URL = `${EHALL_ORIGIN}/new/index.html`;
export const EHALL_LOGIN_URL =
  `${EHALL_ORIGIN}/login?service=${encodeURIComponent(EHALL_HOME_URL)}`;
export const EHALL_APP_ID = "5853686007071845";
export const EHALL_APP_URL = `${EHALL_ORIGIN}/appShow?appId=${EHALL_APP_ID}`;
export const JWXT_CALLBACK_ORIGIN = "https://jwxt.jxufe.edu.cn";
export const JWXT_CALLBACK_PATH = "/jxcjcaslogin";
const JWXT_CALLBACK_PATHS = new Set([JWXT_CALLBACK_PATH, `/${JWXT_CALLBACK_PATH}`]);
const JWXT_ENTRY_QUERY_KEYS = [
  "t_s",
  "amp_sec_version_",
  "gid_",
  "EMAP_LANG",
  "THEME",
];
const UPSTREAM_TIMEOUT_MS = 8_000;

const EHALL_COOKIE_NAMES = new Set([
  "asessionid",
  "CASTGC",
  "CASSTOC",
  "JSESSIONID",
  "MOD_AMP_AUTH",
  "route",
]);
const EHALL_SESSION_COOKIE_NAMES = new Set(["asessionid", "CASSTOC", "JSESSIONID"]);
const EHALL_ADAPTER_LOGIN_PATH = "/amp-auth-adapter/login";
const EHALL_ADAPTER_SUCCESS_PATH = "/amp-auth-adapter/loginSuccess";

export type EhallCookie = { name: string; value: string; path: string };
export type EhallUpstreamSession = {
  casCookies: CasSsoCookie[];
  ehallCookies: EhallCookie[];
};
export type EhallLoginPreparation = {
  casLoginUrl: string;
  casServiceUrl: string;
  ehallCookies: EhallCookie[];
};
export type EhallLaunchResult =
  | { status: "redirect"; location: string; session: EhallUpstreamSession }
  | { status: "reauth_required" };

function fetchUpstream(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

export function captureEhallCookies(response: Response): EhallCookie[] {
  const cookies: EhallCookie[] = [];
  for (const raw of responseSetCookieLines(response)) {
    const parts = raw.split(";").map((part) => part.trim());
    const pair = parts[0] || "";
    const equals = pair.indexOf("=");
    if (equals <= 0) continue;
    const name = pair.slice(0, equals);
    const value = pair.slice(equals + 1);
    if (!EHALL_COOKIE_NAMES.has(name) || !value) continue;
    const path =
      parts.find((part) => /^path=/i.test(part))?.slice("path=".length) || "/";
    const allowedPath =
      path === "/" ||
      (name === "MOD_AMP_AUTH" &&
        (path === "/amp-auth-adapter" || path === "/amp-auth-adapter/"));
    if (!allowedPath) continue;
    cookies.push({ name, value, path });
  }
  return cookies;
}

function hasOnlySearchKeys(url: URL, expected: string[]) {
  const keys = [...url.searchParams.keys()];
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function fixedEhallAdapterLoginLocation(raw: string): string | null {
  try {
    const url = new URL(raw, EHALL_ORIGIN);
    if (
      url.origin !== EHALL_ORIGIN ||
      url.pathname !== EHALL_ADAPTER_LOGIN_PATH ||
      !hasOnlySearchKeys(url, ["service"]) ||
      url.toString().length > 2_048
    ) {
      return null;
    }
    const service = new URL(url.searchParams.get("service") || "");
    if (
      service.origin !== EHALL_ORIGIN ||
      service.pathname !== "/login" ||
      !hasOnlySearchKeys(service, ["service"]) ||
      service.searchParams.get("service") !== EHALL_HOME_URL
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function fixedCasAdapterLocation(
  raw: string,
): { location: string; service: string } | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "ssl.jxufe.edu.cn" ||
      url.pathname !== "/cas/login" ||
      !hasOnlySearchKeys(url, ["service"]) ||
      url.toString().length > 2_048
    ) {
      return null;
    }
    const service = new URL(url.searchParams.get("service") || "");
    const sessionToken = service.searchParams.get("sessionToken") || "";
    if (
      service.origin !== EHALL_ORIGIN ||
      service.pathname !== EHALL_ADAPTER_SUCCESS_PATH ||
      !hasOnlySearchKeys(service, ["sessionToken"]) ||
      !/^[A-Za-z0-9._~-]{8,256}$/.test(sessionToken)
    ) {
      return null;
    }
    return { location: url.toString(), service: service.toString() };
  } catch {
    return null;
  }
}

function fixedEhallAdapterTicketLocation(raw: string, expectedService: string) {
  if (!extractCasServiceTicket(raw)) return null;
  try {
    const url = new URL(raw);
    const service = new URL(expectedService);
    if (
      url.origin !== EHALL_ORIGIN ||
      url.pathname !== EHALL_ADAPTER_SUCCESS_PATH ||
      !hasOnlySearchKeys(url, ["sessionToken", "ticket"]) ||
      url.searchParams.get("sessionToken") !== service.searchParams.get("sessionToken") ||
      url.toString().length > 2_048
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function fixedEhallFinalLoginLocation(raw: string) {
  try {
    const url = new URL(raw, EHALL_ORIGIN);
    const adapterTicket = url.searchParams.get("ticket") || "";
    if (
      url.origin !== EHALL_ORIGIN ||
      url.pathname !== "/login" ||
      !hasOnlySearchKeys(url, ["service", "ticket"]) ||
      url.searchParams.get("service") !== EHALL_HOME_URL ||
      !/^[A-Za-z0-9._~-]{8,512}$/.test(adapterTicket) ||
      url.toString().length > 2_048
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function fixedEhallHomeLoginLocation(raw: string) {
  try {
    const url = new URL(raw, EHALL_ORIGIN);
    if (
      url.origin !== EHALL_ORIGIN ||
      url.pathname !== "/login" ||
      !hasOnlySearchKeys(url, ["service"]) ||
      url.searchParams.get("service") !== EHALL_HOME_URL ||
      url.toString().length > 2_048
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function casCookieHeader(cookies: CasSsoCookie[]) {
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

export async function prepareEhallLogin(): Promise<EhallLoginPreparation | null> {
  const entryResponse = await fetchUpstream(EHALL_LOGIN_URL, {
    headers: {
      accept: "text/html,*/*;q=0.8",
      "user-agent": CAS_USER_AGENT,
    },
  });
  let ehallCookies = captureEhallCookies(entryResponse);
  const adapterLogin = fixedEhallAdapterLoginLocation(
    entryResponse.headers.get("location") || "",
  );
  if (![301, 302, 303].includes(entryResponse.status) || !adapterLogin) {
    return null;
  }

  const adapterResponse = await fetchUpstream(adapterLogin, {
    headers: {
      accept: "text/html,*/*;q=0.8",
      cookie: ehallCookieHeader(ehallCookies),
      "user-agent": CAS_USER_AGENT,
    },
  });
  ehallCookies = mergeEhallCookies(ehallCookies, captureEhallCookies(adapterResponse));
  const casAdapter = fixedCasAdapterLocation(
    adapterResponse.headers.get("location") || "",
  );
  if (![301, 302, 303].includes(adapterResponse.status) || !casAdapter) {
    return null;
  }
  return {
    casLoginUrl: casAdapter.location,
    casServiceUrl: casAdapter.service,
    ehallCookies,
  };
}

export async function completePreparedEhallLogin(
  preparation: EhallLoginPreparation,
  grant: CasSsoGrant,
): Promise<EhallUpstreamSession> {
  const ticketLocation = grant.serviceTicketLocation
    ? fixedEhallAdapterTicketLocation(
        grant.serviceTicketLocation,
        preparation.casServiceUrl,
      )
    : null;
  if (!ticketLocation) {
    return { casCookies: grant.cookies, ehallCookies: [] };
  }
  let ehallCookies = preparation.ehallCookies;
  let successResponse = await fetchUpstream(ticketLocation, {
    headers: {
      accept: "text/html,*/*;q=0.8",
      cookie: ehallCookieHeader(ehallCookies),
      "user-agent": CAS_USER_AGENT,
    },
  });
  ehallCookies = mergeEhallCookies(ehallCookies, captureEhallCookies(successResponse));
  let finalLogin = fixedEhallFinalLoginLocation(
    successResponse.headers.get("location") || "",
  );
  if ([301, 302, 303].includes(successResponse.status) && finalLogin !== null) {
    let nextLogin: string | null = finalLogin;
    for (let hop = 0; hop < 2; hop += 1) {
      if (!nextLogin) break;
      successResponse = await fetchUpstream(nextLogin, {
        headers: {
          accept: "text/html,*/*;q=0.8",
          cookie: ehallCookieHeader(ehallCookies),
          "user-agent": CAS_USER_AGENT,
        },
      });
      ehallCookies = mergeEhallCookies(
        ehallCookies,
        captureEhallCookies(successResponse),
      );
      if (![301, 302, 303].includes(successResponse.status)) break;
      const next = successResponse.headers.get("location") || "";
      const nextTicket = fixedEhallFinalLoginLocation(next);
      const nextHome = fixedEhallHomeLoginLocation(next);
      if (!nextTicket && !nextHome) break;
      nextLogin = nextTicket || nextHome;
    }
  }
  return {
    casCookies: grant.cookies,
    ehallCookies: ehallCookies.some(({ name }) => EHALL_SESSION_COOKIE_NAMES.has(name))
      ? ehallCookies
      : [],
  };
}

export async function establishEhallSession(
  grant: CasSsoGrant,
): Promise<EhallUpstreamSession> {
  const preparation = await prepareEhallLogin();
  if (!preparation) return { casCookies: grant.cookies, ehallCookies: [] };
  const casResponse = await fetchUpstream(preparation.casLoginUrl, {
    headers: {
      accept: "text/html,*/*;q=0.8",
      cookie: casCookieHeader(grant.cookies),
      "user-agent": CAS_USER_AGENT,
    },
  });
  const serviceTicketLocation = fixedEhallAdapterTicketLocation(
    casResponse.headers.get("location") || "",
    preparation.casServiceUrl,
  );
  if (![301, 302, 303].includes(casResponse.status) || !serviceTicketLocation) {
    return { casCookies: grant.cookies, ehallCookies: [] };
  }
  return completePreparedEhallLogin(preparation, {
    ...grant,
    serviceTicketLocation,
  });
}

function mergeEhallCookies(current: EhallCookie[], incoming: EhallCookie[]) {
  const merged = new Map(current.map((cookie) => [cookie.name, cookie]));
  for (const cookie of incoming) merged.set(cookie.name, cookie);
  return [...merged.values()];
}

function ehallCookieHeader(cookies: EhallCookie[]) {
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

function jwxtServiceFromCasLocation(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "ssl.jxufe.edu.cn" ||
      url.pathname !== "/cas/login" ||
      !hasOnlySearchKeys(url, ["service"])
    ) {
      return null;
    }
    const service = new URL(url.searchParams.get("service") || "");
    if (
      service.protocol !== "https:" ||
      service.origin !== JWXT_CALLBACK_ORIGIN ||
      !JWXT_CALLBACK_PATHS.has(service.pathname) ||
      !hasOnlySearchKeys(service, []) ||
      service.toString().length > 1_024
    ) {
      return null;
    }
    return service.toString();
  } catch {
    return null;
  }
}

function fixedJwxtEntry(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.origin !== JWXT_CALLBACK_ORIGIN ||
      !JWXT_CALLBACK_PATHS.has(url.pathname) ||
      url.searchParams.has("ticket") ||
      !hasOnlySearchKeys(url, JWXT_ENTRY_QUERY_KEYS) ||
      url.toString().length > 1_024
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function fixedJwxtTicketLocation(raw: string, expectedService: string) {
  if (!extractCasServiceTicket(raw)) return null;
  try {
    const location = new URL(raw);
    const service = new URL(expectedService);
    if (
      location.origin !== service.origin ||
      location.pathname !== service.pathname ||
      !hasOnlySearchKeys(location, [...service.searchParams.keys(), "ticket"]) ||
      location.toString().length > 2_048
    ) {
      return null;
    }
    for (const [key, value] of service.searchParams) {
      if (location.searchParams.get(key) !== value) return null;
    }
    return location.toString();
  } catch {
    return null;
  }
}

export async function launchJwxtFromEhall(
  session: EhallUpstreamSession,
): Promise<EhallLaunchResult> {
  if (!session.casCookies.length) {
    return { status: "reauth_required" };
  }
  let activeSession = session;
  if (!activeSession.ehallCookies.length) {
    activeSession = await establishEhallSession({
      cookies: session.casCookies,
      serviceTicketLocation: null,
    });
    if (!activeSession.ehallCookies.length) {
      return { status: "reauth_required" };
    }
  }
  const fetchApp = (active: EhallUpstreamSession) => fetchUpstream(EHALL_APP_URL, {
    headers: {
      accept: "text/html,*/*;q=0.8",
      cookie: ehallCookieHeader(active.ehallCookies),
      "user-agent": CAS_USER_AGENT,
    },
  });
  let appResponse = await fetchApp(activeSession);
  if (![301, 302, 303].includes(appResponse.status)) {
    return { status: "reauth_required" };
  }
  let casLocation = appResponse.headers.get("location") || "";
  try {
    const location = new URL(casLocation, EHALL_ORIGIN);
    if (
      location.hostname === "ehall.jxufe.edu.cn" &&
      /^\/login(?:;jsessionid=[A-Za-z0-9._~-]{1,256})?$/.test(location.pathname)
    ) {
      activeSession = await establishEhallSession({
        cookies: session.casCookies,
        serviceTicketLocation: null,
      });
      if (!activeSession.ehallCookies.length) {
        return { status: "reauth_required" };
      }
      appResponse = await fetchApp(activeSession);
      if (![301, 302, 303].includes(appResponse.status)) {
        return { status: "reauth_required" };
      }
      casLocation = appResponse.headers.get("location") || "";
    }
  } catch {
    return { status: "reauth_required" };
  }
  let service = jwxtServiceFromCasLocation(casLocation);
  if (!service) {
    const jwxtEntry = fixedJwxtEntry(casLocation);
    if (!jwxtEntry) return { status: "reauth_required" };
    const jwxtResponse = await fetchUpstream(jwxtEntry, {
      headers: {
        accept: "text/html,*/*;q=0.8",
        "user-agent": CAS_USER_AGENT,
      },
    });
    if (![301, 302, 303].includes(jwxtResponse.status)) {
      return { status: "reauth_required" };
    }
    casLocation = jwxtResponse.headers.get("location") || "";
    service = jwxtServiceFromCasLocation(casLocation);
  }
  if (!service) return { status: "reauth_required" };
  const casResponse = await fetchUpstream(casLocation, {
    headers: {
      accept: "text/html,*/*;q=0.8",
      cookie: casCookieHeader(session.casCookies),
      "user-agent": CAS_USER_AGENT,
    },
  });
  if (![301, 302, 303].includes(casResponse.status)) {
    return { status: "reauth_required" };
  }
  const location = fixedJwxtTicketLocation(
    casResponse.headers.get("location") || "",
    service,
  );
  return location
    ? { status: "redirect", location, session: activeSession }
    : { status: "reauth_required" };
}
