import { SELF, env } from "cloudflare:test";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import {
  AUTH_PROVIDER_CAS,
  CAS_IDENTITY_ISSUER,
} from "../src/ordinary-user-identity";
import {
  EMAIL_LOGIN_COOKIE,
  hmacHex,
} from "../src/ordinary-user-authentication";
import { EHALL_SESSION_COOKIE } from "../src/ordinary-user-session";
import { ORDINARY_USER_CSRF_COOKIE } from "../src/ordinary-user-write-authorization";
import {
  CAS_MFA_CONSUMED_LOGIN_FAILED,
  CAS_SERVICE_URL,
  applySetCookie,
  extractCasServiceTicket,
  isAllowedCasUrl,
  isSuccessfulCasRedirect,
  normalizeCasUsername,
  parseCasJsonError,
  parseCasServiceValidateUser,
  parseErrorTip,
  parseLoginPage,
  parseQrCometAccounts,
} from "../src/lib/jxufe-cas";

const origin = "https://example.com";
const studentId = "2202100099";
const password = "campus-pass-99";
const jwxtTestService =
  "https://jwxt.jxufe.edu.cn//jxcjcaslogin";
const jwxtTestTicketLocation = `${jwxtTestService}?ticket=ST-jwxt-test-1`;
const jwxtTestEntry =
  "https://jwxt.jxufe.edu.cn/jxcjcaslogin?t_s=1&amp_sec_version_=1&gid_=test&EMAP_LANG=zh&THEME=indigo";
const ehallHome = "http://ehall.jxufe.edu.cn/new/index.html";
const ehallLogin = `http://ehall.jxufe.edu.cn/login?service=${encodeURIComponent(ehallHome)}`;
const ehallAdapterToken = "adapter-session-token";
const ehallAdapterService =
  `http://ehall.jxufe.edu.cn/amp-auth-adapter/loginSuccess?sessionToken=${ehallAdapterToken}`;
const loginHtml = (execution = "e1s1", encrypt = false) =>
  `<html><body><form><input name="execution" value="${execution}"></form><script>var cfg={"encryptEnabled":"${encrypt ? "true" : "false"}"}</script></body></html>`;

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

type CasCall = { url: string; method: string; body: string };

const originalFetch = globalThis.fetch;
let calls: CasCall[] = [];
let mode:
  | "success"
  | "wrong-password"
  | "wrong-password-200"
  | "mfa"
  | "mfa-bad-code"
  | "mfa-ticket-after-valid"
  | "mfa-reauth-get-after-valid"
  | "mfa-reauth-post-after-valid"
  | "mfa-reauth-without-tgc"
  | "mfa-session-cookie"
  | "mfa-login-fails-after-valid"
  | "mfa-stale-execution-then-ok"
  | "reauth-without-mfa"
  | "blocked-attest"
  | "account-locked"
  | "mfa-send-msg"
  | "encrypt"
  | "qr-captcha" = "success";
let mfaCodeAccepted = "6543";
let loginGets = 0;
let loginPosts = 0;
let appShowCalls = 0;
let ehallLaunchMode:
  | "active"
  | "expired-once"
  | "cas-expired"
  | "hostile-redirect"
  | "hostile-jwxt-query"
  | "hostile-cas-service"
  | "network-error" = "active";
let appShowGate: Promise<void> | null = null;
let qrComet:
  | "pending"
  | "scanned"
  | "authorized"
  | "authorized-ticket"
  | "cancelled"
  | "expired"
  | "error"
  | "no-username" = "pending";

const QR_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

function installCasMock() {
    calls = [];
    loginGets = 0;
    loginPosts = 0;
    globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = init?.body ? String(init.body) : "";
    calls.push({ url: request.url, method: request.method, body });

    if (url.hostname === "evil.example") {
      return new Response("blocked", { status: 500 });
    }

    if (
      url.hostname === "ehall.jxufe.edu.cn" &&
      url.pathname === "/login" &&
      url.searchParams.get("service") === ehallHome &&
      url.searchParams.get("ticket") === "ST-ehall-final-1" &&
      request.headers.get("cookie")?.includes("CASTGC=ehall-castgc-secret")
    ) {
      const headers = new Headers({ location: ehallHome });
      headers.append("set-cookie", "asessionid=ehall-session-secret; Path=/; HttpOnly");
      headers.append("set-cookie", "CASSTOC=ehall-cas-secret; Path=/; HttpOnly");
      return new Response(null, { status: 302, headers });
    }

    if (
      url.hostname === "ehall.jxufe.edu.cn" &&
      url.pathname === "/login" &&
      url.searchParams.get("service") === ehallHome &&
      !url.searchParams.has("ticket")
    ) {
      return new Response(null, {
        status: 302,
        headers: {
          location:
            `/amp-auth-adapter/login?service=${encodeURIComponent(ehallLogin)}`,
          "set-cookie":
            "MOD_AMP_AUTH=adapter-state-secret; Path=/amp-auth-adapter/; HttpOnly",
        },
      });
    }

    if (
      url.hostname === "ehall.jxufe.edu.cn" &&
      url.pathname === "/amp-auth-adapter/login" &&
      url.searchParams.get("service") === ehallLogin &&
      request.headers.get("cookie")?.includes("MOD_AMP_AUTH=adapter-state-secret")
    ) {
      return new Response(null, {
        status: 302,
        headers: {
          location:
            `https://ssl.jxufe.edu.cn/cas/login?service=${encodeURIComponent(ehallAdapterService)}`,
        },
      });
    }

    if (
      url.hostname === "ehall.jxufe.edu.cn" &&
      url.pathname === "/amp-auth-adapter/loginSuccess" &&
      url.searchParams.get("sessionToken") === ehallAdapterToken &&
      url.searchParams.get("ticket") === "ST-ehall-adapter-1" &&
      request.headers.get("cookie")?.includes("MOD_AMP_AUTH=adapter-state-secret")
    ) {
      const headers = new Headers({
        location:
          `${ehallLogin}&ticket=ST-ehall-final-1`,
      });
      headers.append("set-cookie", "CASTGC=ehall-castgc-secret; Path=/; HttpOnly");
      return new Response(null, { status: 302, headers });
    }

    if (url.hostname === "ssl.jxufe.edu.cn" && url.pathname === "/cas/login") {
      const requestedService =
        url.searchParams.get("service") || "http://ehall.jxufe.edu.cn";
      const ticketLocation = (ticket: string) =>
        `${requestedService}${requestedService.includes("?") ? "&" : "?"}ticket=${ticket}`;
      if (
        request.method === "GET" &&
        url.searchParams.get("service") === jwxtTestService
      ) {
        return new Response(null, {
          status: 302,
          headers: {
            location: jwxtTestTicketLocation,
          },
        });
      }
      if (
        request.method === "GET" &&
        (request.headers.get("cookie")?.includes("TGC=tgc-test-secret") ||
          request.headers.get("cookie")?.includes("SESSION=cas-session-secret")) &&
        url.searchParams.get("service") === ehallAdapterService
      ) {
        if (ehallLaunchMode === "cas-expired") {
          return new Response(loginHtml("e-adapter-renew"), {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        return new Response(null, {
          status: 302,
          headers: {
            location: `${ehallAdapterService}&ticket=ST-ehall-adapter-1`,
          },
        });
      }
      if (
        request.method === "GET" &&
        (request.headers.get("cookie")?.includes("TGC=tgc-test-secret") ||
          request.headers.get("cookie")?.includes("SESSION=cas-session-secret")) &&
        url.searchParams.get("service") === "http://ehall.jxufe.edu.cn"
      ) {
        if (ehallLaunchMode === "cas-expired") {
          return new Response(loginHtml("e-renew"), {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        return new Response(null, {
          status: 302,
          headers: {
            location: "http://ehall.jxufe.edu.cn/?ticket=ST-ehall-renew-1",
          },
        });
      }
      if (request.method === "GET") {
        loginGets += 1;
        if (
          mode === "mfa-reauth-without-tgc" &&
          url.searchParams.get("reAuthCheck") === "1"
        ) {
          return new Response(null, {
            status: 302,
            headers: {
              location: ticketLocation("ST-ehall-adapter-1"),
              "set-cookie":
                "JSESSIONID=after-mfa; Path=/cas; HttpOnly, TGC=tgc-test-secret; Path=/cas/; HttpOnly; Secure; SameSite=Lax",
            },
          });
        }
        if (mode === "mfa-ticket-after-valid" && loginGets >= 2) {
          return new Response(null, {
            status: 302,
            headers: { location: ticketLocation("ST-ehall-adapter-1") },
          });
        }
        if (mode === "mfa-reauth-get-after-valid" && loginGets >= 2) {
          return new Response(null, {
            status: 302,
            headers: {
              location:
                `https://ssl.jxufe.edu.cn/cas/login?service=${encodeURIComponent(requestedService)}&reAuthCheck=1`,
              "set-cookie":
                "TGC=tgc-test-secret; Path=/cas/; HttpOnly; Secure; SameSite=Lax",
            },
          });
        }
        if (mode === "qr-captcha") {
          return new Response(
            `<html><img id="captchaImg" src="/cas/captcha"><form><input name="execution" value="e1s1"></form></html>`,
            {
              status: 200,
              headers: {
                "content-type": "text/html",
                "set-cookie": "JSESSIONID=abc; Path=/cas",
              },
            },
          );
        }
        const mfaLike =
          mode === "mfa" ||
          mode === "mfa-bad-code" ||
          mode === "mfa-ticket-after-valid" ||
          mode === "mfa-reauth-get-after-valid" ||
          mode === "mfa-reauth-post-after-valid" ||
          mode === "mfa-reauth-without-tgc" ||
          mode === "mfa-session-cookie" ||
          mode === "mfa-login-fails-after-valid" ||
          mode === "mfa-stale-execution-then-ok" ||
          mode === "mfa-send-msg";
        return new Response(loginHtml(mfaLike ? "e1s2" : "e1s1", mode === "encrypt"), {
          status: 200,
          headers: {
            "content-type": "text/html",
            "set-cookie": "JSESSIONID=abc; Path=/cas",
          },
        });
      }
      loginPosts += 1;
      if (mode === "mfa-stale-execution-then-ok" && loginPosts === 1) {
        return new Response("", { status: 400 });
      }
      if (body.includes("wrong-pass") || mode === "wrong-password") {
        return new Response(
          `<html><div id="showErrorTip">用户名或密码错误</div></html>`,
          { status: 401, headers: { "content-type": "text/html" } },
        );
      }
      if (mode === "account-locked") {
        return new Response(
          `<html><div id="showErrorTip">账号已被锁定，请稍后再试</div></html>`,
          { status: 401, headers: { "content-type": "text/html" } },
        );
      }
      if (mode === "wrong-password-200" || mode === "mfa-login-fails-after-valid") {
        return new Response(
          `<html><title>登录 - 江西财经大学统一身份认证</title><form><input name="execution" value="e1s9"></form></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      if (
        mode === "mfa-session-cookie"
      ) {
        return new Response(null, {
          status: 302,
          headers: {
            location: ticketLocation("ST-ehall-adapter-1"),
            "set-cookie":
              "TGC=; Path=/cas/; Max-Age=0; HttpOnly; Secure, SESSION=cas-session-secret; Path=/cas/; HttpOnly; Secure; SameSite=Lax",
          },
        });
      }
      if (
        mode === "reauth-without-mfa" ||
        mode === "mfa-reauth-post-after-valid" ||
        mode === "mfa-reauth-without-tgc"
      ) {
        const setCookie =
          mode === "mfa-reauth-without-tgc"
            ? "JSESSIONID=before-tgc; Path=/cas; HttpOnly"
            : "TGC=tgc-test-secret; Path=/cas/; HttpOnly; Secure; SameSite=Lax";
        return new Response(null, {
          status: 302,
          headers: {
            location:
              `https://ssl.jxufe.edu.cn/cas/login?service=${encodeURIComponent(requestedService)}&reAuthCheck=1`,
            "set-cookie": setCookie,
          },
        });
      }
      return new Response(null, {
        status: 302,
        headers: {
          location: ticketLocation("ST-ehall-adapter-1"),
          "set-cookie":
            "TGC=tgc-test-secret; Path=/cas/; HttpOnly; Secure; SameSite=Lax",
        },
      });
    }

    if (
      url.hostname === "ehall.jxufe.edu.cn" &&
      url.pathname === "/appShow" &&
      url.searchParams.get("appId") === "5853686007071845"
    ) {
      appShowCalls += 1;
      if (appShowGate) await appShowGate;
      if (ehallLaunchMode === "network-error") {
        throw new TypeError("sanitized upstream network failure");
      }
      if (ehallLaunchMode === "hostile-redirect") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/steal" },
        });
      }
      if (ehallLaunchMode === "hostile-jwxt-query") {
        return new Response(null, {
          status: 302,
          headers: { location: `${jwxtTestEntry}&unexpected=1` },
        });
      }
      if (ehallLaunchMode === "hostile-cas-service") {
        const service = `${jwxtTestService}?unexpected=1`;
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://ssl.jxufe.edu.cn/cas/login?service=${encodeURIComponent(service)}`,
          },
        });
      }
      if (ehallLaunchMode !== "active" && appShowCalls === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "/login;jsessionid=expired?service=http://ehall.jxufe.edu.cn/appShow?appId=5853686007071845",
          },
        });
      }
      return new Response(null, {
        status: 302,
        headers: { location: jwxtTestEntry },
      });
    }

    if (
      url.hostname === "jwxt.jxufe.edu.cn" &&
      url.pathname === "/jxcjcaslogin" &&
      !url.searchParams.has("ticket")
    ) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `https://ssl.jxufe.edu.cn/cas/login?service=${encodeURIComponent(jwxtTestService)}`,
        },
      });
    }

    if (url.hostname === "ssl.jxufe.edu.cn" && url.pathname === "/cas/jwt/publicKey") {
      return new Response(publicKeyPem, { status: 200 });
    }

    if (url.hostname === "ssl.jxufe.edu.cn" && url.pathname === "/cas/mfa/detect") {
      const need =
        mode === "mfa" ||
        mode === "mfa-bad-code" ||
        mode === "mfa-ticket-after-valid" ||
        mode === "mfa-reauth-get-after-valid" ||
        mode === "mfa-reauth-post-after-valid" ||
        mode === "mfa-reauth-without-tgc" ||
        mode === "mfa-session-cookie" ||
        mode === "mfa-login-fails-after-valid" ||
        mode === "mfa-stale-execution-then-ok" ||
        mode === "mfa-send-msg" ||
        mode === "blocked-attest";
      return Response.json({
        code: 0,
        data: { need, state: need ? "mfa-state-1" : "" },
      });
    }

    if (
      url.hostname === "ssl.jxufe.edu.cn" &&
      url.pathname === "/cas/mfa/initByType/securephone"
    ) {
      return Response.json({
        code: 0,
        data: {
          attestServerUrl:
            mode === "blocked-attest"
              ? "https://evil.example"
              : "https://mfa.jxufe.edu.cn",
          gid: "gid-1",
          securePhone: "157****3669",
        },
      });
    }

    if (url.hostname === "mfa.jxufe.edu.cn" && url.pathname.endsWith("/send")) {
      if (mode === "mfa-send-msg") {
        return Response.json({ code: 1, msg: "发送过于频繁，请稍后再试" });
      }
      return Response.json({ code: 0 });
    }

    if (url.hostname === "ssl.jxufe.edu.cn" && url.pathname === "/cas/qr/qrcode") {
      return new Response(QR_PNG, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "set-cookie": "JSESSIONID=abc; Path=/cas",
        },
      });
    }

    if (url.hostname === "ssl.jxufe.edu.cn" && url.pathname === "/cas/qr/comet") {
      if (qrComet === "expired") return Response.json({ code: 1 });
      if (qrComet === "error") {
        return Response.json({ code: 2, msg: "扫码服务异常" });
      }
      const status =
        qrComet === "scanned"
          ? "2"
          : qrComet === "cancelled"
            ? "4"
            : qrComet === "authorized" ||
                qrComet === "authorized-ticket" ||
                qrComet === "no-username"
              ? "3"
              : "1";
      const data: Record<string, unknown> = { qrCode: { status } };
      if (status === "3") {
        data.stateKey = "qr-state-key-secret";
        if (qrComet === "authorized") data.accounts = studentId;
      }
      return Response.json({ code: 0, data });
    }

    if (
      url.hostname === "ssl.jxufe.edu.cn" &&
      url.pathname === "/cas/p3/serviceValidate"
    ) {
      if (qrComet === "authorized-ticket") {
        return new Response(
          `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>${studentId}</cas:user></cas:authenticationSuccess></cas:serviceResponse>`,
          { status: 200, headers: { "content-type": "text/xml" } },
        );
      }
      return new Response(
        `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="INVALID_TICKET">bad</cas:authenticationFailure></cas:serviceResponse>`,
        { status: 200, headers: { "content-type": "text/xml" } },
      );
    }

    if (url.hostname === "mfa.jxufe.edu.cn" && url.pathname.endsWith("/valid")) {
      const parsed = JSON.parse(body || "{}") as { code?: string };
      if (mode === "mfa-bad-code" || parsed.code !== mfaCodeAccepted) {
        return Response.json({
          code: 0,
          msg: "动态口令错误",
          data: { status: 0 },
        });
      }
      return Response.json({ code: 0, data: { status: 2 } });
    }

    return originalFetch(input, init);
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls = [];
  mode = "success";
  mfaCodeAccepted = "6543";
  loginGets = 0;
  loginPosts = 0;
  appShowCalls = 0;
  ehallLaunchMode = "active";
  appShowGate = null;
  qrComet = "pending";
});

function assertNoIdentityLeak(value: unknown) {
  const raw = JSON.stringify(value);
  expect(raw).not.toMatch(new RegExp(studentId));
  expect(raw).not.toMatch(
    /campus-pass-99|CASTGC|JSESSIONID=abc|gid-1|tgc-test-secret|cas-session-secret|ehall-session-secret|ehall-cas-secret/,
  );
  expect(raw).not.toMatch(/qr-state-key-secret|qrCodeKey|stateKey/);
  expect(raw).not.toMatch(/"id":"[0-9a-f]{32}"/);
}

function cookieHeader(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?(): string[] };
  return (headers.getSetCookie?.() || [])
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function setCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?(): string[] };
  return headers.getSetCookie?.() || [];
}

let ipSeq = 20;
function nextIp() {
  ipSeq += 1;
  return `203.0.113.${ipSeq}`;
}

const testExecutionCtx = {
  waitUntil(promise: Promise<unknown>) {
    void promise.catch(() => {});
  },
  passThroughOnException() {},
  props: {},
};

/** Origin-check posts stay in-process so custom-domain SELF.fetch cannot hang. */
async function postCasForOrigin(url: string, headers: Record<string, string>) {
  return app.fetch(
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": nextIp(),
        ...headers,
      },
      body: JSON.stringify({ username: "ab", password: "x" }),
    }),
    env,
    testExecutionCtx,
  );
}

async function startCas(body: Record<string, unknown>, ip = nextIp()) {
  return SELF.fetch(`${origin}/api/auth/cas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
}

async function finishMfa(body: Record<string, unknown>, ip = nextIp()) {
  return SELF.fetch(`${origin}/api/auth/cas/mfa`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({ password, ...body }),
  });
}

async function startQr(ip = nextIp()) {
  return SELF.fetch(`${origin}/api/auth/cas/qr`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body: "{}",
  });
}

async function pollQr(body: Record<string, unknown>, ip = nextIp()) {
  return SELF.fetch(`${origin}/api/auth/cas/qr/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
}

function delayExpiredChallengePurge(db: D1Database) {
  let release = () => {};
  let finished = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayed = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          const statement = target.prepare(query);
          if (!query.startsWith("DELETE FROM cas_login_challenges WHERE expires_at")) {
            return statement;
          }
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              if (statementProperty === "run") {
                return async () => {
                  await gate;
                  const result = await statementTarget.run();
                  finished = true;
                  return result;
                };
              }
              const value = Reflect.get(statementTarget, statementProperty, statementTarget);
              return typeof value === "function" ? value.bind(statementTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: delayed, release, finished: () => finished };
}

describe("jxufe cas helpers", () => {
  it("captures TGC when upstream combines multiple Set-Cookie values", () => {
    const jar: Record<string, string> = {};
    applySetCookie(
      jar,
      new Response(null, {
        headers: {
          "set-cookie":
            "JSESSIONID=session-value; Path=/cas; HttpOnly, TGC=tgc-value; Path=/cas/; HttpOnly; Secure; SameSite=Lax",
        },
      }),
    );
    expect(jar).toMatchObject({
      JSESSIONID: "session-value",
      TGC: "tgc-value",
    });
  });

  it("accepts campus hosts and ehall ticket redirects", () => {
    expect(isAllowedCasUrl("https://ssl.jxufe.edu.cn/cas/login")).toBe(true);
    expect(isAllowedCasUrl("https://mfa.jxufe.edu.cn/api")).toBe(true);
    expect(isAllowedCasUrl("https://evil.example/cas")).toBe(false);
    expect(isSuccessfulCasRedirect("http://ehall.jxufe.edu.cn/?ticket=ST-1")).toBe(
      true,
    );
    expect(isSuccessfulCasRedirect("/cas/login?reAuthCheck=1")).toBe(false);
    expect(
      isSuccessfulCasRedirect(
        `/cas/login?service=${encodeURIComponent(CAS_SERVICE_URL)}&reAuthCheck=1`, {
          acceptReauthCheck: true,
        },
      ),
    ).toBe(true);
    expect(
      isSuccessfulCasRedirect("https://evil.example/?reAuthCheck=1", {
        acceptReauthCheck: true,
      }),
    ).toBe(false);
    expect(normalizeCasUsername(" 2202100099 ")).toBe("2202100099");
    expect(normalizeCasUsername("not an id")).toBeNull();
    expect(parseLoginPage(loginHtml()).execution).toBe("e1s1");
    expect(
      parseErrorTip(`<html><div id="showErrorTip">账号已被锁定</div></html>`),
    ).toBe("账号已被锁定");
    expect(
      parseErrorTip(
        `<html><div id="msg" class="errors">密码已过期，请修改密码</div></html>`,
      ),
    ).toBe("密码已过期，请修改密码");
    expect(parseErrorTip("<html><form></form></html>")).toBe("学号或密码不正确");
    expect(parseCasJsonError({ code: 1, msg: "动态口令错误" })).toBe(
      "动态口令错误",
    );
    expect(
      parseCasJsonError({
        code: 1,
        msg: "http://ssl.jxufe.edu.cn/cas/login?execution=e1",
      }),
    ).toBeNull();
    expect(parseQrCometAccounts(studentId)).toBe(studentId);
    expect(parseQrCometAccounts([studentId])).toBe(studentId);
    expect(parseQrCometAccounts({ username: studentId })).toBe(studentId);
    expect(parseQrCometAccounts({ account: studentId })).toBe(studentId);
    expect(parseQrCometAccounts({ userId: studentId })).toBe(studentId);
    expect(parseQrCometAccounts("not an id")).toBeNull();
    expect(
      parseCasServiceValidateUser(
        `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>${studentId}</cas:user></cas:authenticationSuccess></cas:serviceResponse>`,
      ),
    ).toBe(studentId);
    expect(extractCasServiceTicket("http://ehall.jxufe.edu.cn/?ticket=ST-test-1")).toBe(
      "ST-test-1",
    );
    expect(extractCasServiceTicket("/cas/login?reAuthCheck=1")).toBeNull();
  });
});

describe("jxufe cas login", { timeout: 15_000 }, () => {
  it("lets the Vite preview origin pass when wrangler rewrites Host and URL over HTTP", async () => {
    const response = await postCasForOrigin(
      "http://courses.sein.moe/api/auth/cas",
      { Origin: "http://127.0.0.1:5173" },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "学号或密码不正确" });
  });

  it("lets the Vite preview origin pass when wrangler rewrites the public hostname", async () => {
    const response = await postCasForOrigin(
      "https://courses.sein.moe/api/auth/cas",
      { Origin: "http://127.0.0.1:5173", Host: "127.0.0.1:8787" },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "学号或密码不正确" });
  });

  it("lets the Vite preview origin pass origin check on a loopback worker", async () => {
    const response = await postCasForOrigin("http://127.0.0.1:8787/api/auth/cas", {
      Origin: "http://127.0.0.1:5173",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "学号或密码不正确" });
  });

  it("lets localhost preview talk to a 127.0.0.1 worker without origin failure", async () => {
    const response = await postCasForOrigin("http://localhost:8787/api/auth/cas", {
      Origin: "http://127.0.0.1:5173",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "学号或密码不正确" });
  });

  it("still rejects a public attacker origin against a loopback worker", async () => {
    const response = await SELF.fetch("http://127.0.0.1:8787/api/auth/cas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "CF-Connecting-IP": nextIp(),
      },
      body: JSON.stringify({ username: "not-an-id", password: "x" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "来源校验失败" });
  });

  it("still rejects a preview origin against a public site origin", async () => {
    const mismatched = await SELF.fetch(`${origin}/api/auth/cas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:5173",
        "CF-Connecting-IP": nextIp(),
      },
      body: JSON.stringify({ username: studentId, password }),
    });
    expect(mismatched.status).toBe(403);
    expect(await mismatched.json()).toMatchObject({ error: "来源校验失败" });
  });

  it("returns a successful login without waiting for expired challenge cleanup", async () => {
    installCasMock();
    const delayed = delayExpiredChallengePurge(env.DB);
    const backgroundTasks: Promise<unknown>[] = [];
    const executionContext = {
      waitUntil(promise: Promise<unknown>) {
        backgroundTasks.push(promise);
      },
      passThroughOnException() {},
    } as ExecutionContext;
    const bindings = new Proxy(env, {
      get(target, property) {
        return property === "DB" ? delayed.db : Reflect.get(target, property, target);
      },
    });
    const responsePromise = app.fetch(
      new Request(`${origin}/api/auth/cas`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "CF-Connecting-IP": nextIp(),
        },
        body: JSON.stringify({ username: studentId, password }),
      }),
      bindings,
      executionContext,
    );

    try {
      await vi.waitFor(() => expect(backgroundTasks).toHaveLength(1));
      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(delayed.finished()).toBe(false);
    } finally {
      delayed.release();
      await responsePromise;
      await Promise.allSettled(backgroundTasks);
    }
    expect(delayed.finished()).toBe(true);
  });

  it("treats a 200 login page after POST as a wrong password", async () => {
    mode = "wrong-password-200";
    installCasMock();
    const response = await startCas({ username: studentId, password });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "学号或密码不正确" });
    expect(cookieHeader(response)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
  });

  it("forwards a school lock tip from showErrorTip", async () => {
    mode = "account-locked";
    installCasMock();
    const response = await startCas({ username: studentId, password });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "账号已被锁定，请稍后再试",
    });
    expect(cookieHeader(response)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
  });

  it("forwards a school MFA send tip", async () => {
    mode = "mfa-send-msg";
    installCasMock();
    const response = await startCas({ username: studentId, password });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "发送过于频繁，请稍后再试",
    });
  });

  it("rejects a wrong password without creating a session or identity", async () => {
    mode = "wrong-password";
    installCasMock();
    const before = await env.DB.prepare(
      "SELECT COUNT(*) n FROM auth_identities WHERE provider=?",
    )
      .bind(AUTH_PROVIDER_CAS)
      .first<{ n: number }>();
    const response = await startCas({ username: studentId, password: "wrong-pass" });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: "用户名或密码错误" });
    assertNoIdentityLeak(body);
    expect(cookieHeader(response)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
    const after = await env.DB.prepare(
      "SELECT COUNT(*) n FROM auth_identities WHERE provider=?",
    )
      .bind(AUTH_PROVIDER_CAS)
      .first<{ n: number }>();
    expect(after?.n).toBe(before?.n || 0);
  });

  it("logs in without MFA and reuses the same user", async () => {
    installCasMock();
    const first = await startCas({ username: studentId, password });
    expect(first.status).toBe(200);
    const session = await first.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(session.authenticated).toBe(true);
    expect(session.csrfToken).toBeTruthy();
    assertNoIdentityLeak(session);
    expect(cookieHeader(first)).toContain(`${EMAIL_LOGIN_COOKIE}=`);
    expect(cookieHeader(first)).toContain(`${ORDINARY_USER_CSRF_COOKIE}=`);
    expect(
      setCookies(first).find((value) => value.startsWith(`${EMAIL_LOGIN_COOKIE}=`)),
    ).toContain("Max-Age=604800");
    expect(
      setCookies(first).find((value) => value.startsWith(`${ORDINARY_USER_CSRF_COOKIE}=`)),
    ).toContain("Max-Age=604800");
    expect(calls.some((call) => /ehall\.jxufe\.edu\.cn\/.+/.test(call.url))).toBe(
      true,
    );

    const browserCookies = cookieHeader(first);
    expect(browserCookies).toContain("jufexk_ehall_session=");
    expect(browserCookies).not.toContain("tgc-test-secret");
    expect(browserCookies).not.toContain("ehall-session-secret");
    const callsBeforeStatus = calls.length;
    const ehallStatus = await SELF.fetch(`${origin}/api/ehall/session`, {
      headers: { Cookie: browserCookies },
    });
    expect(ehallStatus.status).toBe(200);
    expect(await ehallStatus.json()).toMatchObject({ available: true });
    expect(calls).toHaveLength(callsBeforeStatus);

    const launch = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: session.csrfToken || "" }),
    });
    expect(launch.status).toBe(302);
    expect(launch.headers.get("location")).toBe(
      jwxtTestTicketLocation,
    );
    expect(await launch.text()).toBe("");

    const identity = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE provider=? AND issuer=?",
    )
      .bind(AUTH_PROVIDER_CAS, CAS_IDENTITY_ISSUER)
      .first<{ user_id: string }>();
    expect(identity?.user_id).toMatch(/^[0-9a-f]{32}$/);

    const leftover = await env.DB.prepare(
      "SELECT COUNT(*) n FROM cas_login_challenges",
    ).first<{ n: number }>();
    expect(leftover?.n).toBe(0);
    const dump = await env.DB.prepare(
      "SELECT * FROM cas_login_challenges",
    ).all();
    expect(JSON.stringify(dump)).not.toContain(password);
    expect(JSON.stringify(dump)).not.toContain("CASTGC");

    const second = await startCas({ username: studentId, password });
    expect(second.status).toBe(200);
    const identities = await env.DB.prepare(
      "SELECT COUNT(*) n FROM auth_identities WHERE provider=? AND issuer=?",
    )
      .bind(AUTH_PROVIDER_CAS, CAS_IDENTITY_ISSUER)
      .first<{ n: number }>();
    expect(identities?.n).toBe(1);
  });

  it("establishes eHall through the fixed amp auth adapter handshake", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });

    expect(loggedIn.status).toBe(200);
    expect(
      calls.some((call) => {
        const url = new URL(call.url);
        return url.hostname === "ehall.jxufe.edu.cn" && url.pathname === "/login";
      }),
    ).toBe(true);
    expect(
      calls.some((call) => {
        const url = new URL(call.url);
        return (
          url.hostname === "ehall.jxufe.edu.cn" &&
          url.pathname === "/amp-auth-adapter/login"
        );
      }),
    ).toBe(true);
    expect(
      calls.some((call) => {
        const url = new URL(call.url);
        return (
          url.hostname === "ehall.jxufe.edu.cn" &&
          url.pathname === "/amp-auth-adapter/loginSuccess" &&
          url.searchParams.has("sessionToken") &&
          url.searchParams.has("ticket")
        );
      }),
    ).toBe(true);
    expect(
      calls.some((call) => {
        const url = new URL(call.url);
        return (
          url.hostname === "ehall.jxufe.edu.cn" &&
          url.pathname === "/login" &&
          url.searchParams.get("service") === ehallHome &&
          url.searchParams.has("ticket")
        );
      }),
    ).toBe(true);
  });

  it("silently renews an expired eHall session with the held TGC", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const session = await loggedIn.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    const browserCookies = cookieHeader(loggedIn);
    const callsAfterLogin = calls.length;
    ehallLaunchMode = "expired-once";
    appShowCalls = 0;

    const launch = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: session.csrfToken || "" }),
    });

    expect(launch.status).toBe(302);
    expect(launch.headers.get("location")).toBe(
      jwxtTestTicketLocation,
    );
    expect(appShowCalls).toBe(2);
    expect(
      calls.slice(callsAfterLogin).some((call) => {
        const url = new URL(call.url);
        if (url.hostname !== "ssl.jxufe.edu.cn" || url.pathname !== "/cas/login") {
          return false;
        }
        const service = new URL(url.searchParams.get("service") || "");
        return service.pathname === "/amp-auth-adapter/loginSuccess";
      }),
    ).toBe(true);
    expect(cookieHeader(launch)).toContain("jufexk_ehall_session=");
    expect(cookieHeader(launch)).not.toContain("ehall-session-renewed");
  });

  it("rejects launch requests without same-origin CSRF before any upstream call", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const session = await loggedIn.clone().json<{ csrfToken?: string }>();
    const browserCookies = cookieHeader(loggedIn);
    const upstreamCalls = calls.length;

    const badOrigin = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: "https://attacker.example",
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: "forged" }),
    });
    expect(badOrigin.status).toBe(403);
    expect(calls).toHaveLength(upstreamCalls);

    const missingCsrf = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    expect(missingCsrf.status).toBe(403);
    expect(calls).toHaveLength(upstreamCalls);

    const wrongContentType = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "text/plain",
      },
      body: `_csrf=${session.csrfToken || ""}`,
    });
    expect(wrongContentType.status).toBe(403);
    expect(calls).toHaveLength(upstreamCalls);

    const oversized = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `_csrf=${session.csrfToken || ""}&padding=${"x".repeat(1_024)}`,
    });
    expect(oversized.status).toBe(403);
    expect(calls).toHaveLength(upstreamCalls);
  });

  it("treats a tampered sealed eHall cookie as unavailable without upstream access", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const browserCookies = cookieHeader(loggedIn);
    const upstreamCalls = calls.length;
    const tamperedCookies = browserCookies.replace(
      /jufexk_ehall_session=([^;]+)/,
      (_match, value: string) =>
        `jufexk_ehall_session=${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`,
    );

    const status = await SELF.fetch(`${origin}/api/ehall/session`, {
      headers: { Cookie: tamperedCookies },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ available: false });
    expect(calls).toHaveLength(upstreamCalls);
  });

  it("never follows a hostile redirect returned by eHall", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const session = await loggedIn.json<{ csrfToken?: string }>();
    const browserCookies = cookieHeader(loggedIn);
    ehallLaunchMode = "hostile-redirect";
    appShowCalls = 0;

    const launch = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: session.csrfToken || "" }),
    });

    expect(launch.status).toBe(303);
    expect(launch.headers.get("location")).toContain("reauth=campus");
    expect(calls.some((call) => call.url.startsWith("https://evil.example"))).toBe(false);
  });

  it("rejects extra query keys on the fixed JWXT entry", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const session = await loggedIn.json<{ csrfToken?: string }>();
    const browserCookies = cookieHeader(loggedIn);
    ehallLaunchMode = "hostile-jwxt-query";
    const upstreamCalls = calls.length;

    const launch = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: session.csrfToken || "" }),
    });

    expect(launch.status).toBe(303);
    expect(calls.slice(upstreamCalls)).toHaveLength(1);
  });

  it("rejects query keys embedded in a direct JWXT CAS service", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const session = await loggedIn.json<{ csrfToken?: string }>();
    const browserCookies = cookieHeader(loggedIn);
    ehallLaunchMode = "hostile-cas-service";
    const upstreamCalls = calls.length;

    const launch = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: session.csrfToken || "" }),
    });

    expect(launch.status).toBe(303);
    expect(calls.slice(upstreamCalls)).toHaveLength(1);
  });

  it("keeps the sealed session on a transient upstream network failure", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const session = await loggedIn.json<{ csrfToken?: string }>();
    const browserCookies = cookieHeader(loggedIn);
    ehallLaunchMode = "network-error";
    appShowCalls = 0;

    const launch = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: session.csrfToken || "" }),
    });

    expect(launch.status).toBe(303);
    expect(launch.headers.get("location")).toBe("/schedule?ehall=unavailable");
    expect(
      setCookies(launch).some((value) => value.startsWith(`${EHALL_SESSION_COOKIE}=`)),
    ).toBe(false);
  });

  it("revokes the sealed eHall session without logging out of the site", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const session = await loggedIn.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    const browserCookies = cookieHeader(loggedIn);

    const revoked = await SELF.fetch(`${origin}/api/ehall/session`, {
      method: "DELETE",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "X-CSRF-Token": session.csrfToken || "",
      },
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ available: false });
    expect(
      setCookies(revoked).find((value) =>
        value.startsWith(`${EHALL_SESSION_COOKIE}=`),
      ),
    ).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);

    const siteSession = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: browserCookies },
    });
    expect(await siteSession.json()).toMatchObject({ authenticated: true });
  });

  it("keeps the site session when campus SSO needs revalidation", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const session = await loggedIn.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    const browserCookies = cookieHeader(loggedIn);
    ehallLaunchMode = "cas-expired";
    appShowCalls = 0;

    const launch = await SELF.fetch(`${origin}/api/ehall/launch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: session.csrfToken || "" }),
    });
    expect(launch.status).toBe(303);
    expect(launch.headers.get("location")).toBe(
      "/login?reauth=campus&from=%2Fschedule%3Fehall%3Dretry",
    );
    expect(
      setCookies(launch).find((value) =>
        value.startsWith(`${EHALL_SESSION_COOKIE}=`),
      ),
    ).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);

    const stillLoggedIn = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: browserCookies },
    });
    expect(await stillLoggedIn.json()).toMatchObject({ authenticated: true });
  });

  it("serializes concurrent launches for the same sealed session", async () => {
    installCasMock();
    const loggedIn = await startCas({ username: studentId, password });
    const session = await loggedIn.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    const browserCookies = cookieHeader(loggedIn);
    appShowCalls = 0;
    let releaseAppShow!: () => void;
    appShowGate = new Promise<void>((resolve) => {
      releaseAppShow = resolve;
    });
    const launch = () =>
      SELF.fetch(`${origin}/api/ehall/launch`, {
        method: "POST",
        redirect: "manual",
        headers: {
          Origin: origin,
          Cookie: browserCookies,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ _csrf: session.csrfToken || "" }),
      });

    const firstPromise = launch();
    await vi.waitFor(() => expect(appShowCalls).toBe(1));
    const secondPromise = launch();
    const second = await Promise.race([
      secondPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
    ]);
    releaseAppShow();
    const first = await firstPromise;
    if (!second) await secondPromise;
    expect(second?.status).toBe(303);
    expect(second?.headers.get("location")).toBe("/schedule?ehall=busy");
    expect(appShowCalls).toBe(1);
    expect(first.status).toBe(302);
    appShowGate = null;
  });

  it("completes MFA then rejects replay and expiry", async () => {
    mode = "mfa";
    installCasMock();
    const started = await startCas({ username: studentId, password });
    expect(started.status).toBe(200);
    const first = await started.json<{
      needsMfa?: boolean;
      challenge?: string;
      maskedPhone?: string;
      authenticated?: boolean;
    }>();
    expect(first.needsMfa).toBe(true);
    expect(first.challenge).toMatch(/^[0-9a-f]{32}$/);
    expect(first.maskedPhone).toBe("157****3669");
    expect(first.authenticated).toBeUndefined();
    assertNoIdentityLeak(first);
    expect(cookieHeader(started)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
    const callsAfterStart = calls.length;

    const stored = await env.DB.prepare(
      "SELECT blob FROM cas_login_challenges WHERE id=?",
    )
      .bind(first.challenge)
      .first<{ blob: string }>();
    expect(stored?.blob).toBeTruthy();
    expect(stored?.blob).not.toContain(password);
    expect(stored?.blob).not.toContain(studentId);
    expect(stored?.blob).not.toContain("CASTGC");

    const withoutPassword = await finishMfa({
      challenge: first.challenge,
      code: mfaCodeAccepted,
      password: "",
    });
    expect(withoutPassword.status).toBe(401);

    const bad = await finishMfa({ challenge: first.challenge, code: "0000" });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: "动态口令错误" });

    const verified = await finishMfa({
      challenge: first.challenge,
      code: mfaCodeAccepted,
    });
    expect(verified.status).toBe(200);
    const verifiedBody = await verified.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(verifiedBody.authenticated).toBe(true);
    assertNoIdentityLeak(verifiedBody);
    const afterValid = calls.slice(callsAfterStart);
    expect(
      afterValid.some((call) => call.url.includes("/api/guard/securephone/valid")),
    ).toBe(true);
    expect(
      afterValid.some((call) => call.url.includes("/cas/mfa/detect")),
    ).toBe(false);
    expect(
      afterValid
        .filter((call) => call.method === "GET" && call.url.includes("/cas/login"))
        .every((call) => {
          const service = new URL(call.url).searchParams.get("service") || "";
          const serviceUrl = new URL(service);
          return (
            serviceUrl.hostname === "ehall.jxufe.edu.cn" &&
            serviceUrl.pathname === "/amp-auth-adapter/loginSuccess"
          );
        }),
    ).toBe(true);
    const cookies = cookieHeader(verified);
    expect(cookies).toContain(`${EMAIL_LOGIN_COOKIE}=`);

    const leftover = await env.DB.prepare(
      "SELECT COUNT(*) n FROM cas_login_challenges",
    ).first<{ n: number }>();
    expect(leftover?.n).toBe(0);

    const replay = await finishMfa({
      challenge: first.challenge,
      code: mfaCodeAccepted,
    });
    expect(replay.status).toBe(401);

    mode = "mfa";
    const again = await startCas({ username: studentId, password });
    const againBody = await again.json<{ challenge?: string }>();
    await env.DB.prepare(
      "UPDATE cas_login_challenges SET expires_at=unixepoch()-10",
    ).run();
    const expired = await finishMfa({
      challenge: againBody.challenge,
      code: mfaCodeAccepted,
    });
    expect(expired.status).toBe(401);

    const session = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: cookies },
    });
    const sessionBody = await session.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(sessionBody.authenticated).toBe(true);
    const logout = await SELF.fetch(`${origin}/api/user/logout`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookies,
        "X-CSRF-Token": sessionBody.csrfToken || "",
      },
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toMatchObject({ authenticated: false });
    expect(
      setCookies(logout).find((value) => value.startsWith(`${EHALL_SESSION_COOKIE}=`)),
    ).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it("treats a reAuthCheck redirect after MFA as login success", async () => {
    for (const next of [
      "mfa-reauth-get-after-valid",
      "mfa-reauth-post-after-valid",
    ] as const) {
      mode = next;
      mfaCodeAccepted = "4321";
      installCasMock();
      const started = await startCas({ username: studentId, password });
      const first = await started.json<{ challenge?: string }>();
      const verified = await finishMfa({
        challenge: first.challenge,
        code: "4321",
      });
      expect(verified.status).toBe(200);
      expect(await verified.json()).toMatchObject({ authenticated: true });
      expect(cookieHeader(verified)).toContain(`${EMAIL_LOGIN_COOKIE}=`);
      expect(calls.some((call) => /ehall\.jxufe\.edu\.cn\/.+/.test(call.url))).toBe(
        true,
      );
    }
    mfaCodeAccepted = "6543";
  });

  it("finishes reAuthCheck to obtain TGC before creating the eHall session", async () => {
    mode = "mfa-reauth-without-tgc";
    installCasMock();
    const started = await startCas({ username: studentId, password });
    const challenge = (await started.json<{ challenge?: string }>()).challenge;

    const verified = await finishMfa({ challenge, code: mfaCodeAccepted });

    expect(verified.status).toBe(200);
    expect(cookieHeader(verified)).toContain(`${EHALL_SESSION_COOKIE}=`);
    expect(
      calls.some(
        (call) => call.method === "GET" && call.url.includes("reAuthCheck=1"),
      ),
    ).toBe(true);
  });

  it("uses the surviving CAS SESSION cookie when TGC is revoked", async () => {
    mode = "mfa-session-cookie";
    installCasMock();
    const started = await startCas({ username: studentId, password });
    const challenge = (await started.json<{ challenge?: string }>()).challenge;

    const verified = await finishMfa({ challenge, code: mfaCodeAccepted });

    expect(verified.status).toBe(200);
    expect(cookieHeader(verified)).toContain(`${EHALL_SESSION_COOKIE}=`);
    expect(cookieHeader(verified)).not.toContain("cas-session-secret");
  });

  it("does not treat a pre-MFA reAuthCheck redirect as a finished login", async () => {
    mode = "reauth-without-mfa";
    installCasMock();
    const response = await startCas({ username: studentId, password });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "登录失败，请稍后重试",
    });
    expect(cookieHeader(response)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
  });

  it("refreshes execution when the first post-OTP submit is stale", async () => {
    mode = "mfa-stale-execution-then-ok";
    installCasMock();
    const started = await startCas({ username: studentId, password });
    const first = await started.json<{ challenge?: string }>();
    const verified = await finishMfa({
      challenge: first.challenge,
      code: mfaCodeAccepted,
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ authenticated: true });
    expect(loginPosts).toBe(2);
    expect(calls.some((call) => call.url.includes("/cas/mfa/detect"))).toBe(
      true,
    );
  });

  it("treats a ticket redirect after MFA as login success", async () => {
    mode = "mfa-ticket-after-valid";
    mfaCodeAccepted = "8765";
    installCasMock();
    const started = await startCas({ username: studentId, password });
    const first = await started.json<{ challenge?: string }>();
    const verified = await finishMfa({
      challenge: first.challenge,
      code: "8765",
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ authenticated: true });
    mfaCodeAccepted = "6543";
  });

  it("does not map a post-OTP login failure to a leftover password error", async () => {
    mode = "mfa-login-fails-after-valid";
    installCasMock();
    const started = await startCas({ username: studentId, password });
    const first = await started.json<{ challenge?: string }>();
    const failed = await finishMfa({
      challenge: first.challenge,
      code: mfaCodeAccepted,
    });
    expect(failed.status).toBe(401);
    expect(await failed.json()).toMatchObject({
      error: CAS_MFA_CONSUMED_LOGIN_FAILED,
    });
  });

  it("fails closed when MFA attest is off campus", async () => {
    mode = "blocked-attest";
    installCasMock();
    const response = await startCas({ username: studentId, password });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "登录失败，请稍后重试",
    });
    expect(
      calls.some((call) => call.url.startsWith("https://evil.example")),
    ).toBe(false);
  });

  it("encrypts the password when CAS enables RSA", async () => {
    mode = "encrypt";
    installCasMock();
    const response = await startCas({ username: studentId, password });
    expect(response.status).toBe(200);
    const detect = calls.find((call) => call.url.includes("/cas/mfa/detect"));
    expect(detect?.body).toContain("__RSA__");
    expect(detect?.body).not.toContain(password);
    const login = calls.find(
      (call) => call.url.includes("/cas/login") && call.method === "POST",
    );
    expect(login?.body).toContain("__RSA__");
    expect(login?.body).not.toContain(password);
    expect(login?.body).toContain("rememberMe=on");
    void privateKey;
  });


  it("rate-limits repeated CAS login attempts from one IP", async () => {
    installCasMock();
    const ip = nextIp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await startCas({ username: studentId, password }, ip);
      expect(response.status).toBe(200);
    }
    const blocked = await startCas({ username: studentId, password }, ip);
    expect(blocked.status).toBe(429);
  });

  it("lets cookie+CSRF endorse a review after CAS login", async () => {
    installCasMock();
    const verified = await startCas({ username: studentId, password });
    const body = await verified.json<{ csrfToken?: string }>();
    const cookies = cookieHeader(verified);
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,comment,status,submitter_hash)
       VALUES(1,1,'general',4,'CAS会话可认可的补充说明','approved',?)`,
    )
      .bind(`cas-endorsement-${Date.now()}`)
      .run();
    const reviewId = Number(inserted.meta.last_row_id);
    const endorsed = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      {
        method: "PUT",
        headers: {
          Origin: origin,
          Cookie: cookies,
          "X-CSRF-Token": body.csrfToken || "",
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
    );
    expect(endorsed.status).toBe(200);
    expect(await endorsed.json()).toMatchObject({
      endorsementCount: 1,
      viewerEndorsed: true,
    });
  });
});

describe("jxufe cas qr login", () => {
  it("starts a QR challenge with a PNG data URL and no secret leak", async () => {
    installCasMock();
    const response = await startQr();
    expect(response.status).toBe(200);
    const body = await response.json<{ challenge?: string; image?: string }>();
    expect(body.challenge).toMatch(/^[0-9a-f]{32}$/);
    expect(body.image?.startsWith("data:image/png;base64,")).toBe(true);
    assertNoIdentityLeak(body);
    expect(cookieHeader(response)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
    expect(calls.some((call) => call.url.includes("/cas/qr/qrcode"))).toBe(true);
    expect(
      calls.some((call) => /federatedRedirect|openweixin/.test(call.url)),
    ).toBe(false);
  });

  it("reports pending, scanned, cancelled, and expired without a session", async () => {
    installCasMock();
    const started = await startQr();
    const first = await started.json<{ challenge?: string }>();

    qrComet = "pending";
    const pending = await pollQr({ challenge: first.challenge });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({ status: "pending" });
    expect(cookieHeader(pending)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);

    qrComet = "scanned";
    const scanned = await pollQr({ challenge: first.challenge });
    expect(await scanned.json()).toEqual({ status: "scanned" });

    qrComet = "cancelled";
    const cancelled = await pollQr({ challenge: first.challenge });
    expect(await cancelled.json()).toEqual({ status: "cancelled" });

    qrComet = "expired";
    const expired = await pollQr({ challenge: first.challenge });
    expect(expired.status).toBe(200);
    const expiredBody = await expired.json();
    expect(expiredBody).toEqual({ status: "expired" });
    assertNoIdentityLeak(expiredBody);
  });

  it("treats a missing or TTL-lapsed challenge as expired", async () => {
    installCasMock();
    const missing = await pollQr({ challenge: "ab".repeat(16) });
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ status: "expired" });

    const started = await startQr();
    const first = await started.json<{ challenge?: string }>();
    await env.DB.prepare(
      "UPDATE cas_login_challenges SET expires_at=unixepoch()-10",
    ).run();
    const expired = await pollQr({ challenge: first.challenge });
    expect(expired.status).toBe(200);
    expect(await expired.json()).toEqual({ status: "expired" });
  });

  it("issues a session from comet accounts and establishes eHall", async () => {
    qrComet = "authorized";
    installCasMock();
    const started = await startQr();
    const first = await started.json<{ challenge?: string }>();
    const authorized = await pollQr({ challenge: first.challenge });
    expect(authorized.status).toBe(200);
    const session = await authorized.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(session.authenticated).toBe(true);
    expect(session.csrfToken).toBeTruthy();
    assertNoIdentityLeak(session);
    expect(cookieHeader(authorized)).toContain(`${EMAIL_LOGIN_COOKIE}=`);
    const login = calls.find(
      (call) => call.method === "POST" && call.url.includes("/cas/login"),
    );
    expect(login?.body).toContain("qrCodeKey=qr-state-key-secret");
    expect(login?.body).toContain("currentMenu=3");
    expect(login?.body).toContain("_eventId_success=Submit");
    expect(login?.body).not.toContain("execution=");
    expect(calls.some((call) => /ehall\.jxufe\.edu\.cn\/.+/.test(call.url))).toBe(
      true,
    );
    expect(cookieHeader(authorized)).toContain(`${EHALL_SESSION_COOKIE}=`);
    expect(
      calls.some((call) => /federatedRedirect|openweixin/.test(call.url)),
    ).toBe(false);
    const leftover = await env.DB.prepare(
      "SELECT COUNT(*) n FROM cas_login_challenges WHERE id=?",
    )
      .bind(first.challenge)
      .first<{ n: number }>();
    expect(leftover?.n).toBe(0);

    const identity = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE provider=? AND issuer=?",
    )
      .bind(AUTH_PROVIDER_CAS, CAS_IDENTITY_ISSUER)
      .first<{ user_id: string }>();
    expect(identity?.user_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("falls back to serviceValidate when comet has no accounts", async () => {
    qrComet = "authorized-ticket";
    installCasMock();
    const started = await startQr();
    const first = await started.json<{ challenge?: string }>();
    const authorized = await pollQr({ challenge: first.challenge });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ authenticated: true });
    expect(
      calls.some((call) => call.url.includes("/cas/p3/serviceValidate")),
    ).toBe(true);
    expect(calls.some((call) => /ehall\.jxufe\.edu\.cn\/.+/.test(call.url))).toBe(
      true,
    );
    expect(
      calls.some(
        (call) =>
          call.method === "GET" &&
          call.url.includes(
            "/cas/login?service=http%3A%2F%2Fehall.jxufe.edu.cn",
          ),
      ),
    ).toBe(true);
  });

  it("fails closed when authorized QR has no normalized student id", async () => {
    qrComet = "no-username";
    installCasMock();
    const before = await env.DB.prepare(
      "SELECT COUNT(*) n FROM auth_identities WHERE provider=?",
    )
      .bind(AUTH_PROVIDER_CAS)
      .first<{ n: number }>();
    const started = await startQr();
    const first = await started.json<{ challenge?: string }>();
    const failed = await pollQr({ challenge: first.challenge });
    expect(failed.status).toBe(401);
    const body = await failed.json();
    expect(body).toMatchObject({ error: "登录失败，请稍后重试" });
    assertNoIdentityLeak(body);
    expect(cookieHeader(failed)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
    const after = await env.DB.prepare(
      "SELECT COUNT(*) n FROM auth_identities WHERE provider=?",
    )
      .bind(AUTH_PROVIDER_CAS)
      .first<{ n: number }>();
    expect(after?.n).toBe(before?.n || 0);
  });

  it("forwards a comet error and keeps captcha fail-closed", async () => {
    qrComet = "error";
    installCasMock();
    const started = await startQr();
    const first = await started.json<{ challenge?: string }>();
    const failed = await pollQr({ challenge: first.challenge });
    expect(failed.status).toBe(400);
    expect(await failed.json()).toMatchObject({ error: "扫码服务异常" });

    mode = "qr-captcha";
    const captcha = await startQr();
    expect(captcha.status).toBe(503);
    expect(await captcha.json()).toMatchObject({
      error: "登录页要求验证码，请稍后重试",
    });
  });

  it("keeps MFA and QR challenge blobs on their own decrypt paths", async () => {
    mode = "mfa";
    installCasMock();
    const mfaStarted = await startCas({ username: studentId, password });
    const mfaBody = await mfaStarted.json<{ challenge?: string }>();
    const qrOnMfa = await pollQr({ challenge: mfaBody.challenge });
    expect(await qrOnMfa.json()).toEqual({ status: "expired" });

    mode = "success";
    qrComet = "pending";
    const qrStarted = await startQr();
    const qrBody = await qrStarted.json<{ challenge?: string }>();
    const stored = await env.DB.prepare(
      "SELECT blob FROM cas_login_challenges WHERE id=?",
    )
      .bind(qrBody.challenge)
      .first<{ blob: string }>();
    expect(stored?.blob).toBeTruthy();
    expect(stored?.blob).not.toContain(studentId);
    expect(stored?.blob).not.toContain("CASTGC");
    expect(stored?.blob).not.toContain("qr-state-key-secret");
    const mfaOnQr = await finishMfa({
      challenge: qrBody.challenge,
      code: "1234",
    });
    expect(mfaOnQr.status).toBe(401);
  });

  it("rate-limits QR starts like CAS login", async () => {
    installCasMock();
    const ip = nextIp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await startQr(ip);
      expect(response.status).toBe(200);
    }
    const blocked = await startQr(ip);
    expect(blocked.status).toBe(429);
  });

  it("rate-limits QR status per challenge instead of sharing one IP budget", async () => {
    installCasMock();
    const ip = nextIp();
    const first = await startQr(ip);
    const second = await startQr(ip);
    const firstBody = await first.json<{ challenge?: string }>();
    const secondBody = await second.json<{ challenge?: string }>();
    expect(firstBody.challenge).toMatch(/^[0-9a-f]{32}$/);
    expect(secondBody.challenge).toMatch(/^[0-9a-f]{32}$/);

    await env.DB.prepare(
      `INSERT INTO rate_limit_counters(key,window_start,count) VALUES(?,unixepoch(),200)`,
    )
      .bind(`cas-qr-status:${firstBody.challenge}`)
      .run();

    const blocked = await pollQr({ challenge: firstBody.challenge }, ip);
    expect(blocked.status).toBe(429);

    qrComet = "pending";
    const other = await pollQr({ challenge: secondBody.challenge }, ip);
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ status: "pending" });
  });

  it("caps fabricated QR status ids per IP", async () => {
    const ip = nextIp();
    const ipHash = await hmacHex(ip, "test-ip-hash-secret");
    await env.DB.prepare(
      `INSERT INTO rate_limit_counters(key,window_start,count) VALUES(?,unixepoch(),2000)`,
    )
      .bind(`cas-qr-status-ip:${ipHash}`)
      .run();
    const blocked = await pollQr({ challenge: "ab".repeat(16) }, ip);
    expect(blocked.status).toBe(429);
  });
});
