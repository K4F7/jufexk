import { formatReviewDate } from "./lib/review-date";
import type { LatestReview, PublicReviewPage } from "./lib/types";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const escapeJsonForHtml = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

export function renderLatestShell(page: PublicReviewPage<LatestReview>) {
  const items = page.items
    .slice(0, 10)
    .map((review) => {
      const date = formatReviewDate(review.created_at);
      const href = `/courses/${review.course_id}?teacher=${review.teacher_id}`;
      const author = review.author_public_code == null
        ? "匿名用户"
        : `同学 ${review.author_public_code}`;
      const text = review.headline || review.comment;
      return `<article class="latest-ssr-review"><header><span>${escapeHtml(author)} 点评了 <a href="${escapeHtml(href)}">${escapeHtml(review.course_name)}${review.teacher_name ? `（${escapeHtml(review.teacher_name)}）` : ""}</a></span>${date ? `<time datetime="${escapeHtml(review.created_at)}">${escapeHtml(date)}</time>` : ""}</header><p>${escapeHtml(text)}</p></article>`;
    })
    .join("");
  const content = items || `<p class="m-0 text-muted">暂时还没有公开课评</p>`;
  return {
    html: `<div class="latest-ssr-header-spacer" aria-hidden="true"></div><section aria-label="最新课评" class="latest-feed"><h1 class="m-0 mb-3 text-lg font-bold leading-tight">最新课评</h1><div>${content}</div></section>`,
    data: `<script type="application/json" id="jufexk-latest-data">${escapeJsonForHtml(page)}</script>`,
  };
}

export function injectLatestShell(documentHtml: string, page: PublicReviewPage<LatestReview>) {
  const shell = renderLatestShell(page);
  const criticalStyle = `<style data-latest-critical>.latest-ssr-header-spacer{height:195px}.latest-feed{max-width:48rem;margin:0 auto;padding:1rem}.latest-feed h1{font-size:1.125rem;line-height:1.25;font-weight:700;margin:0 0 .75rem}.latest-ssr-review{padding:.75rem 0;border-bottom:1px solid #e4e4e7}.latest-ssr-review header{display:flex;justify-content:space-between;gap:.75rem;font-size:.875rem;line-height:1.25}.latest-ssr-review time{color:#71717a;white-space:nowrap}.latest-ssr-review p{margin:.5rem 0 0;line-height:1.5;white-space:pre-wrap}.latest-feed a{color:#2563eb;text-decoration:none}@media (min-width:80rem){.latest-ssr-header-spacer{height:88px}}</style>`;
  const withShell = documentHtml.replace(
    '<div id="app"></div>',
    `<div id="app">${shell.html}</div>${shell.data}`,
  );
  return withShell.replace("</head>", `${criticalStyle}</head>`);
}
