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
    html: `<section aria-label="最新课评" class="latest-feed"><h1 class="m-0 mb-3 text-lg font-bold leading-tight">最新课评</h1><div>${content}</div></section>`,
    data: `<script type="application/json" id="jufexk-latest-data">${escapeJsonForHtml(page)}</script>`,
  };
}

export function injectLatestShell(documentHtml: string, page: PublicReviewPage<LatestReview>) {
  const shell = renderLatestShell(page);
  return documentHtml.replace(
    '<div id="app"></div>',
    `<div id="app">${shell.html}</div>${shell.data}`,
  );
}
