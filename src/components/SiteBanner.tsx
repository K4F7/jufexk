import { Alert } from "@heroui/react";
import DOMPurify from "dompurify";
import {
  REVIEW_NOTE_ALLOWED_ATTRS,
  REVIEW_NOTE_ALLOWED_TAGS,
} from "../lib/review-note-html";
import type { SiteBanner as SiteBannerValue } from "../site-banner";

function BannerAlert({ html, className }: { html: string; className: string }) {
  const sanitizedHtml = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...REVIEW_NOTE_ALLOWED_TAGS],
    ALLOWED_ATTR: [...REVIEW_NOTE_ALLOWED_ATTRS, "target", "rel"],
  });
  return (
    <Alert className={className} status="accent">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          <div
            className="review-note-html break-words"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

export function SiteBanner({ banner }: { banner: SiteBannerValue | null }) {
  if (!banner || (!banner.desktopHtml && !banner.mobileHtml)) return null;
  return (
    <section
      aria-label="全站公告"
      className="mx-auto w-full max-w-[1520px] px-4 sm:px-5 xl:px-4"
      data-site-banner
    >
      {banner.mobileHtml ? (
        <BannerAlert className="sm:hidden" html={banner.mobileHtml} />
      ) : null}
      {banner.desktopHtml ? (
        <BannerAlert className="hidden sm:flex" html={banner.desktopHtml} />
      ) : null}
    </section>
  );
}
