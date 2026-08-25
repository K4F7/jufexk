import { describe, expect, it } from "vitest";
import {
  JwxtAuthenticationError,
  JwxtCookieAuthAdapter,
  JwxtCookieExpiredError,
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
});
