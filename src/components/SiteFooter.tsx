import { LogoGithub } from "@gravity-ui/icons";
import { buttonVariants, Separator } from "@heroui/react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { GITHUB_REPO_URL } from "../lib/site-links";
import { RouterAriaLink } from "./RouterAriaLink";
import { StatusPageBadge } from "./StatusPageBadge";

const INTERNAL_LINKS = [
  { to: "/contact", label: "反馈问题" },
  { to: "/about", label: "关于我们" },
  { to: "/resources", label: "友情链接" },
  { to: "/terms", label: "使用条款" },
] as const;

const ghostSmIconClass = `${buttonVariants({
  isIconOnly: true,
  size: "sm",
  variant: "ghost",
})}`;

/**
 * Desktop-only site footer. Mobile viewports omit the node entirely so
 * overscroll / rubber-band cannot reveal a CSS-hidden footer.
 */
export function SiteFooter({
  siteName,
  universityName,
}: {
  siteName: string;
  universityName: string;
}) {
  const isDesktop = useMediaQuery("(min-width: 640px)");
  if (!isDesktop) return null;

  return (
    <footer className="border-t border-border px-5 py-4 text-center text-sm text-muted">
      <div className="flex justify-center">
        <div
          className="flex w-fit max-w-[1520px] shrink-0 flex-col items-center gap-2 text-center"
          data-footer-cluster=""
        >
          <p className="m-0 whitespace-nowrap">
            {siteName} · {universityName}
          </p>
          <nav
            aria-label="页脚"
            className="flex w-fit flex-wrap items-center justify-center gap-x-4 gap-y-2"
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
                <span aria-hidden>
                  <Separator className="h-4" orientation="vertical" />
                </span>
                <RouterAriaLink className="text-muted" to={link.to}>
                  {link.label}
                </RouterAriaLink>
              </span>
            ))}
            <span className="inline-flex items-center gap-4 whitespace-nowrap">
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
