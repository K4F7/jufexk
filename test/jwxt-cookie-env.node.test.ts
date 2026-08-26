import { describe, expect, it } from "vitest";
import { buildEhallCookieHeader, updateEhallCookieEnv } from "../scripts/jwxt-cookie-env";

describe("JWXT cookie capture", () => {
  it("selects eHall cookies and only required CAS cookies", () => {
    expect(buildEhallCookieHeader(
      [{ name: "JSESSIONID", value: "ehall" }, { name: "asessionid", value: "app" }, { name: "route", value: "node" }],
      [{ name: "CASTGC", value: "ticket" }, { name: "unrelated", value: "discard" }],
    )).toBe("JSESSIONID=ehall; asessionid=app; route=node; CASTGC=ticket");
  });

  it("waits for an authenticated marker", () => {
    expect(buildEhallCookieHeader([{ name: "JSESSIONID", value: "login" }], [])).toBeNull();
  });

  it("preserves publisher credentials while replacing the cookie", () => {
    const updated = updateEhallCookieEnv("CLOUDFLARE_ACCOUNT_ID=a\nEHALL_COOKIE=old\nCLOUDFLARE_API_TOKEN=t\n", "JSESSIONID=new; CASTGC=ticket");
    expect(updated).toContain("CLOUDFLARE_ACCOUNT_ID=a");
    expect(updated).toContain("EHALL_COOKIE='JSESSIONID=new; CASTGC=ticket'");
    expect(updated).toContain("CLOUDFLARE_API_TOKEN=t");
    expect(updated).not.toContain("EHALL_COOKIE=old");
  });
});
