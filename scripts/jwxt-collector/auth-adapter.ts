import { responseSetCookieLines } from "../../src/lib/set-cookie";
import { startCasPasswordLogin, type CasSsoGrant } from "../../src/lib/jxufe-cas";
import {
  completePreparedEhallLogin,
  launchJwxtFromEhall,
  prepareEhallLogin,
} from "../../src/lib/jxufe-ehall";

const JWXT_ORIGIN = "https://jwxt.jxufe.edu.cn";
const USER_AGENT = "jufexk-jwxt-collector/1.0 (+https://github.com/K4F7/jufexk)";

export class UnsupportedJwxtAuthenticationError extends Error {}
export class JwxtAuthenticationError extends Error {}

type FetchLike = typeof fetch;

function cookieHeader(cookies: Map<string, string>) {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
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

export class JwxtAuthAdapter {
  private cookies = new Map<string, string>();
  private loginPromise: Promise<void> | null = null;

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async followTicket(location: string) {
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

  private async loginOnce() {
    const preparation = await prepareEhallLogin();
    if (!preparation) throw new JwxtAuthenticationError("ehall_protocol_changed");
    const result = await startCasPasswordLogin(
      this.username,
      this.password,
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
      this.loginPromise = this.loginOnce().finally(() => {
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
    if (expired && allowRelogin) {
      this.cookies.clear();
      await this.login();
      return this.request(path, init, false);
    }
    return response;
  }
}

