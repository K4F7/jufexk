import { responseSetCookieLines } from "../../src/lib/set-cookie";
import { startCasPasswordLogin, type CasSsoGrant } from "../../src/lib/jxufe-cas";
import {
  EHALL_APP_URL,
  EHALL_ORIGIN,
  JWXT_CALLBACK_ORIGIN,
  JWXT_CALLBACK_PATH,
  completePreparedEhallLogin,
  launchJwxtFromEhall,
  prepareEhallLogin,
} from "../../src/lib/jxufe-ehall";

const JWXT_ORIGIN = "https://jwxt.jxufe.edu.cn";
const USER_AGENT = "jufexk-jwxt-collector/1.0 (+https://github.com/K4F7/jufexk)";

export class UnsupportedJwxtAuthenticationError extends Error {}
export class JwxtAuthenticationError extends Error {}
export class JwxtCookieExpiredError extends UnsupportedJwxtAuthenticationError {}
export class EhallCookieExpiredError extends UnsupportedJwxtAuthenticationError {}

type FetchLike = typeof fetch;

function cookieHeader(cookies: Map<string, string>) {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

const COOKIE_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;
const MAX_COOKIE_HEADER_LENGTH = 4_096;

export function parseJwxtCookieHeader(raw: string) {
  const value = raw.trim();
  if (!value || value.length > MAX_COOKIE_HEADER_LENGTH || /[\r\n]/.test(value)) {
    throw new JwxtAuthenticationError("jwxt_cookie_invalid");
  }
  const cookies = new Map<string, string>();
  for (const part of value.split(";")) {
    const item = part.trim();
    if (!item) continue;
    const equals = item.indexOf("=");
    if (equals <= 0) throw new JwxtAuthenticationError("jwxt_cookie_invalid");
    const name = item.slice(0, equals).trim();
    const cookieValue = item.slice(equals + 1).trim();
    if (
      !COOKIE_NAME.test(name) ||
      !cookieValue ||
      /[\r\n]/.test(cookieValue) ||
      [...cookieValue].some((character) => {
        const code = character.charCodeAt(0);
        return code < 0x21 || code > 0x7e;
      })
    ) {
      throw new JwxtAuthenticationError("jwxt_cookie_invalid");
    }
    cookies.set(name, cookieValue);
  }
  if (!cookies.has("JSESSIONID")) {
    throw new JwxtAuthenticationError("jwxt_cookie_missing_jsessionid");
  }
  return cookies;
}

export function parseEhallCookieHeader(raw: string) {
  return parseJwxtCookieHeader(raw);
}

function captureCookies(cookies: Map<string, string>, response: Response) {
  for (const raw of responseSetCookieLines(response)) {
    const pair = raw.split(";", 1)[0] || "";
    const equals = pair.indexOf("=");
    if (equals <= 0) continue;
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    if (!value || /(?:^|;)\s*max-age=0\b/i.test(raw)) cookies.delete(name);
    else cookies.set(name, value);
  }
}

function fixedJwxtUrl(raw: string, base = JWXT_ORIGIN) {
  const url = new URL(raw, base);
  if (url.protocol !== "https:" || url.origin !== JWXT_ORIGIN || url.toString().length > 2_048) {
    throw new JwxtAuthenticationError("jwxt_redirect_blocked");
  }
  return url.toString();
}

abstract class JwxtSessionAdapter {
  protected constructor(
    protected readonly cookies: Map<string, string>,
    protected readonly fetchImpl: FetchLike,
    private readonly canRelogin: boolean,
  ) {}

  private loginPromise: Promise<void> | null = null;

  protected abstract establishSession(): Promise<void>;

  protected async followTicket(location: string) {
    let url = fixedJwxtUrl(location);
    for (let hop = 0; hop < 6; hop += 1) {
      const response = await this.fetchImpl(url, {
        redirect: "manual",
        headers: {
          accept: "text/html,*/*;q=0.8",
          cookie: cookieHeader(this.cookies),
          "user-agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(15_000),
      });
      captureCookies(this.cookies, response);
      const next = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || !next) break;
      url = fixedJwxtUrl(next, url);
    }
    if (!this.cookies.has("JSESSIONID")) {
      throw new JwxtAuthenticationError("jwxt_session_cookie_missing");
    }
  }

  protected async establishPasswordSession(username: string, password: string) {
    const preparation = await prepareEhallLogin();
    if (!preparation) throw new JwxtAuthenticationError("ehall_protocol_changed");
    const result = await startCasPasswordLogin(
      username,
      password,
      preparation.casServiceUrl,
    );
    if (!result.ok) {
      if (result.needsMfa) {
        throw new UnsupportedJwxtAuthenticationError("cas_mfa_required");
      }
      if (/验证码/.test(result.error)) {
        throw new UnsupportedJwxtAuthenticationError("cas_captcha_required");
      }
      throw new JwxtAuthenticationError(`cas_login_failed:${result.status}`);
    }
    if (!result.sso) throw new JwxtAuthenticationError("cas_sso_grant_missing");
    const session = await completePreparedEhallLogin(
      preparation,
      result.sso as CasSsoGrant,
    );
    const launch = await launchJwxtFromEhall(session);
    if (launch.status !== "redirect") {
      throw new JwxtAuthenticationError("jwxt_service_ticket_missing");
    }
    this.cookies.clear();
    await this.followTicket(launch.location);
  }

  async login() {
    if (!this.loginPromise) {
      this.loginPromise = this.establishSession().finally(() => {
        this.loginPromise = null;
      });
    }
    return this.loginPromise;
  }

  async request(path: string, init: RequestInit = {}, allowRelogin = true): Promise<Response> {
    if (!this.cookies.has("JSESSIONID")) await this.login();
    const url = fixedJwxtUrl(path);
    const headers = new Headers(init.headers);
    headers.set("cookie", cookieHeader(this.cookies));
    headers.set("user-agent", USER_AGENT);
    const response = await this.fetchImpl(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
    captureCookies(this.cookies, response);
    const location = response.headers.get("location") || "";
    const expired =
      response.status === 401 ||
      /ssl\.jxufe\.edu\.cn\/cas\/login|\/cas\/login\.action/i.test(location);
    if (expired && !this.canRelogin) {
      throw new JwxtCookieExpiredError("jwxt_cookie_expired");
    }
    if (expired && allowRelogin) {
      this.cookies.clear();
      await this.login();
      return this.request(path, init, false);
    }
    return response;
  }
}

export class JwxtAuthAdapter extends JwxtSessionAdapter {
  constructor(
    private readonly username: string,
    private readonly password: string,
    fetchImpl: FetchLike = fetch,
  ) {
    super(new Map(), fetchImpl, true);
  }

  protected establishSession() {
    return this.establishPasswordSession(this.username, this.password);
  }
}

/**
 * Uses a browser-exported Cookie header for manual or scheduled collection.
 * It deliberately cannot perform a password login or refresh an expired cookie.
 */
export class JwxtCookieAuthAdapter extends JwxtSessionAdapter {
  constructor(rawCookie: string, fetchImpl: FetchLike = fetch) {
    super(parseJwxtCookieHeader(rawCookie), fetchImpl, false);
  }

  protected establishSession(): Promise<void> {
    return Promise.reject(new JwxtCookieExpiredError("jwxt_cookie_expired"));
  }
}

const CAS_ORIGIN = "https://ssl.jxufe.edu.cn";
const CAS_COOKIE_NAMES = new Set(["TGC", "SESSION", "CASTGC", "CASSTOC"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function fixedBrowserRedirect(raw: string, base: string) {
  const url = new URL(raw, base);
  if (url.toString().length > 2_048) {
    throw new JwxtAuthenticationError("ehall_redirect_blocked");
  }
  if (![EHALL_ORIGIN, CAS_ORIGIN, JWXT_CALLBACK_ORIGIN].includes(url.origin)) {
    throw new JwxtAuthenticationError("ehall_redirect_blocked");
  }
  return url;
}

/**
 * Replays the browser's eHall session, then follows the fixed eHall/CAS/JWXT
 * redirect chain until JWXT issues a fresh JSESSIONID.
 */
export class EhallCookieAuthAdapter extends JwxtSessionAdapter {
  private readonly ehallCookies: Map<string, string>;
  private readonly casCookies = new Map<string, string>();

  constructor(rawCookie: string, fetchImpl: FetchLike = fetch) {
    super(new Map(), fetchImpl, false);
    this.ehallCookies = parseEhallCookieHeader(rawCookie);
    for (const [name, value] of this.ehallCookies) {
      if (CAS_COOKIE_NAMES.has(name)) this.casCookies.set(name, value);
    }
  }

  private cookiesFor(url: URL) {
    if (url.origin === EHALL_ORIGIN) return this.ehallCookies;
    if (url.origin === CAS_ORIGIN) return this.casCookies;
    return this.cookies;
  }

  private async establishFromEhall() {
    let url = new URL(EHALL_APP_URL);
    const seen = new Set<string>();
    for (let hop = 0; hop < 8; hop += 1) {
      if (seen.has(url.toString())) {
        throw new EhallCookieExpiredError("ehall_cookie_expired");
      }
      seen.add(url.toString());
      const response = await this.fetchImpl(url.toString(), {
        redirect: "manual",
        headers: {
          accept: "text/html,*/*;q=0.8",
          cookie: cookieHeader(this.cookiesFor(url)),
          "user-agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(15_000),
      });
      captureCookies(this.cookiesFor(url), response);
      const location = response.headers.get("location") || "";
      if (!REDIRECT_STATUSES.has(response.status) || !location) {
        throw new EhallCookieExpiredError("ehall_cookie_expired");
      }
      url = fixedBrowserRedirect(location, url.toString());
      if (
        url.origin === JWXT_CALLBACK_ORIGIN &&
        url.pathname === JWXT_CALLBACK_PATH &&
        url.searchParams.has("ticket")
      ) {
        return url.toString();
      }
    }
    throw new EhallCookieExpiredError("ehall_cookie_expired");
  }

  protected async establishSession() {
    const callback = await this.establishFromEhall();
    await this.followTicket(callback);
  }
}
