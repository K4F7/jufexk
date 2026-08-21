import { escapeHtml } from "./html";

/** HeroUI Sky `--accent` (`oklch(0.6204 0.195 253.83)` in `src/styles/globals.css`). */
const SKY_ACCENT = "#0485f7";
const SKY_BACKGROUND = "#f0f8ff";
const SKY_SURFACE = "#fafeff";
const SKY_BORDER = "#cadae7";
const SKY_SEPARATOR = "#d7e3ee";

export function buildVerificationEmail(input: {
  siteName: string;
  code: string;
  magicUrl: string;
  ttlMinutes: number;
}) {
  const siteName = input.siteName.trim() || "非官方课评@JUFE";
  const { code, magicUrl, ttlMinutes } = input;
  const subject = `【${siteName}】登录验证码 ${code}`;
  const text = [
    `验证码：${code}`,
    "",
    `${ttlMinutes} 分钟内有效，使用一次后即失效。`,
    "",
    "也可以打开此链接完成登录：",
    magicUrl,
    "",
    "如果不是你本人的操作，请忽略这封邮件；本站不会索要密码。",
  ].join("\n");

  const safeSite = escapeHtml(siteName);
  const safeCode = escapeHtml(code);
  const safeUrl = escapeHtml(magicUrl);
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:${SKY_BACKGROUND};color:#18181b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      登录验证码 ${safeCode}，${ttlMinutes} 分钟内有效
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SKY_BACKGROUND};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${SKY_SURFACE};border:1px solid ${SKY_BORDER};border-radius:12px;">
            <tr>
              <td style="padding:24px 28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.6;">
                <p style="margin:0;font-size:20px;font-weight:700;line-height:1.3;">登录验证</p>
                <p style="margin:2px 0 0;font-size:13px;color:#71717a;">${safeSite}</p>
                <p style="margin:20px 0 0;font-size:13px;color:#71717a;">验证码</p>
                <p style="margin:2px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;line-height:1.2;letter-spacing:0.28em;font-weight:700;color:${SKY_ACCENT};">${safeCode}</p>
                <p style="margin:6px 0 0;font-size:14px;color:#52525b;">${ttlMinutes} 分钟内有效，使用一次后即失效。</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                  <tr>
                    <td style="background:${SKY_ACCENT};border-radius:8px;">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">登录</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font-size:13px;color:#71717a;word-break:break-all;">
                  或复制此链接：<br />
                  <a href="${safeUrl}" style="color:${SKY_ACCENT};word-break:break-all;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;line-height:1.6;color:#71717a;">
                <p style="margin:0;padding-top:14px;border-top:1px solid ${SKY_SEPARATOR};">
                  如果不是你本人的操作，请忽略这封邮件；本站不会索要密码。
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  return { subject, text, html };
}
