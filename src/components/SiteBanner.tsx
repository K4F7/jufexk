import { Alert, CloseButton } from "@heroui/react";
import { useEffect, useState } from "react";
import {
  REVIEW_NOTE_ALLOWED_ATTRS,
  REVIEW_NOTE_ALLOWED_TAGS,
} from "../lib/review-note-html";
import type { SiteBanner as SiteBannerValue } from "../site-banner";

const SITE_BANNER_DISMISS_KEY = "jufexk-site-banner-dismissed";

function bannerDismissToken(banner: SiteBannerValue) {
  return banner.updatedAt || `${banner.desktopHtml}\n${banner.mobileHtml}`;
}

function writeDismissed(token: string) {
  try {
    window.localStorage.setItem(SITE_BANNER_DISMISS_KEY, token);
  } catch {
    /* private mode / quota */
  }
}

function BannerAlert({
  html,
  className,
  onDismiss,
}: {
  html: string;
  className: string;
  onDismiss: () => void;
}) {
  const [sanitizedHtml, setSanitizedHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("dompurify").then(({ default: DOMPurify }) => {
      if (cancelled) return;
      setSanitizedHtml(
        DOMPurify.sanitize(html, {
          ALLOWED_TAGS: [...REVIEW_NOTE_ALLOWED_TAGS],
          ALLOWED_ATTR: [...REVIEW_NOTE_ALLOWED_ATTRS, "target", "rel"],
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [html]);

  if (sanitizedHtml == null) return null;
  return (
    <Alert className={`${className} items-center py-2`} status="accent">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          <div
            className="review-note-html break-words"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        </Alert.Description>
      </Alert.Content>
      <CloseButton aria-label="关闭公告" onPress={onDismiss} />
    </Alert>
  );
}

export function SiteBanner({ banner }: { banner: SiteBannerValue | null }) {
  const token = banner ? bannerDismissToken(banner) : "";
  const [dismissedToken, setDismissedToken] = useState(() => {
    try {
      return window.localStorage.getItem(SITE_BANNER_DISMISS_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const dismissed = Boolean(token) && dismissedToken === token;

  if (!banner || (!banner.desktopHtml && !banner.mobileHtml) || dismissed) {
    return null;
  }

  const dismiss = () => {
    writeDismissed(token);
    setDismissedToken(token);
  };

  return (
    <section
      aria-label="全站公告"
      className="mx-auto w-full max-w-[1520px] px-4 pt-2 sm:px-5 xl:px-4"
      data-site-banner
    >
      {banner.mobileHtml ? (
        <BannerAlert
          className="sm:hidden"
          html={banner.mobileHtml}
          onDismiss={dismiss}
        />
      ) : null}
      {banner.desktopHtml ? (
        <BannerAlert
          className="hidden sm:flex"
          html={banner.desktopHtml}
          onDismiss={dismiss}
        />
      ) : null}
    </section>
  );
}
