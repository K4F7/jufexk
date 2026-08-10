import { Button } from "@heroui/react";
import { NavLink, useLocation } from "react-router-dom";
import type { SiteConfig } from "../lib/types";

const links = [
  { to: "/courses", label: "课程" },
  { to: "/teachers", label: "教师" },
];

export function AppShell({
  config,
  children,
}: {
  config: SiteConfig | null;
  children: React.ReactNode;
}) {
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex min-h-12 max-w-[1100px] items-center justify-between gap-3 px-4 sm:px-5">
          <NavLink
            to="/courses"
            className="text-sm font-semibold text-foreground no-underline"
          >
            {config?.siteName || "江财选课参考"}
          </NavLink>
          <nav className="flex flex-wrap items-center gap-1">
            {links.map((link) => {
              const active =
                location.pathname === link.to ||
                location.pathname.startsWith(`${link.to}/`);
              return (
                <NavLink key={link.to} to={link.to} className="no-underline">
                  <Button
                    size="sm"
                    variant={active ? "secondary" : "ghost"}
                    className="font-semibold"
                  >
                    {link.label}
                  </Button>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-4 sm:px-5">
        {children}
      </main>

      <footer className="border-t border-border px-4 py-4 text-center text-sm text-muted sm:px-5">
        <div className="mx-auto max-w-[1100px]">
          {(config?.siteName || "江财选课参考") +
            " · " +
            (config?.universityName || "江西财经大学")}
        </div>
      </footer>
    </div>
  );
}
