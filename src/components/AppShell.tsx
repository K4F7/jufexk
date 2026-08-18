import { buttonVariants, Link } from "@heroui/react";
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import { useCampusAuthEnabled } from "../hooks/useCampusAuthStatus";
import type { SiteConfig } from "../lib/types";
import { AccountNavControl } from "./AccountNavControl";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { id: "courses", to: "/courses", label: "课程" },
  { id: "teachers", to: "/teachers", label: "教师" },
  { id: "submit", to: "/submit", label: "写评价" },
] as const;

/** DEV-only: live shell-nav prototype shell (dynamic so production never ships it). */
const PrototypeShellLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/ShellNavVariants").then((m) => ({
        default: m.PrototypeShell,
      })),
    )
  : null;

function useShellNavPrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "shell-nav") return null;
    const key = (params.get("variant") || "C").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "C";
  }, [params]);
}

function navSelectedKey(pathname: string): string {
  if (pathname === "/teachers" || pathname.startsWith("/teachers/")) {
    return "teachers";
  }
  if (pathname === "/submit" || pathname.startsWith("/submit/")) {
    return "submit";
  }
  return "courses";
}

/**
 * Production shell — visually frozen: left-cluster + button-styled Link nav (prototype C).
 * Brand wordmark · Button secondary/ghost 课程/教师 · university + ThemeToggle.
 *
 * 「写评价」只在校园认证开放后进入导航（foundations: 不展示不可用或
 * “即将开放”的入口；Issue #277）；未开放期间 /submit 直达路由不受影响。
 */
function DefaultShell({
  config,
  children,
}: {
  config: SiteConfig | null;
  children: ReactNode;
}) {
  const location = useLocation();
  const selectedKey = navSelectedKey(location.pathname);
  const campusEnabled = useCampusAuthEnabled();
  const siteName = config?.siteName || "江财选课参考";
  const universityName = config?.universityName || "江西财经大学";
  const visibleLinks = links.filter(
    (link) => link.id !== "submit" || campusEnabled === true,
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-[1280px] items-center gap-4 px-4 py-2.5 sm:px-5">
          <NavLink
            to="/courses"
            className="shrink-0 text-sm font-semibold tracking-tight text-foreground no-underline"
          >
            {siteName}
          </NavLink>

          <nav aria-label="主导航" className="flex min-w-0 items-center gap-1">
            {visibleLinks.map((link) => {
              const active = selectedKey === link.id;
              return (
                <Link
                  key={link.id}
                  className={`${buttonVariants({
                    size: "sm",
                    variant: active ? "secondary" : "ghost",
                  })} no-underline`}
                  href={link.to}
                  render={(domProps) => (
                    <NavLink
                      {...(domProps as object)}
                      className={
                        typeof domProps.className === "string"
                          ? domProps.className
                          : undefined
                      }
                      to={link.to}
                    />
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted sm:inline">
              {universityName}
            </span>
            <AccountNavControl campusEnabled={campusEnabled} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-4 sm:px-5">
        {children}
      </main>

      <footer className="border-t border-border px-4 py-4 text-center text-sm text-muted sm:px-5">
        <div className="mx-auto max-w-[1280px]">
          {siteName} · {universityName}
        </div>
      </footer>
    </div>
  );
}

export function AppShell({
  config,
  children,
}: {
  config: SiteConfig | null;
  children: React.ReactNode;
}) {
  const prototypeVariant = useShellNavPrototypeVariant();

  if (prototypeVariant && PrototypeShellLazy) {
    return (
      <Suspense fallback={<DefaultShell config={config}>{children}</DefaultShell>}>
        <PrototypeShellLazy variant={prototypeVariant} config={config}>
          {children}
        </PrototypeShellLazy>
      </Suspense>
    );
  }

  return <DefaultShell config={config}>{children}</DefaultShell>;
}
