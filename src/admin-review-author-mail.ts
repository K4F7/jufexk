import { escapeHtml } from "./html";
import { readSecret } from "./secrets";

type SecretBinding = string | { get(): Promise<string> };

export type ReviewAuthorIdentity = {
  provider: string;
  issuer: string;
  subject: string;
  created_at: string;
};

export type ReviewAuthorLookup = {
  reviewId: number;
  courseCode: string;
  courseName: string;
  teacherName: string;
  headline: string;
  comment: string;
  reviewCreatedAt: string;
  reviewStatus: string;
  blockedAt: string | null;
  deletedAt: string | null;
  submitterHash: string;
  authorUserId: string | null;
  authorStatus: string | null;
  authorCreatedAt: string | null;
  identities: ReviewAuthorIdentity[];
  requestedBySessionId: string;
};

type ReviewAuthorMailEnv = {
  SITE_NAME?: string;
  MAIL_DELIVERY_URL?: string;
  MAIL_FROM?: string;
  MAIL_DELIVERY_TOKEN?: SecretBinding;
  REVIEW_AUTHOR_LOOKUP_TO?: SecretBinding;
};

export type ReviewAuthorMailResult = "sent" | "unconfigured" | "failed";

function identityLines(identities: ReviewAuthorIdentity[]) {
  if (!identities.length) return ["- 无已关联认证身份"];
  return identities.map(
    (identity) =>
      `- ${identity.provider} | issuer=${identity.issuer} | subject=${identity.subject} | linked_at=${identity.created_at}`,
  );
}

function buildReviewAuthorMail(input: ReviewAuthorLookup) {
  const lines = [
    `点评 ID：${input.reviewId}`,
    `课程：${input.courseCode} ${input.courseName}`,
    `教师：${input.teacherName || "（未绑定）"}`,
    `一句话总结：${input.headline || "（无）"}`,
    `点评状态：${input.reviewStatus}`,
    `屏蔽时间：${input.blockedAt || "（未屏蔽）"}`,
    `删除时间：${input.deletedAt || "（未删除）"}`,
    `投稿时间：${input.reviewCreatedAt}`,
    `投稿来源摘要：${input.submitterHash || "（无）"}`,
    `站内用户 ID：${input.authorUserId || "（历史点评未关联）"}`,
    `用户状态：${input.authorStatus || "（未知）"}`,
    `用户创建时间：${input.authorCreatedAt || "（未知）"}`,
    `查询管理员会话：${input.requestedBySessionId}`,
    "",
    "认证身份：",
    ...identityLines(input.identities),
    "",
    "点评正文：",
    input.comment || "（无正文）",
  ];
  const text = lines.join("\n");
  const html = `<pre style="white-space:pre-wrap;font:14px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace">${escapeHtml(text)}</pre>`;
  return {
    subject: `【点评作者查询】#${input.reviewId} ${input.courseName}`,
    text,
    html,
  };
}

export async function deliverReviewAuthorLookup(
  env: ReviewAuthorMailEnv,
  input: ReviewAuthorLookup,
): Promise<ReviewAuthorMailResult> {
  const url = typeof env.MAIL_DELIVERY_URL === "string" ? env.MAIL_DELIVERY_URL.trim() : "";
  const from = typeof env.MAIL_FROM === "string" ? env.MAIL_FROM.trim() : "";
  const token = await readSecret(env.MAIL_DELIVERY_TOKEN);
  const to = (await readSecret(env.REVIEW_AUTHOR_LOOKUP_TO)).trim();
  if (!url || !from || !token || !to) return "unconfigured";
  const mail = buildReviewAuthorMail(input);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
