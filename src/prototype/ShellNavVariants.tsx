/**
 * PROTOTYPE — shell-nav variants (throwaway; not production-ready).
 *
 * Question: 桌面公共顶栏 / 公共壳与主题切换应如何组织？
 *
 * Round 5 — 官方组件优先（见 AGENTS.md）：只比较 HeroUI 官方导航形态。
 * 视觉冻结胜出：**C**（Button secondary/ghost）。生产 DefaultShell 已对齐 C。
 *
 * A — 左簇 + Tabs primary
 * B — 左簇 + Tabs secondary
 * C — 左簇 + Button secondary/ghost（胜出）
 *
 * Mounted via AppShell when ?module=shell-nav&variant=A|B|C (DEV only).
 */
import { Button, Tabs } from "@heroui/react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import { ThemeToggle } from "../components/ThemeToggle";
import type { SiteConfig } from "../lib/types";
import {
  PROTOTYPE_MODULE_PARAM,
  PROTOTYPE_VARIANT_PARAM,
} from "./enabled";

export type ShellNavVariantKey = "A" | "B" | "C";

const SHELL_KEYS: ShellNavVariantKey[] = ["A", "B", "C"];

export function isShellNavVariantKey(key: string): key is ShellNavVariantKey {
  return (SHELL_KEYS as string[]).includes(key);
}

const NAV_LINKS = [
  { id: "courses", to: "/courses", label: "课程" },
  { id: "teachers", to: "/teachers", label: "教师" },
] as const;

function brandName(config: SiteConfig | null) {
  return config?.siteName || "非官方课评@JUFE";
}

function uniName(config: SiteConfig | null) {
  return config?.universityName || "江西财经大学";
}

function navSelectedKey(pathname: string): "courses" | "teachers" {
  if (pathname === "/teachers" || pathname.startsWith("/teachers/")) {
    return "teachers";
  }
  return "courses";
}

/** Keep module/variant when jumping 课程↔教师 so the shell prototype stays live. */
function withPrototypeParams(path: string, params: URLSearchParams) {
  const moduleId = params.get(PROTOTYPE_MODULE_PARAM);
  const variant = params.get(PROTOTYPE_VARIANT_PARAM);
  if (!moduleId) return path;
  const sp = new URLSearchParams();
  sp.set(PROTOTYPE_MODULE_PARAM, moduleId);
  if (variant) sp.set(PROTOTYPE_VARIANT_PARAM, variant);
  return `${path}?${sp.toString()}`;
}

function FooterLine({ config }: { config: SiteConfig | null }) {
  return (
    <footer className="border-t border-border px-4 py-4 text-center text-sm text-muted sm:px-5">
      <div className="mx-auto max-w-[1520px]">
        {brandName(config)} · {uniName(config)}
      </div>
    </footer>
  );
}

/** Shared chrome: sticky header row, brand wordmark, university + theme. */
function ShellChrome({
  config,
  params,
  nav,
  children,
}: {
  config: SiteConfig | null;
  params: URLSearchParams;
  nav: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-[1520px] items-center gap-4 px-4 py-2.5 sm:px-5">
          <NavLink
            to={withPrototypeParams("/courses", params)}
            className="shrink-0 text-sm font-semibold tracking-tight text-foreground no-underline"
          >
            {brandName(config)}
          </NavLink>

          {nav}

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted sm:inline">
              {uniName(config)}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1520px] flex-1 px-4 py-4 sm:px-5">
        {children}
      </main>
      <FooterLine config={config} />
    </div>
  );
}

function OfficialTabsNav({
  params,
  selectedKey,
  variant,
}: {
  params: URLSearchParams;
  selectedKey: "courses" | "teachers";
  variant: "primary" | "secondary";
}) {
  return (
    <Tabs
      aria-label="主导航"
      className="w-fit min-w-0"
      selectedKey={selectedKey}
      variant={variant}
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label="主导航">
          {NAV_LINKS.map((link) => {
            const to = withPrototypeParams(link.to, params);
            return (
              <Tabs.Tab
                key={link.id}
                href={to}
                id={link.id}
                render={(domProps) => (
                  <NavLink
                    {...(domProps as object)}
                    to={to}
                    className={
                      typeof domProps.className === "string"
                        ? domProps.className
                        : undefined
                    }
                  />
                )}
              >
                {link.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}

/** A — HeroUI Tabs primary (default filled indicator). */
function ShellA({
  config,
  children,
}: {
  config: SiteConfig | null;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  return (
    <ShellChrome
      config={config}
      params={params}
      nav={
        <OfficialTabsNav
          params={params}
          selectedKey={navSelectedKey(location.pathname)}
          variant="primary"
        />
      }
    >
      {children}
    </ShellChrome>
  );
}

/** B — HeroUI Tabs secondary (underline indicator). */
function ShellB({
  config,
  children,
}: {
  config: SiteConfig | null;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  return (
    <ShellChrome
      config={config}
      params={params}
      nav={
        <OfficialTabsNav
          params={params}
          selectedKey={navSelectedKey(location.pathname)}
          variant="secondary"
        />
      }
    >
      {children}
    </ShellChrome>
  );
}

/** C — HeroUI Button secondary/ghost (same primitive as ThemeToggle). */
function ShellC({
  config,
  children,
}: {
  config: SiteConfig | null;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  const selectedKey = navSelectedKey(location.pathname);

  return (
    <ShellChrome
      config={config}
      params={params}
      nav={
        <nav aria-label="主导航" className="flex min-w-0 items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = selectedKey === link.id;
            return (
              <NavLink
                key={link.id}
                to={withPrototypeParams(link.to, params)}
                className="no-underline"
              >
                <Button
                  size="sm"
                  variant={active ? "secondary" : "ghost"}
                >
                  {link.label}
                </Button>
              </NavLink>
            );
          })}
        </nav>
      }
    >
      {children}
    </ShellChrome>
  );
}

export function PrototypeShell({
  variant,
  config,
  children,
}: {
  variant: ShellNavVariantKey;
  config: SiteConfig | null;
  children: React.ReactNode;
}) {
  if (variant === "B") {
    return <ShellB config={config}>{children}</ShellB>;
  }
  if (variant === "C") {
    return <ShellC config={config}>{children}</ShellC>;
  }
  return <ShellA config={config}>{children}</ShellA>;
}
