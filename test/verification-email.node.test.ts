import { describe, expect, it } from "vitest";
import { buildVerificationEmail } from "../src/verification-email";

const sample = {
  siteName: "非官方课评@JUFE",
  code: "123456",
  magicUrl: "https://example.com/login?token=ab&from=%2Fcourses%2F1",
  ttlMinutes: 15,
};

describe("verification email copy", () => {
  it("puts the site name and code in the subject", () => {
    const mail = buildVerificationEmail(sample);
    expect(mail.subject).toBe("【非官方课评@JUFE】登录验证码 123456");
  });

  it("keeps the plaintext code and magic link parseable", () => {
    const mail = buildVerificationEmail(sample);
    expect(mail.text).toContain("验证码：123456");
    expect(mail.text).toContain(sample.magicUrl);
    expect(mail.text).toContain("15 分钟");
    expect(mail.html).toContain("123456");
    expect(mail.html).toContain("登录验证");
    expect(mail.html).toContain(">登录</a>");
    expect(mail.html).toContain(`href="${sample.magicUrl.replaceAll("&", "&amp;")}"`);
  });

  it("escapes the site name and query string in html", () => {
    const mail = buildVerificationEmail({
      ...sample,
      siteName: '评课<script>alert(1)</script>',
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&amp;from=");
    expect(mail.subject).toContain("<script>");
  });
});
