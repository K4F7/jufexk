import { describe, expect, it } from "vitest";
import {
  JwxtAuthenticationError,
  JwxtCookieAuthAdapter,
  JwxtCookieExpiredError,
  EhallCookieAuthAdapter,
  parseJwxtCookieHeader,
} from "../scripts/jwxt-collector/auth-adapter";

describe("JWXT cookie authentication", () => {
  it("parses a raw Cookie header", () => {
    expect(parseJwxtCookieHeader("JSESSIONID=session-1; CASTGC=ticket-1")).toEqual(new Map([
      ["JSESSIONID", "session-1"],
      ["CASTGC", "ticket-1"],
    ]));
  });

  it("rejects missing or unsafe cookie headers", () => {
    expect(() => parseJwxtCookieHeader("CASTGC=missing-jsession")).toThrowError(
      new JwxtAuthenticationError("jwxt_cookie_missing_jsessionid"),
    );
    expect(() => parseJwxtCookieHeader("JSESSIONID=ok\r\nX-Leak: value")).toThrowError(
      new JwxtAuthenticationError("jwxt_cookie_invalid"),
    );
    expect(() => parseJwxtCookieHeader("JSESSIONID=ok　x")).toThrowError(
      new JwxtAuthenticationError("jwxt_cookie_invalid"),
    );
  });

  it("uses the supplied cookie", async () => {
    let receivedCookie = "";
    const adapter = new JwxtCookieAuthAdapter(
      "JSESSIONID=session-1; CASTGC=ticket-1",
      async (_input, init) => {
        receivedCookie = new Headers(init?.headers).get("cookie") || "";
        return new Response("ok", { status: 200 });
      },
    );
    expect((await adapter.request("/student/wsxk.kcbcx10319.html")).status).toBe(200);
    expect(receivedCookie).toBe("JSESSIONID=session-1; CASTGC=ticket-1");
  });

  it("stops instead of relogging after a CAS redirect", async () => {
    const adapter = new JwxtCookieAuthAdapter(
      "JSESSIONID=expired",
      async () => new Response(null, {
        status: 302,
        headers: { location: "https://ssl.jxufe.edu.cn/cas/login" },
      }),
    );
    await expect(adapter.request("/student/wsxk.kcbcx10319.html")).rejects.toBeInstanceOf(
      JwxtCookieExpiredError,
    );
  });

  it("replays an eHall cookie before establishing a JWXT session", async () => {
    const calls: Array<{ url: string; cookie: string }> = [];
    const adapter = new EhallCookieAuthAdapter(
      "JSESSIONID=ehall-session",
      async (input, init) => {
        const url = String(input);
        calls.push({ url, cookie: new Headers(init?.headers).get("cookie") || "" });
        if (url.startsWith("http://ehall.jxufe.edu.cn/appShow")) {
          return new Response(null, {
            status: 302,
            headers: {
              location: "https://ssl.jxufe.edu.cn/cas/login?service=https%3A%2F%2Fjwxt.jxufe.edu.cn%2Fjxcjcaslogin",
            },
          });
        }
        if (url.startsWith("https://ssl.jxufe.edu.cn/cas/login")) {
          return new Response(null, {
            status: 302,
            headers: {
              location: "https://jwxt.jxufe.edu.cn/jxcjcaslogin?ticket=ST-fixture",
            },
          });
        }
        if (url.startsWith("https://jwxt.jxufe.edu.cn/jxcjcaslogin")) {
          return new Response(null, {
            status: 302,
            headers: {
              location: "/student/index.jsp",
              "set-cookie": "JSESSIONID=jwxt-session; Path=/; HttpOnly",
            },
          });
        }
        return new Response("ok");
      },
    );

    await adapter.request("/student/wsxk.kcbcx10319.html");
    expect(calls[0].cookie).toBe("JSESSIONID=ehall-session");
    expect(calls.at(-1)?.cookie).toBe("JSESSIONID=jwxt-session");
  });
});
