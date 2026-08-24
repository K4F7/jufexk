import { LogoGithub } from "@gravity-ui/icons";
import { buttonVariants } from "@heroui/react";
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL } from "../lib/site-links";
import { RouterAriaLink } from "./RouterAriaLink";

const INTERNAL_LINKS = [
  { to: "/about", label: "关于我们" },
  { to: "/contact", label: "联系我们" },
  { to: "/resources", label: "资源" },
  { to: "/terms", label: "使用条款" },
  { to: "/announcements", label: "公告" },
  { to: "/admin", label: "管理" },
] as const;

function Dot() {
  return (
    <span aria-hidden className="mx-2">
      ·
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
    <footer className="border-t border-border px-4 py-4 text-center text-sm text-muted sm:px-5">
      <div className="mx-auto flex max-w-[1520px] flex-col items-center gap-2">
        <p className="m-0">
          {siteName} · {universityName}
        </p>
        <nav
          aria-label="页脚"
          className="flex flex-wrap items-center justify-center"
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
          <Dot />
          <a
            className="link text-muted"
            href={GITHUB_ISSUES_URL}
            rel="noreferrer"
            target="_blank"
          >
            反馈问题
          </a>
          {INTERNAL_LINKS.map((link) => (
            <span key={link.to}>
              <Dot />
              <RouterAriaLink className="text-muted" to={link.to}>
                {link.label}
              </RouterAriaLink>
            </span>
          ))}
        </nav>
      </div>
    </footer>
  );
}
