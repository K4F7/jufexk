import { escapeHtml } from "./html";

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
    `你正在登录「${siteName}」。`,
    "",
    `验证码：${code}`,
    "",
    `此验证码 ${ttlMinutes} 分钟内有效，使用一次后即失效。`,
    "",
    "也可以打开此链接完成登录：",
    magicUrl,
    "",
    "如果不是你本人的操作，请忽略这封邮件。本站不会通过邮件向你索要密码或其他个人信息。",
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
  <body style="margin:0;padding:0;background:#f4f4f5;color:#18181b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      登录验证码 ${safeCode}，${ttlMinutes} 分钟内有效
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;">
            <tr>
              <td style="padding:28px 28px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.6;">
                <p style="margin:0 0 8px;font-size:13px;color:#71717a;">${safeSite}</p>
                <p style="margin:0 0 20px;">你正在登录，请使用下面的验证码完成验证。</p>
                <p style="margin:0 0 8px;font-size:13px;color:#71717a;">验证码</p>
                <p style="margin:0 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;line-height:1.2;letter-spacing:0.28em;font-weight:700;">${safeCode}</p>
                <p style="margin:0 0 24px;font-size:14px;color:#52525b;">此验证码 ${ttlMinutes} 分钟内有效，使用一次后即失效。</p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background:#18181b;border-radius:8px;">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">打开登录链接</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:20px 0 0;font-size:13px;color:#71717a;word-break:break-all;">
                  或复制此链接：<br />
                  <a href="${safeUrl}" style="color:#3f3f46;word-break:break-all;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;line-height:1.6;color:#71717a;">
                <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #e4e4e7;">
                  如果不是你本人的操作，请忽略这封邮件。本站不会通过邮件向你索要密码或其他个人信息。
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
