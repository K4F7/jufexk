import { RouterProvider, Skeleton, Spinner } from "@heroui/react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useHref,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AdminSessionProvider } from "./hooks/useAdminSession";
import { ViewerProvider } from "./hooks/useViewer";
import { api } from "./lib/api";
import {
  LATEST_FEED_COLUMN_CLASS,
  LATEST_PAGE_SIZE,
  LATEST_REVIEW_RESERVED_ROW_CLASS,
  latestLoadingSkeletonCount,
} from "./lib/latest-loading";
import type { SiteConfig } from "./lib/types";
import type { SiteBanner } from "./site-banner";

declare global {
  interface Window {
    __jufexkSiteBannerRequest?: Promise<SiteBanner>;
  }
}

const THEME_STORAGE_KEY = "jufexk-theme";

type LatestPageModule = {
  default: typeof import("./pages/LatestPage").LatestPage;
};

let latestPageImport: Promise<LatestPageModule> | undefined;
function loadLatestPage() {
  return (latestPageImport ??= import("./pages/LatestPage").then((module) => ({
    default: module.LatestPage,
  })));
}
const LatestPage = lazy(loadLatestPage);

// Start the route chunk before React mounts on the two public entry paths.
// The lazy route consumes this same promise, so it does not create a second
// module request or add a serial chunk dependency to the first render.
if (
  typeof window !== "undefined" &&
  (window.location.pathname === "/" || window.location.pathname === "/latest")
) {
  void loadLatestPage();
}

let initialSiteBannerRequest = window.__jufexkSiteBannerRequest ?? null;

const AccountPage = lazy(() =>
  import("./pages/AccountPage").then((m) => ({ default: m.AccountPage })),
);
const CoursesPage = lazy(() =>
  import("./pages/CoursesPage").then((m) => ({ default: m.CoursesPage })),
);
const AdminBannerPage = lazy(() =>
  import("./pages/admin/AdminBannerPage").then((m) => ({ default: m.AdminBannerPage })),
);
const AdminHubPage = lazy(() =>
  import("./pages/admin/AdminHubPage").then((m) => ({ default: m.AdminHubPage })),
);
const AdminStudentBindingsPage = lazy(() =>
  import("./pages/admin/AdminStudentBindingsPage").then((m) => ({
    default: m.AdminStudentBindingsPage,
  })),
);
const AdminUserBlockPage = lazy(() =>
  import("./pages/admin/AdminUserBlockPage").then((m) => ({ default: m.AdminUserBlockPage })),
);
const CourseDetailPage = lazy(() =>
  import("./pages/CourseDetailPage").then((m) => ({ default: m.CourseDetailPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const NotFoundPage = lazy(() =>
  import("./pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const PublicUserPage = lazy(() =>
  import("./pages/PublicUserPage").then((m) => ({ default: m.PublicUserPage })),
);
const SchedulePage = lazy(() =>
  import("./pages/SchedulePage").then((m) => ({ default: m.SchedulePage })),
);
const SubmitPage = lazy(() =>
  import("./pages/SubmitPage").then((m) => ({ default: m.SubmitPage })),
);
const TeacherDetailPage = lazy(() =>
  import("./pages/TeacherDetailPage").then((m) => ({ default: m.TeacherDetailPage })),
);
const AboutPage = lazy(() =>
  import("./pages/SiteInfoPages").then((m) => ({ default: m.AboutPage })),
);
const ContactPage = lazy(() =>
  import("./pages/SiteInfoPages").then((m) => ({ default: m.ContactPage })),
);
const ResourcesPage = lazy(() =>
  import("./pages/SiteInfoPages").then((m) => ({ default: m.ResourcesPage })),
);
const TermsPage = lazy(() =>
  import("./pages/SiteInfoPages").then((m) => ({ default: m.TermsPage })),
);

/** Dev-only: lazy so production builds do not ship Gallery / identity switcher. */
const PrototypeGalleryPage = import.meta.env.DEV
  ? lazy(() =>
      import("./prototype/PrototypeGalleryPage").then((m) => ({
        default: m.PrototypeGalleryPage,
      })),
    )
  : null;

function RouteFallback() {
  const { pathname } = useLocation();
  if (pathname === "/latest") {
    return <LatestRouteFallback />;
  }
  return (
    <div className="flex flex-col items-center gap-2 py-10" role="status">
      <Spinner aria-hidden="true" size="sm" />
      <span className="text-xs text-muted">加载中…</span>
    </div>
  );
}

function LatestRouteFallback() {
  return (
    <div className={LATEST_FEED_COLUMN_CLASS} role="status" aria-label="正在加载最新课评">
      <header aria-hidden="true" className="mb-3 max-sm:sr-only">
        <Skeleton className="h-6 w-24 rounded" />
      </header>
      {Array.from({ length: LATEST_PAGE_SIZE }, (_, row) =>
        row < latestLoadingSkeletonCount() ? (
          <article
            className={LATEST_REVIEW_RESERVED_ROW_CLASS}
            data-loading-skeleton="true"
            key={row}
          >
            <header className="flex w-fit max-w-full flex-wrap items-center gap-2">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-3 w-20 rounded" />
            </header>
            <Skeleton className="mt-3 h-4 w-3/4 rounded" />
            <Skeleton className="mt-3 h-[4.5rem] w-full rounded" />
            <Skeleton className="mt-3 h-4 w-16 rounded" />
          </article>
        ) : (
          <div
            aria-hidden="true"
            className={`invisible ${LATEST_REVIEW_RESERVED_ROW_CLASS}`}
            key={row}
          />
        ),
      )}
    </div>
  );
}

function DevPrototypeMount() {
  const [chrome, setChrome] = useState<ReactNode>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    import("./prototype/DevPrototypeChrome").then((m) => {
      if (!cancelled) setChrome(<m.DevPrototypeChrome />);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{chrome}</>;
}

/**
 * Routes React Aria link navigations (e.g. Table.Row href) through React
 * Router instead of full-page reloads, so in-page state such as the course
 * review cache and scroll position survives row toggles (Issue #202).
 */
function TeachersListRedirect() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim();
  return (
    <Navigate
      replace
      to={q ? `/courses?q=${encodeURIComponent(q)}` : "/courses"}
    />
  );
}

function RacClientNavigation({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <RouterProvider navigate={navigate} useHref={useHref}>
      {children}
    </RouterProvider>
  );
}

function applyColorScheme(mode: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode !== "dark");
  root.dataset.theme = mode;
}

export function App() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [banner, setBanner] = useState<SiteBanner | null | undefined>(undefined);

  useEffect(() => {
    api<SiteConfig>("/api/config")
      .then((c) => {
        setConfig(c);
        if (c.siteName) document.title = c.siteName;
      })
      .catch(() => {
        setConfig({
          siteName: "非官方课评@JUFE",
          universityName: "江西财经大学",
        });
      });
  }, []);

  useEffect(() => {
    (initialSiteBannerRequest ?? api<SiteBanner>("/api/site/banner"))
      .then((value) => {
        initialSiteBannerRequest = null;
        setBanner(value);
      })
      .catch(() => {
        initialSiteBannerRequest = null;
        setBanner(null);
      });
  }, []);

  // Initial visit follows system; manual choice is remembered (foundations).
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

    const resolve = (): "light" | "dark" => {
      if (stored === "light" || stored === "dark") return stored;
      return media.matches ? "dark" : "light";
    };

    applyColorScheme(resolve());

    const onMedia = () => {
      const current = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (current === "light" || current === "dark") return;
      applyColorScheme(media.matches ? "dark" : "light");
    };

    media.addEventListener("change", onMedia);

    (
      window as unknown as {
        __jufexkSetTheme?: (m: "light" | "dark" | "system") => void;
      }
    ).__jufexkSetTheme = (mode) => {
      if (mode === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
        applyColorScheme(media.matches ? "dark" : "light");
        return;
      }
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
      applyColorScheme(mode);
    };

    return () => {
      media.removeEventListener("change", onMedia);
      delete (
        window as unknown as {
          __jufexkSetTheme?: unknown;
        }
      ).__jufexkSetTheme;
    };
  }, []);

  return (
    <BrowserRouter>
      <RacClientNavigation>
        <ViewerProvider>
          <AdminSessionProvider>
            <AppShell
              banner={banner ?? null}
              bannerLoading={banner === undefined}
              config={config}
            >
              <Suspense fallback={<RouteFallback />}>
              <Routes>
              <Route path="/" element={<Navigate to="/latest" replace />} />
              <Route path="/courses" element={<CoursesPage />} />
              <Route path="/courses/:id" element={<CourseDetailPage />} />
              <Route path="/latest" element={<LatestPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/teachers" element={<TeachersListRedirect />} />
              <Route path="/teachers/:id" element={<TeacherDetailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/u/:code" element={<PublicUserPage />} />
              <Route path="/submit" element={<SubmitPage config={config} />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/resources" element={<ResourcesPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/admin" element={<AdminHubPage />} />
              <Route path="/admin/admins" element={<AdminStudentBindingsPage />} />
              <Route path="/admin/banner" element={<AdminBannerPage />} />
              <Route path="/admin/users/:id" element={<AdminUserBlockPage />} />
              {PrototypeGalleryPage ? (
                <Route
                  path="/prototype"
                  element={<PrototypeGalleryPage />}
                />
              ) : null}
              <Route path="*" element={<NotFoundPage />} />
              </Routes>
              </Suspense>
              {import.meta.env.DEV ? <DevPrototypeMount /> : null}
            </AppShell>
          </AdminSessionProvider>
        </ViewerProvider>
      </RacClientNavigation>
    </BrowserRouter>
  );
}
