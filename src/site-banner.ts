import {
  REVIEW_NOTE_HTML_MAX_LENGTH,
  REVIEW_NOTE_RAW_MAX_LENGTH,
  sanitizeReviewNoteHtml,
} from "./lib/review-note-html";

export const SITE_BANNER_HTML_MAX_LENGTH = REVIEW_NOTE_HTML_MAX_LENGTH;
export const SITE_BANNER_RAW_MAX_LENGTH = REVIEW_NOTE_RAW_MAX_LENGTH;

export type SiteBanner = {
  desktopHtml: string;
  mobileHtml: string;
  updatedAt: string | null;
};

export type SiteBannerContent = Pick<SiteBanner, "desktopHtml" | "mobileHtml">;

type SiteBannerRow = {
  desktop_html: string;
  mobile_html: string;
  updated_at: string;
};

export async function loadSiteBanner(db: D1Database): Promise<SiteBanner> {
  const row = await db
    .prepare(
      `SELECT desktop_html,mobile_html,updated_at
       FROM site_banner_current WHERE id=1`,
    )
    .first<SiteBannerRow>();
  return {
    desktopHtml: row?.desktop_html ?? "",
    mobileHtml: row?.mobile_html ?? "",
    updatedAt: row?.updated_at ?? null,
  };
}

export function sanitizeSiteBanner(input: {
  desktopHtml: string;
  mobileHtml: string;
}): SiteBannerContent | null {
  const desktopHtml = sanitizeReviewNoteHtml(input.desktopHtml).trim();
  const mobileHtml = sanitizeReviewNoteHtml(input.mobileHtml).trim();
  if (
    desktopHtml.length > SITE_BANNER_HTML_MAX_LENGTH ||
    mobileHtml.length > SITE_BANNER_HTML_MAX_LENGTH
  ) {
    return null;
  }
  return { desktopHtml, mobileHtml };
}
