import { LogoGithub } from "@gravity-ui/icons";
import { buttonVariants, Separator } from "@heroui/react";
import { GITHUB_REPO_URL } from "../lib/site-links";
import { RouterAriaLink } from "./RouterAriaLink";
import { StatusPageBadge } from "./StatusPageBadge";

const INTERNAL_LINKS = [
  { to: "/contact", label: "反馈问题" },
  { to: "/about", label: "关于我们" },
  { to: "/resources", label: "友情链接" },
  { to: "/terms", label: "使用条款" },
] as const;

const ghostSmLinkClass = `${buttonVariants({
  size: "sm",
  variant: "ghost",
})} no-underline max-sm:!px-2`;

const ghostSmIconClass = `${buttonVariants({
  isIconOnly: true,
  size: "sm",
  variant: "ghost",
})} max-sm:!w-auto max-sm:!min-w-0 max-sm:!px-2`;

/**
 * Official iframe stays 250×30 so the widget does not reflow.
 * The painted chip (`<a>` on the Better Stack badge page) is 183×30;
 * crop the layout box to that plus 1px slack so empty iframe space
 * is not part of the centered cluster.
 */
const BADGE_PAINTED_WIDTH = 184;
const BADGE_PAINTED_HEIGHT = 30;

function MobileStatusPageBadge() {
  return (
    <span
      className="block shrink-0 overflow-hidden sm:hidden"
      style={{ width: BADGE_PAINTED_WIDTH, height: BADGE_PAINTED_HEIGHT }}
    >
      <StatusPageBadge />
    </span>
  );
}

export function SiteFooter({
  siteName,
  universityName,
}: {
  siteName: string;
  universityName: string;
}) {
  return (
    <footer className="border-t border-border px-4 pt-3 pb-20 text-center text-sm text-muted sm:px-5 sm:py-4">
      <div className="-mx-4 flex justify-center sm:mx-0">
        <div
          className="flex w-fit shrink-0 flex-col items-center gap-1.5 text-center sm:max-w-[1520px] sm:gap-2"
          data-footer-cluster=""
        >
        <div className="flex w-fit items-center justify-center gap-2">
          <p className="m-0 whitespace-nowrap">
            {siteName} · {universityName}
          </p>
          <MobileStatusPageBadge />
        </div>
        <nav
          aria-label="页脚"
          className="flex w-fit flex-nowrap items-center justify-center gap-x-1 sm:flex-wrap sm:gap-x-4 sm:gap-y-2"
        >
          <a
            aria-label="GitHub 仓库"
            className={ghostSmIconClass}
            href={GITHUB_REPO_URL}
            rel="noreferrer"
            target="_blank"
          >
            <LogoGithub aria-hidden />
          </a>
          {INTERNAL_LINKS.map((link) => (
            <span
              key={link.to}
              className="inline-flex items-center justify-center gap-4 whitespace-nowrap"
            >
              <span aria-hidden className="max-sm:hidden">
                <Separator className="h-4" orientation="vertical" />
              </span>
              <RouterAriaLink
                className={`${ghostSmLinkClass} sm:hidden`}
                to={link.to}
              >
                {link.label}
              </RouterAriaLink>
              <RouterAriaLink
                className="text-muted max-sm:hidden"
                to={link.to}
              >
                {link.label}
              </RouterAriaLink>
            </span>
          ))}
          <span className="hidden items-center gap-4 whitespace-nowrap sm:inline-flex">
            <span aria-hidden>
              <Separator className="h-4" orientation="vertical" />
            </span>
            <StatusPageBadge />
          </span>
        </nav>
        </div>
      </div>
    </footer>
  );
}
