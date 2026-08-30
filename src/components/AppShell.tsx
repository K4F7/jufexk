import { buttonVariants, Link, SearchField, Tabs } from "@heroui/react";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  NavLink,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import type { SiteConfig } from "../lib/types";
import type { SiteBanner as SiteBannerValue } from "../site-banner";
import { AccountNavControl } from "./AccountNavControl";
import { SiteFooter } from "./SiteFooter";
import { ThemeToggle } from "./ThemeToggle";
import { SiteBanner } from "./SiteBanner";

/**
 * Production shell — USTC 评课社区对齐（Issue #402）：
 * 桌面 xl+：左簇品牌 + Button 课评/课程/导师 · 居中搜索 · 右账号。
 * 窄屏：品牌+账号 / 整行搜索 / 等宽 Tabs（课评/课程；导师外链未适配移动端，不挂）。
 * /profile /account /submit 窄屏不挂浏览 Tabs（个人面，不是逛目录）；品牌仍回 /latest。
 * 排课模拟只在 API `showScheduleNav` 为真时出现。写评价只从课程页「写点评」进入。
 */

const PI_REVIEW_URL = "https://pi-review.com/universities/661";

/** DEV-only: live shell-nav prototype shell (dynamic so production never ships it). */
const PrototypeShellLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/ShellNavVariants").then((m) => ({
        default: m.PrototypeShell,
      })),
    )
  : null;

/** DEV-only: global-search A/B/C compare (issue #303; not production). */
const GlobalSearchPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/GlobalSearchVariants").then((m) => ({
        default: m.GlobalSearchPrototype,
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

function useGlobalSearchPrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "global-search") return null;
    const key = (params.get("variant") || "A").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "A";
  }, [params]);
}

function SkipToMain() {
  return (
    <a
      className="skip-link"
      href="#main-content"
      onClick={(event) => {
        const main = document.getElementById("main-content");
        if (!main) return;
        event.preventDefault();
        main.focus();
      }}
    >
      跳到主内容
    </a>
  );
}

function navSelectedKey(pathname: string): string {
  if (pathname === "/" || pathname === "/latest") return "latest";
  if (pathname === "/schedule" || pathname.startsWith("/schedule/")) {
    return "schedule";
  }
  return "courses";
}

/** Logged-in “me” surfaces: hide 课评/课程 Tabs in the narrow header only. */
function isMeAccountSurface(pathname: string): boolean {
  return (
    pathname === "/profile" ||
    pathname === "/account" ||
    pathname === "/submit"
  );
}

type ShellNavLink = { id: string; to: string; label: string };

function brandClassName(extra = "") {
  return `${buttonVariants({
    size: "sm",
    variant: "ghost",
  })} min-w-0 truncate no-underline ${extra}`.trim();
}

function ShellBrand({ to, siteName, className = "" }: { to: string; siteName: string; className?: string }) {
  return (
    <Link
      className={brandClassName(className)}
      href={to}
      render={(domProps) => (
        <NavLink
          {...(domProps as object)}
          className={
            typeof domProps.className === "string"
              ? domProps.className
              : undefined
          }
          to={to}
        />
      )}
    >
      <span className="min-w-0 truncate">{siteName}</span>
    </Link>
  );
}

function DesktopNavLinks({
  links,
  selectedKey,
  params,
}: {
  links: ShellNavLink[];
  selectedKey: string;
  params: URLSearchParams;
}) {
  return (
    <>
      {links.map((link) => {
        const active = selectedKey === link.id;
        const to = import.meta.env.DEV
          ? withGlobalSearchParams(link.to, params)
          : link.to;
        return (
          <Link
            key={link.id}
            className={`${buttonVariants({
              size: "sm",
              variant: active ? "secondary" : "ghost",
            })} no-underline`}
            href={to}
            render={(domProps) => (
              <NavLink
                {...(domProps as object)}
                className={
                  typeof domProps.className === "string"
                    ? domProps.className
                    : undefined
                }
                to={to}
              />
            )}
          >
            {link.label}
          </Link>
        );
      })}
      <a
        aria-label="导师（新窗口打开）"
        className={buttonVariants({ size: "sm", variant: "ghost" })}
        href={PI_REVIEW_URL}
        target="_blank"
        rel="noreferrer"
      >
        导师
      </a>
    </>
  );
}

/** Narrow-screen primary nav: official equal-width Tabs, not desktop ghost buttons.
 * 导师外链未适配移动端，只在桌面 `DesktopNavLinks` 保留。 */
function MobileTabsNav({
  links,
  selectedKey,
  params,
}: {
  links: ShellNavLink[];
  selectedKey: string;
  params: URLSearchParams;
}) {
  return (
    <Tabs
      aria-label="主导航"
      className="shell-mobile-nav-tabs w-full min-w-0"
      selectedKey={selectedKey}
      variant="secondary"
    >
      <Tabs.ListContainer className="w-full min-w-0">
        <Tabs.List aria-label="主导航" className="max-w-full">
          {links.map((link) => {
            const to = import.meta.env.DEV
              ? withGlobalSearchParams(link.to, params)
              : link.to;
            return (
              <Tabs.Tab
                key={link.id}
                className="min-w-0 flex-1 justify-center"
                href={to}
                id={link.id}
                render={(domProps) => (
                  <NavLink
                    {...(domProps as object)}
                    className={
                      typeof domProps.className === "string"
                        ? `${domProps.className} min-w-0 flex-1 justify-center`
                        : "min-w-0 flex-1 justify-center"
                    }
                    to={to}
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

/** Center course search: submit jumps to /courses?q=... (Issue #402). */
function ShellCourseSearch() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(params.get("q") ?? "");
  useEffect(() => {
    setQuery(params.get("q") ?? "");
  }, [params]);
  const submit = (value: string) => {
    const trimmed = value.trim();
    navigate(trimmed ? `/courses?q=${encodeURIComponent(trimmed)}` : "/courses");
  };
  return (
    <SearchField
      fullWidth
      aria-label="搜索课程"
      className="w-full"
      name="shell-course-search"
      value={query}
      variant="secondary"
      onChange={setQuery}
      onSubmit={submit}
    >
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input className="w-full" placeholder="搜索课程、老师" />
        <SearchField.ClearButton aria-label="清空课程搜索" />
      </SearchField.Group>
    </SearchField>
  );
}

function DefaultShell({
  banner,
  config,
  children,
}: {
  banner: SiteBannerValue | null;
  config: SiteConfig | null;
  children: ReactNode;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  const selectedKey = navSelectedKey(location.pathname);
  const showMobileBrowseTabs = !isMeAccountSurface(location.pathname);
  const globalSearchVariant = useGlobalSearchPrototypeVariant();
  const siteName = config?.siteName || "非官方课评@JUFE";
  const universityName = config?.universityName || "江西财经大学";
  const brandTo = import.meta.env.DEV
    ? withGlobalSearchParams("/latest", params)
    : "/latest";
  const showGlobalSearch =
    Boolean(globalSearchVariant) && Boolean(GlobalSearchPrototypeLazy);

  const showScheduleNav = config?.showScheduleNav === true;
  const links = [
    { id: "latest", to: "/latest", label: "课评" },
    { id: "courses", to: "/courses", label: "课程" },
    ...(showScheduleNav
      ? [{ id: "schedule", to: "/schedule", label: "排课模拟" }]
      : []),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <SkipToMain />
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-[1520px] px-3 py-2 sm:px-5 xl:px-4 xl:py-2.5">
          {/* 窄屏：品牌+账号 / 整行搜索 / 等宽 Tabs。不要把桌面三列挤扁。 */}
          <div className="flex flex-col gap-2 xl:hidden">
            <div className="flex items-center justify-between gap-2">
              <ShellBrand
                className="max-w-[min(11rem,calc(100%-7rem))]"
                siteName={siteName}
                to={brandTo}
              />
              <div className="flex shrink-0 items-center gap-1">
                <AccountNavControl />
                <ThemeToggle />
              </div>
            </div>
            <div className="min-w-0">
              {showGlobalSearch &&
              globalSearchVariant &&
              GlobalSearchPrototypeLazy ? (
                <Suspense fallback={null}>
                  <GlobalSearchPrototypeLazy
                    slot="shell"
                    variant={globalSearchVariant}
                  />
                </Suspense>
              ) : (
                <ShellCourseSearch />
              )}
            </div>
            {showMobileBrowseTabs ? (
              <nav aria-label="主导航" className="w-full min-w-0">
                <MobileTabsNav
                  links={links}
                  params={params}
                  selectedKey={selectedKey}
                />
              </nav>
            ) : null}
          </div>

          {/* xl+ 冻结生产壳：左簇品牌+Button 导航 · 居中搜索 · 右账号。 */}
          <div className="hidden grid-cols-[minmax(min-content,1fr)_minmax(12rem,28rem)_minmax(0,1fr)] items-center gap-x-4 xl:grid">
            <div className="flex items-center gap-2">
              <ShellBrand siteName={siteName} to={brandTo} />
              <nav
                aria-label="主导航"
                className="flex min-w-min flex-nowrap items-center gap-1"
              >
                <DesktopNavLinks
                  links={links}
                  params={params}
                  selectedKey={selectedKey}
                />
              </nav>
            </div>
            <div className="min-w-0">
              {showGlobalSearch &&
              globalSearchVariant &&
              GlobalSearchPrototypeLazy ? (
                <Suspense fallback={null}>
                  <GlobalSearchPrototypeLazy
                    slot="shell"
                    variant={globalSearchVariant}
                  />
                </Suspense>
              ) : (
                <ShellCourseSearch />
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <AccountNavControl />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <SiteBanner banner={banner} />

      <main
        className="mx-auto flex w-full max-w-[1520px] flex-1 flex-col px-4 pb-4 pt-8 sm:px-5 sm:pb-16 xl:px-4"
        id="main-content"
        tabIndex={-1}
      >
        {showGlobalSearch &&
        globalSearchVariant &&
        GlobalSearchPrototypeLazy ? (
          <Suspense fallback={null}>
            <GlobalSearchPrototypeLazy
              slot="note"
              variant={globalSearchVariant}
            />
          </Suspense>
        ) : null}
        {children}
      </main>

      <SiteFooter siteName={siteName} universityName={universityName} />
    </div>
  );
}

function withGlobalSearchParams(path: string, params: URLSearchParams) {
  if (params.get("module") !== "global-search") return path;
  const sp = new URLSearchParams();
  sp.set("module", "global-search");
  const variant = params.get("variant");
  if (variant) sp.set("variant", variant);
  return `${path}?${sp.toString()}`;
}

export function AppShell({
  banner,
  config,
  children,
}: {
  banner: SiteBannerValue | null;
  config: SiteConfig | null;
  children: React.ReactNode;
}) {
  const prototypeVariant = useShellNavPrototypeVariant();

  if (prototypeVariant && PrototypeShellLazy) {
    return (
      <Suspense fallback={<DefaultShell banner={banner} config={config}>{children}</DefaultShell>}>
        <PrototypeShellLazy variant={prototypeVariant} config={config}>
          {children}
        </PrototypeShellLazy>
      </Suspense>
    );
  }

  return <DefaultShell banner={banner} config={config}>{children}</DefaultShell>;
}
