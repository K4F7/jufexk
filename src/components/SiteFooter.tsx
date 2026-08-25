import { LogoGithub } from "@gravity-ui/icons";
import { buttonVariants, Link, Separator } from "@heroui/react";
import { GITHUB_REPO_URL, STATUS_PAGE_URL } from "../lib/site-links";
import { RouterAriaLink } from "./RouterAriaLink";
import { StatusPageBadge } from "./StatusPageBadge";

const INTERNAL_LINKS = [
  { to: "/contact", label: "反馈问题" },
  { to: "/about", label: "关于我们" },
  { to: "/resources", label: "友情链接" },
  { to: "/terms", label: "使用条款" },
  { to: "/admin", label: "管理" },
] as const;

export function SiteFooter({
  siteName,
  universityName,
}: {
  siteName: string;
  universityName: string;
}) {
  return (
    <footer className="border-t border-border px-4 py-4 text-center text-sm text-muted sm:px-5">
      <div className="mx-auto flex max-w-[1520px] flex-col items-center gap-2">
        <p className="m-0">
          {siteName} · {universityName}
        </p>
        <nav
          aria-label="页脚"
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
        >
          <a
            aria-label="GitHub 仓库"
            className={buttonVariants({
              isIconOnly: true,
              size: "sm",
              variant: "ghost",
            })}
            href={GITHUB_REPO_URL}
            rel="noreferrer"
            target="_blank"
          >
            <LogoGithub />
          </a>
          {INTERNAL_LINKS.map((link) => (
            <span
              key={link.to}
              className="inline-flex items-center gap-4 whitespace-nowrap"
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
            <Link
              className="text-muted"
              href={STATUS_PAGE_URL}
              rel="noreferrer"
              render={(domProps) => (
                <a
                  {...(domProps as object)}
                  className={
                    typeof domProps.className === "string"
                      ? domProps.className
                      : undefined
                  }
                  href={STATUS_PAGE_URL}
                  rel="noreferrer"
                  target="_blank"
                />
              )}
              target="_blank"
            >
              系统状态
            </Link>
          </span>
        </nav>
        <StatusPageBadge />
      </div>
    </footer>
  );
}
