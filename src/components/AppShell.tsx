import { buttonVariants, Link, SearchField } from "@heroui/react";
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
 * 左簇品牌 + 课程/课评/排课模拟/导师导航 · 居中课程搜索（提交到 /courses?q=）·
 * 右侧登录（AccountNavControl）+ 主题切换。
 * 顶栏与页面同底色、无硬分割线；写评价只从课程页「写点评」进入。
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

function navSelectedKey(pathname: string): string {
  if (pathname === "/latest") return "latest";
  if (pathname === "/schedule" || pathname.startsWith("/schedule/")) {
    return "schedule";
  }
  return "courses";
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
  const globalSearchVariant = useGlobalSearchPrototypeVariant();
  const siteName = config?.siteName || "非官方课评@JUFE";
  const universityName = config?.universityName || "江西财经大学";
  const brandTo = import.meta.env.DEV
    ? withGlobalSearchParams("/courses", params)
    : "/courses";
  const showGlobalSearch =
    Boolean(globalSearchVariant) && Boolean(GlobalSearchPrototypeLazy);

  const links = [
    { id: "courses", to: "/courses", label: "课程" },
    { id: "latest", to: "/latest", label: "课评" },
    { id: "schedule", to: "/schedule", label: "排课模拟" },
  ] as const;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur">
        {/* 窄屏三行:品牌+账号/主题 · 主导航(可换行) · 全宽搜索;
            lg+ 恢复 左簇品牌导航 / 居中搜索 / 右侧账号 单行三列。 */}
        <div className="mx-auto grid max-w-[1520px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,28rem)_minmax(0,1fr)] xl:px-4">
          {/* contents 让品牌与导航在窄屏直接成为 grid 项;lg+ 还原为左簇 flex 容器。 */}
          <div className="contents lg:flex lg:min-w-0 lg:items-center lg:gap-2">
            <Link
              className={`${buttonVariants({
                size: "sm",
                variant: "ghost",
              })} col-start-1 row-start-1 min-w-0 truncate no-underline`}
              href={brandTo}
              render={(domProps) => (
                <NavLink
                  {...(domProps as object)}
                  className={
                    typeof domProps.className === "string"
                      ? domProps.className
                      : undefined
                  }
                  to={brandTo}
                />
              )}
            >
              <span className="min-w-0 truncate">{siteName}</span>
            </Link>

            <nav
              aria-label="主导航"
              className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-1 lg:col-span-1 lg:row-start-auto"
            >
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
              {/* 外链用原生 <a>：HeroUI Link 会走 RouterProvider 的 useHref，
                  把绝对 URL 错当成站内路径。 */}
              <a
                className={buttonVariants({ size: "sm", variant: "ghost" })}
                href={PI_REVIEW_URL}
                target="_blank"
                rel="noreferrer"
              >
                导师
              </a>
            </nav>
          </div>

          <div className="col-span-2 row-start-3 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-start-1">
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

          <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 lg:col-start-3">
            <AccountNavControl />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <SiteBanner banner={banner} />

      <main className="mx-auto w-full max-w-[1520px] flex-1 px-4 pb-16 pt-8 sm:px-5 xl:px-4">
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
